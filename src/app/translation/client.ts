/**
 * @file src/app/translation/client.ts
 * 文件职责：作为页面与后台翻译 broker 之间的客户端代理，统一管理单条、批量和视频字幕翻译的队列、取消、重试、超时、上下文与统计。
 * 主要内容：冻结服务/模型与语言参数，验证可用凭据上下文，获取页面摘要上下文，使用 runtime.sendMessage 分派请求；维护 AbortSignal、queue lease、指数退避、计数延迟保存及 cancelAllTranslations。
 * 模块边界：客户端不实现供应商协议、不直接读写翻译缓存，也不修改全文 DOM；后台 runtime/broker 负责 provider 与缓存，调用它的各 feature 负责展示和会话状态。
 */
/**
 * 翻译API代理模块
 * 整合翻译队列管理，作为翻译函数和后台翻译服务之间的中间层
 */

import browser from 'webextension-polyfill';
import {containsEnglishMonthDate, detectlang} from '@/src/core/language/detect';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';
import {config, requestConfigCountIncrement} from '@/src/services/config/store';
import {createConfigCountPersistenceQueue} from '@/src/services/config/count';
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {getPageTranslationContext} from '@/src/services/translation/context';
import {
  enqueueTranslation,
  clearTranslationQueue,
  type TranslationQueueLease,
  type TranslationQueueSession,
} from '@/src/services/translation/queue';
import {
  isRetryableTranslationError,
  TranslationRequestError,
  unwrapTranslationResponse,
} from '@/src/services/translation/errors';

// 调试相关
const isDev = process.env.NODE_ENV === 'development';
const VIDEO_COUNT_SAVE_INTERVAL = 10_000;
const TRANSLATION_COUNT_SAVE_INTERVAL = 500;
const COUNT_SAVE_RETRY_INTERVAL = 1_000;
const COUNT_SAVE_MAX_AUTOMATIC_RETRIES = 3;

function persistCountIncrement(delta: number, operationId: string): Promise<number> {
  return requestConfigCountIncrement(
    delta,
    browser.runtime.sendMessage.bind(browser.runtime),
    operationId,
  );
}

const translationCountPersistence = createConfigCountPersistenceQueue({
  delayMs: TRANSLATION_COUNT_SAVE_INTERVAL,
  retryDelayMs: COUNT_SAVE_RETRY_INTERVAL,
  maxAutomaticRetries: COUNT_SAVE_MAX_AUTOMATIC_RETRIES,
  persist: persistCountIncrement,
  onError: (error) => console.error('[FluentRead] 保存翻译计数失败:', error),
});
const videoCountPersistence = createConfigCountPersistenceQueue({
  delayMs: VIDEO_COUNT_SAVE_INTERVAL,
  retryDelayMs: COUNT_SAVE_RETRY_INTERVAL,
  maxAutomaticRetries: COUNT_SAVE_MAX_AUTOMATIC_RETRIES,
  persist: persistCountIncrement,
  onError: (error) => console.error('[FluentRead] 保存视频翻译计数失败:', error),
});

function createAbortError(): Error {
  const error = new Error('翻译已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function shouldRetryTranslationRequest(
  error: unknown,
  aiSdkService: boolean,
  explicitRetryPolicy: boolean,
): boolean {
  if (!isRetryableTranslationError(error)) return false;
  if (!aiSdkService || explicitRetryPolicy) return true;

  // AI SDK 已自行穷尽 HTTP 429/5xx 重试；其浏览器 fetch 路径不会重试被拒绝的
  // Promise，因此只在该传输边界增加少量外层兜底。runtime 消息失败采用相同策略。
  return !(error instanceof TranslationRequestError) || error.kind === 'network';
}

function waitForDelay(delay: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

function waitForRequest<T>(
  request: PromiseLike<T>,
  timeout: number,
  signal?: AbortSignal,
  lease?: TranslationQueueLease,
): Promise<T> {
  throwIfAborted(signal);
  const transportSettlement = new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('翻译请求超时'))), timeout);
    Promise.resolve(request).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });

  // 中止一次 DOM 尝试无法撤回已经发出的扩展消息。队列槽位需要保持租用，直到
  // 传输完成或触发超时；调用方仍可立即停止等待。
  lease?.holdUntil(transportSettlement);
  if (!signal) return transportSettlement;

  return new Promise<T>((resolve, reject) => {
    let callerSettled = false;
    const finishCaller = (callback: () => void) => {
      if (callerSettled) return;
      callerSettled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finishCaller(() => reject(createAbortError()));
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) {
      onAbort();
      return;
    }
    transportSettlement.then(
      (value) => finishCaller(() => resolve(value)),
      (error) => finishCaller(() => reject(error)),
    );
  });
}

function scheduleTranslationCountSave(): void {
  translationCountPersistence.record();
}

function flushTranslationCountSave(): void {
  void translationCountPersistence.flush();
}

function scheduleVideoCountSave(): void {
  videoCountPersistence.record();
}

function flushVideoCountSave(): void {
  void videoCountPersistence.flush();
}

/**
 * 翻译API的统一入口
 * 所有翻译请求都应该通过此函数发送，以便集中管理队列和重试逻辑
 *
 * @param origin 原始文本
 * @param context 上下文信息，通常是页面标题
 * @param options 翻译选项
 * @returns 翻译结果的Promise
 */
export async function translateText(origin: string, context: string = document.title, options: TranslateOptions = {}): Promise<string> {
  const selectedService = options.serviceOverride || config.service;
  const selectedModel = resolveConfiguredModel(
    options.modelOverride || config.model[selectedService],
    options.modelOverride || config.customModel[selectedService],
  );
  const selectedLanguages = getTranslationLanguages(options);
  const {
    retryDelay = 1000,
    timeout = 45000,
    useCache = config.useCache,
    skipLanguageDetection = false,
    signal,
    queueSession,
  } = options;
  const aiSdkService = servicesType.isAiSdk(selectedService);
  const explicitRetryPolicy = options.maxRetries !== undefined;
  // AI SDK 服务自行负责协议感知的 HTTP 重试（429/5xx）。尚未迁移的适配器继续使用
  // 旧外层重试循环；浏览器层 fetch 被拒绝时额外保留两次兜底尝试。
  const maxRetries = options.maxRetries ?? (aiSdkService ? 2 : 3);
  throwIfAborted(signal);
  // 检查 origin 是否为空或只有空白字符
  const cleanedOrigin = origin?.replace(/[\s\u3000]/g, '') || '';
  if (!cleanedOrigin || cleanedOrigin.length === 0) {
    return origin || '';
  }

  if (containsEnglishMonthDate(origin)) return origin;

  assertTranslationCredentials(selectedService, selectedModel);
  // 如果目标语言与当前文本语言相同，直接返回原文
  if (!skipLanguageDetection && detectlang(origin.replace(/[\s\u3000]/g, '')) === selectedLanguages.targetLanguage) {
    return origin;
  }

  const pageContext = await resolvePageContext(options.pageContext, selectedService, selectedModel);
  throwIfAborted(signal);

  // 使用队列处理翻译请求
  const result = await enqueueTranslation(async (lease) => {
    // 创建翻译任务
    const translationTask = async (retryCount: number = 0): Promise<string> => {
      throwIfAborted(signal);
      try {
        // 发送翻译请求给background脚本处理
        const response = await waitForRequest(
          browser.runtime.sendMessage({
            context,
            pageContext,
            origin,
            useCache,
            serviceOverride: selectedService,
            sourceLanguage: selectedLanguages.sourceLanguage,
            targetLanguage: selectedLanguages.targetLanguage,
            modelOverride: selectedModel,
            requestTimeoutMs: Math.max(1_000, timeout - 1_000),
          }),
          timeout,
          signal,
          lease,
        );
        const result = unwrapTranslationResponse<string>(response);

        // 如果翻译结果为空或与原文完全相同，直接返回原文
        if (!result || result === origin) {
          return origin;
        }

        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        // 处理错误，根据重试策略决定是否重试
        if (retryCount < maxRetries && shouldRetryTranslationRequest(error, aiSdkService, explicitRetryPolicy)) {
          if (isDev) {
            console.log(`[翻译API] 翻译失败，${retryCount + 1}/${maxRetries} 次重试`);
          }

          // 等待一段时间后重试
          await waitForDelay(retryDelay, signal);
          return translationTask(retryCount + 1);
        }

        // 超过最大重试次数，抛出异常
        throw error;
      }
    };

    // 开始执行翻译任务
    return translationTask();
  }, queueSession);
  // 只统计已成功完成的调用；同一富文本回退产生的短请求仍由延迟队列合并落盘。
  scheduleTranslationCountSave();
  return result;
}

/**
 * 批量翻译纯文本片段。用于仅译文模式保留原始 DOM 结构，避免机器翻译接口修改标签和属性。
 */
export async function translateTextBatch(
  origins: string[],
  context: string = document.title,
  options: TranslateOptions = {},
): Promise<string[]> {
  if (origins.length === 0) return [];
  const translatableIndexes = origins.flatMap((origin, index) =>
    containsEnglishMonthDate(origin) ? [] : [index]);
  if (translatableIndexes.length === 0) return [...origins];
  const requestOrigins = translatableIndexes.map((index) => origins[index] ?? '');

  const selectedService = options.serviceOverride || config.service;
  const selectedModel = resolveConfiguredModel(
    options.modelOverride || config.model[selectedService],
    options.modelOverride || config.customModel[selectedService],
  );
  const selectedLanguages = getTranslationLanguages(options);
  const {
    retryDelay = 1000,
    timeout = 45000,
    useCache = config.useCache,
    signal,
    queueSession,
  } = options;
  assertTranslationCredentials(selectedService, selectedModel);
  const aiSdkService = servicesType.isAiSdk(selectedService);
  const explicitRetryPolicy = options.maxRetries !== undefined;
  const maxRetries = options.maxRetries ?? (aiSdkService ? 2 : 3);
  throwIfAborted(signal);
  const pageContext = await resolvePageContext(options.pageContext, selectedService, selectedModel);
  throwIfAborted(signal);

  const result = await enqueueTranslation(async (lease) => {
    const translationTask = async (retryCount: number = 0): Promise<string[]> => {
      throwIfAborted(signal);
      try {
        const response = await waitForRequest(
          browser.runtime.sendMessage({
            context,
            pageContext,
            origin: requestOrigins,
            ...(options.aiMultiSegment === true ? {aiMultiSegment: true} : {}),
            useCache,
            serviceOverride: selectedService,
            sourceLanguage: selectedLanguages.sourceLanguage,
            targetLanguage: selectedLanguages.targetLanguage,
            modelOverride: selectedModel,
            requestTimeoutMs: Math.max(1_000, timeout - 1_000),
          }),
          timeout,
          signal,
          lease,
        );
        const result = unwrapTranslationResponse<string[]>(response);

        if (!Array.isArray(result)
          || result.length !== requestOrigins.length
          || Array.from({length: requestOrigins.length}, (_, index) => result[index])
            .some(item => typeof item !== 'string')) {
          throw new Error('批量翻译返回格式异常');
        }

        const merged = [...origins];
        translatableIndexes.forEach((originIndex, resultIndex) => {
          merged[originIndex] = result[resultIndex]!;
        });
        return merged;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (retryCount < maxRetries && shouldRetryTranslationRequest(error, aiSdkService, explicitRetryPolicy)) {
          await waitForDelay(retryDelay, signal);
          return translationTask(retryCount + 1);
        }
        throw error;
      }
    };

    return translationTask();
  }, queueSession);
  scheduleTranslationCountSave();
  return result;
}

/**
 * 翻译视频字幕。视频字幕使用独立的服务配置，但仍通过 background
 * 统一请求、缓存和错误边界；只发送 YouTube 已提供的纯文本字幕内容。
 */
export async function translateVideoText(origin: string): Promise<string> {
  const cleanedOrigin = origin?.replace(/[\s\u3000]/g, '') || '';
  if (!cleanedOrigin) return origin || '';

  const service = config.videoService;
  const model = resolveConfiguredModel(config.model[service], config.customModel[service]);
  const languages = getTranslationLanguages();
  const useCache = config.useCache;
  const pageContext = await resolvePageContext(undefined, service, model);

  const result = await enqueueTranslation(async (lease) => {
    const response = await waitForRequest(browser.runtime.sendMessage({
        context: `YouTube 视频字幕：${typeof document === 'undefined' ? '' : document.title}`,
        pageContext,
        origin,
        useCache,
        serviceOverride: service,
        modelOverride: model,
        sourceLanguage: languages.sourceLanguage,
        targetLanguage: languages.targetLanguage,
        requestTimeoutMs: 19_000,
      }), 20_000, undefined, lease);
    return unwrapTranslationResponse<string>(response);
  });
  // 视频字幕是高频短文本；成功后才记账，并合并为低频写入。
  scheduleVideoCountSave();
  return result;
}

/**
 * 当用户离开页面或主动取消翻译时，清空翻译队列
 */
export function cancelAllTranslations() {
  if (isDev) {
    console.log('[翻译API] 取消所有等待中的翻译任务');
  }
  clearTranslationQueue();
  flushTranslationCountSave();
  flushVideoCountSave();
}

/**
 * 翻译参数接口
 */
export interface TranslateOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔(毫秒) */
  retryDelay?: number;
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 是否使用缓存 */
  useCache?: boolean;
  /** 仅对当前请求使用的翻译服务，不改变网页翻译默认服务。 */
  serviceOverride?: string;
  /** 仅对当前请求使用的源语言，不改变通用设置。 */
  sourceLanguage?: string;
  /** 仅对当前请求使用的目标语言，不改变通用设置。 */
  targetLanguage?: string;
  /** 发送给 LLM 的网页参考上下文；未提供时按当前页面自动提取。 */
  pageContext?: string;
  /** 内部结构化数据包含有 ASCII 哨兵标记，不应影响源语言检测。 */
  skipLanguageDetection?: boolean;
  /** 仅全文翻译内部使用：要求 broker 将多个 AI 段落合并为一次上游请求。 */
  aiMultiSegment?: boolean;
  /** DOM 尝试恢复后，取消重试等待并忽略迟到的 runtime 响应。 */
  signal?: AbortSignal;
  /** 一次 DOM 尝试取消时，用于拒绝尚未开始任务的队列作用域。 */
  queueSession?: TranslationQueueSession;
  /** 为文档等独立入口覆盖当前请求的实际模型，不改写网页翻译配置。 */
  modelOverride?: string;
}

function assertTranslationCredentials(service = config.service, modelOverride?: string): void {
  // content script 按设计只接收公开配置，因此无法检查 API 凭据。后台请求边界加载
  // 后台加载专用持久凭据后执行权威校验。仅扩展页面按设计能够读取凭据，可保留本地快速失败。
  if (!isTrustedCredentialStorageContext()) return;

  const credentialConfig = modelOverride
    ? {
      ...config,
      model: {...config.model, [service]: modelOverride},
      customModel: {...config.customModel, [service]: modelOverride},
    }
    : config;
  const message = getMissingCredentialMessage(service, credentialConfig);
  if (message) throw new Error(message);
}

async function resolvePageContext(suppliedContext?: string, serviceOverride = config.service, modelOverride?: string): Promise<string | undefined> {
  const service = serviceOverride || config.service;
  const selectedModel = resolveConfiguredModel(modelOverride || config.model[service], modelOverride || config.customModel[service]);
  if (!config.enableAIContext || !servicesType.isUseAIContext(service, selectedModel)) return undefined;
  return suppliedContext?.trim().slice(0, 4000) || await getPageTranslationContext() || undefined;
}
