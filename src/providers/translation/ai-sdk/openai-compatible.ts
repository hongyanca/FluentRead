/**
 * @file src/providers/translation/ai-sdk/openai-compatible.ts
 *
 * 文件职责：通过 Vercel AI SDK 执行 OpenAI 兼容翻译请求，为多个模型服务共享超时、重试、端点和响应校验。
 * 主要内容：冻结请求级配置，解析服务 endpoint 与模型，构造 commonMsgTemplate，调用 generateText，清理推理内容，并将 SDK 异常转换为 LlmTransportError。 可核对的公开符号包括 AI_SDK_REQUEST_TIMEOUT_MS、AI_SDK_MAX_RETRIES、AiSdkTranslationRequest、translateWithOpenAICompatibleAiSdk。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {generateText} from 'ai';
import {config} from '@/src/services/config/store';
import {stripTranslationReasoning as contentPostHandler} from '@/src/core/translation/prompts';
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {services} from '@/src/core/config/catalog';
import {
  resolveOpenAICompatibleEndpoint,
  type ResolvedOpenAICompatibleEndpoint,
} from './endpoints';
import {LlmTransportError, normalizeAiSdkError} from './errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {
  getTranslationProviderConfig,
  reportTranslationModelUsage,
  type TranslationProviderRequestContext,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderConfigSnapshot} from '@/src/services/translation/types';
import {normalizeOpenAICompatibleUsage} from '../usage';

export const AI_SDK_REQUEST_TIMEOUT_MS = 40_000;
export const AI_SDK_MAX_RETRIES = 2;

export interface AiSdkTranslationRequest extends TranslationProviderRequestContext {
  origin: string | string[];
  pageContext?: string;
  summaryPrompt?: string;
  summarySystemPrompt?: string;
  serviceOverride?: string;
  modelOverride?: string;
  targetLanguage?: string;
  requestTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

interface OpenAICompatiblePayload extends Record<string, unknown> {
  model: string;
  messages: unknown[];
}

function parsePayload(body: string): OpenAICompatiblePayload {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new LlmTransportError('大模型请求体生成失败，请检查自定义请求体配置。', {
      kind: 'bad-request',
      retryable: false,
    });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LlmTransportError('大模型请求体必须是 JSON 对象。', {
      kind: 'bad-request',
      retryable: false,
    });
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.model !== 'string' || !candidate.model.trim()) {
    throw new LlmTransportError('模型尚未配置，请前往设置页面进行检查。', {
      kind: 'bad-request',
      retryable: false,
    });
  }
  if (!Array.isArray(candidate.messages)) {
    throw new LlmTransportError('自定义请求体中的 messages 必须是数组。', {
      kind: 'bad-request',
      retryable: false,
    });
  }

  return {
    ...candidate,
    model: candidate.model.trim(),
    messages: candidate.messages,
  };
}

function providerHeaders(service: string, apiKey: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (service === services.azureOpenai && apiKey) headers['api-key'] = apiKey;
  if (service === services.openrouter) {
    headers['HTTP-Referer'] = 'https://fluent.thinkstu.com';
    headers['X-Title'] = 'FluentRead';
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

interface OpenAICompatibleResponseBody {
  model?: unknown;
  usage?: unknown;
  choices?: Array<{message?: {content?: unknown}; finish_reason?: unknown}>;
}

function nonNegativeToken(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/** 只把 SDK 能安全解析的数值 usage 字段放回响应，兼容字符串等非标准元数据。 */
function sanitizeUsageForAiSdk(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const usage: Record<string, unknown> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cached_tokens'] as const) {
    const token = nonNegativeToken(source[key]);
    if (token !== undefined) usage[key] = token;
  }

  const promptDetails = source.prompt_tokens_details;
  if (promptDetails && typeof promptDetails === 'object' && !Array.isArray(promptDetails)) {
    const details: Record<string, number> = {};
    for (const key of ['cached_tokens', 'cache_write_tokens'] as const) {
      const token = nonNegativeToken((promptDetails as Record<string, unknown>)[key]);
      if (token !== undefined) details[key] = token;
    }
    if (Object.keys(details).length > 0) usage.prompt_tokens_details = details;
  }

  const completionDetails = source.completion_tokens_details;
  if (completionDetails && typeof completionDetails === 'object' && !Array.isArray(completionDetails)) {
    const reasoningTokens = nonNegativeToken(
      (completionDetails as Record<string, unknown>).reasoning_tokens,
    );
    if (reasoningTokens !== undefined) {
      usage.completion_tokens_details = {reasoning_tokens: reasoningTokens};
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

async function normalizeSuccessfulTextResponse(
  response: Response,
): Promise<{response: Response; body?: OpenAICompatibleResponseBody}> {
  if (!response.ok) return {response};

  try {
    const body = await response.clone().json() as OpenAICompatibleResponseBody;
    const choice = body?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    if (typeof content !== 'string') return {response, body};

    // FluentRead 只消费文本。这里重建旧适配器接受的最小响应结构，避免非标准可选元数据
    // （例如字符串形式的 token 数量）导致 SDK 拒绝原本有效的翻译；有效数值 usage
    // 会继续交给 SDK，并同时由本地统计观察器读取。
    const normalizedBody: Record<string, unknown> = {
      choices: [{
        message: {role: 'assistant', content},
        finish_reason: typeof finishReason === 'string' ? finishReason : null,
      }],
    };
    const sanitizedUsage = sanitizeUsageForAiSdk(body.usage);
    if (sanitizedUsage) normalizedBody.usage = sanitizedUsage;
    if (typeof body.model === 'string' && body.model.trim()) normalizedBody.model = body.model.trim();
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json');
    return {
      response: new Response(JSON.stringify(normalizedBody), {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      body,
    };
  } catch {
    return {response};
  }
}

function compatibilityFetch(
  endpoint: ResolvedOpenAICompatibleEndpoint,
  request: AiSdkTranslationRequest,
  requestedModel: string,
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await runtimeFetch(endpoint.exactEndpoint || input, init);
    } catch (error) {
      reportTranslationModelUsage(request, {
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        actualModel: requestedModel,
        outcome: init?.signal?.aborted ? 'cancelled' : 'error',
        usageAvailability: 'unreported',
      });
      throw error;
    }

    const normalized = await normalizeSuccessfulTextResponse(response);
    const usage = normalizeOpenAICompatibleUsage(normalized.body?.usage, normalized.body?.model ?? requestedModel);
    reportTranslationModelUsage(request, {
      ...usage,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: response.status === 408 ? 'timeout' : response.ok ? 'success' : 'error',
      statusCode: response.status,
    });
    return normalized.response;
  };
}

function normalizedTimeout(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AI_SDK_REQUEST_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1, Math.floor(value)));
}

function createRequestAbortContext(timeoutMs: number, callerSignal?: AbortSignal) {
  const controller = new AbortController();
  let abortedByCaller = false;
  const onCallerAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener('abort', onCallerAbort, {once: true});

  // 避免依赖 AI SDK 的 AbortSignal.timeout，使扩展在支持 AbortController、
  // 但尚不支持该新辅助方法的浏览器中仍能使用。
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    abortedByCaller: () => abortedByCaller,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

async function translateSingle(
  request: AiSdkTranslationRequest,
  service: string,
  origin: string,
  current: TranslationProviderConfigSnapshot,
): Promise<string> {
  let endpoint: ResolvedOpenAICompatibleEndpoint;
  try {
    endpoint = resolveOpenAICompatibleEndpoint(service, current);
  } catch (error) {
    throw new LlmTransportError(
      error instanceof Error ? error.message : String(error),
      {kind: 'bad-request', retryable: false},
    );
  }
  const apiKey = current.token[service]?.trim() || '';
  const payload = parsePayload(commonMsgTemplate(
    origin,
    request.pageContext,
    request.summaryPrompt,
    request.summarySystemPrompt,
    service,
    request.targetLanguage,
    request.modelOverride,
    current,
  ));

  // 协议的 stream 标记由 SDK 管理。自定义请求体仍可替换 model/messages，并添加任意
  // OpenAI 兼容 provider 字段，但不能绕过解析器把 generateText 调用切换为 SSE。
  const requestBody: Record<string, unknown> = {...payload, stream: false};
  const provider = createOpenAICompatible({
    name: 'fluentread',
    baseURL: endpoint.baseURL,
    apiKey: service === services.azureOpenai ? undefined : apiKey || undefined,
    headers: providerHeaders(service, apiKey),
    queryParams: endpoint.queryParams,
    fetch: compatibilityFetch(endpoint, request, payload.model),
    transformRequestBody: () => requestBody,
  });
  const abortContext = createRequestAbortContext(
    normalizedTimeout(request.requestTimeoutMs),
    request.abortSignal,
  );

  try {
    const result = await generateText({
      model: provider(payload.model),
      // transformRequestBody 提供实际的 provider payload。固定且符合 SDK 要求的 prompt
      // 可避免 ModelMessage schema 提前拒绝 developer role 或 image_url 内容等有效的
      // OpenAI 扩展格式。
      prompt: 'FluentRead OpenAI-compatible request',
      maxRetries: AI_SDK_MAX_RETRIES,
      abortSignal: abortContext.signal,
    });
    const text = contentPostHandler(result.text || '');
    if (!text) {
      throw new LlmTransportError('翻译服务已响应，但没有返回有效译文。', {
        kind: 'response',
        retryable: false,
      });
    }
    return text;
  } catch (error) {
    if (error instanceof LlmTransportError) throw error;
    throw normalizeAiSdkError(service, error, apiKey, abortContext.abortedByCaller());
  } finally {
    abortContext.cleanup();
  }
}

export async function translateWithOpenAICompatibleAiSdk(
  request: AiSdkTranslationRequest,
): Promise<string | string[]> {
  const current = getTranslationProviderConfig(request, config);
  const service = request.serviceOverride || current.service;
  const requestBudget = normalizedTimeout(request.requestTimeoutMs);
  if (!Array.isArray(request.origin)) {
    return translateSingle({...request, requestTimeoutMs: requestBudget}, service, request.origin, current);
  }

  // AI 服务很少接收批量消息，但图片翻译会提供这类输入。每次仅允许一个上游请求在途，
  // 避免单个后台队列租约绕过 FluentRead 的并发上限。
  const translations: string[] = [];
  const deadline = Date.now() + requestBudget;
  for (const origin of request.origin) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LlmTransportError('当前翻译服务请求超时，请稍后重试。', {
        kind: 'timeout',
        retryable: true,
      });
    }
    translations.push(await translateSingle(
      {...request, requestTimeoutMs: remaining},
      service,
      origin,
      current,
    ));
  }
  return translations;
}
