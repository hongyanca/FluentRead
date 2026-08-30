/**
 * @file src/services/translation/broker.ts
 *
 * 文件职责：编排翻译请求的配置快照、语言解析、缓存、请求去重、超时与 provider 调用，是后台翻译用例的中心服务。
 * 主要内容：createTranslationBroker 同时支持单条、批量和页面摘要，验证 provider 返回数量和类型，以完整身份构建缓存键，并在清理代次与剩余 deadline 下管理 pending 请求。 可核对的公开符号包括 createTranslationBroker、聚合导出。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

import type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationModelUsageObservation,
    TranslationModelUsageOutcome,
    TranslationModelUsageRecord,
    TranslationProviderConfigSnapshot,
    TranslationProvider,
    TranslationRequestMessage,
    TranslationSingleRequestMessage,
} from './types';
import {
    attachTranslationModelUsageObserver,
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    TRANSLATION_REMAINING_BUDGET,
    type TranslationRemainingBudgetContext,
} from './requestSnapshot';
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/public';
import {
    isDefinitePageContextLeak,
    isLikelyPageContextLeak,
} from '@/src/core/translation/prompts';

export type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationConfigSnapshot,
    TranslationProviderConfigSnapshot,
    TranslationLanguageOverride,
    TranslationProvider,
    TranslationProviderRegistry,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
    TranslationSingleRequestMessage,
} from './types';

type CacheRequestMode = 'single' | 'batch' | 'ai-multi-segment';

interface TranslationRequestExecution {
    readonly config: TranslationProviderConfigSnapshot;
    readonly service: string;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

const PAGE_SUMMARY_CACHE_SIZE = 8;
const PAGE_SUMMARY_LIMIT = 1200;
const DEFAULT_PROVIDER_TIMEOUT_MS = 45_000;

class TranslationProviderDeadlineError extends Error {
    constructor() {
        super('翻译请求超时');
        this.name = 'TranslationProviderDeadlineError';
    }
}

class AIMultiSegmentResponseError extends Error {
    readonly kind = 'response';
    readonly retryable = false;
    readonly code = 'AI_MULTI_SEGMENT_RESPONSE_INVALID';

    constructor() {
        super('AI 多段翻译返回格式异常，已切换为逐段翻译');
        this.name = 'AIMultiSegmentResponseError';
    }
}

class AIContextRecoveryResponseError extends Error {
    readonly kind = 'response';
    readonly retryable = false;
    readonly code = 'AI_CONTEXT_LEAK_AFTER_RECOVERY';

    constructor() {
        super('AI 翻译在无上下文重试后仍返回了网页参考内容，已停止展示并跳过缓存');
        this.name = 'AIContextRecoveryResponseError';
    }
}

export function createTranslationBroker(deps: TranslationBrokerDependencies): TranslationBroker {
    const pendingTranslations = new Map<string, Promise<string>>();
    const pendingBatches = new Map<string, Promise<string[]>>();
    const pageSummaryCache = new Map<string, string>();
    const pendingPageSummaries = new Map<string, Promise<string>>();
    const pendingCacheWrites = new Map<Promise<unknown>, number>();
    let cacheGeneration = 0;
    const now = deps.now ?? (() => Date.now());
    const logger = deps.logger ?? console;

    function warn(message: string, error: unknown): void {
        try {
            logger.warn(message, error);
        } catch {
            // 步骤 1：诊断器是旁路依赖；自定义 logger 失败不能中断用户翻译。
        }
    }

    function config() {
        return deps.getConfig();
    }

    function getSelectedModel(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): string {
        return deps.resolveConfiguredModel(
            modelOverride || current.model[service],
            modelOverride || current.customModel[service],
        );
    }

    function isPromptBasedAI(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): boolean {
        return deps.serviceTypes.isUseAIContext(service, getSelectedModel(current, service, modelOverride));
    }

    function isAIContextEnabled(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): boolean {
        return current.enableAIContext && isPromptBasedAI(current, service, modelOverride);
    }

    function getProviderEndpoint(current: TranslationProviderConfigSnapshot, service: string): string {
        if (deps.serviceTypes.isAiSdk(service)) {
            try {
                return deps.endpointResolver.resolveOpenAICompatibleEndpoint(service, current).endpoint;
            } catch {
                // 步骤 1：配置校验负责用户可见错误；缓存 key 生成必须在设置缺失时仍可完成。
                return '';
            }
        }
        if (current.proxy[service]) return current.proxy[service];
        if (service === 'custom') return current.custom;
        if (service === 'deeplx') return current.deeplx;
        if (service === 'newapi') return current.newApiUrl;
        if (service === deps.serviceIds.minimax) {
            const plan = current.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
            const region = current.minimaxRegion === 'cn' ? 'cn' : 'global';
            return deps.endpointResolver.minimaxEndpoints[plan]?.[region] || '';
        }
        if (service === deps.serviceIds.mimo) {
            return deps.endpointResolver.getMimoEndpoint(current.mimoBillingPlan, current.mimoRegion);
        }
        return '';
    }

    function buildCacheKey(
        execution: TranslationRequestExecution,
        origin: string | string[],
        context: string,
        pageContext: string,
        mode: CacheRequestMode,
        modelOverride?: string,
    ): string {
        const {config: current, service, sourceLanguage, targetLanguage} = execution;

        return deps.buildTranslationCacheKey({
            requestMode: mode,
            sourceText: origin,
            sourceLanguage,
            targetLanguage,
            service,
            model: getSelectedModel(current, service, modelOverride),
            endpoint: getProviderEndpoint(current, service),
            azureOpenaiEndpoint: service === 'azureOpenai' ? current.azureOpenaiEndpoint : undefined,
            customBody: current.customBody[service] || '',
            systemRole: current.system_role[service] || '',
            userRole: current.user_role[service] || '',
            deepseekApiType: current.deepseekApiType,
            deepseekThinkingMode: current.deepseekThinkingMode,
            transportProfile: deps.serviceTypes.isAiSdk(service)
                ? deps.endpointResolver.aiSdkTransportProfile
                : undefined,
            // 步骤 1：DeepL 把标题上下文直接发送给 provider；AI adapter 通过 prompt 注入页面上下文。
            context: service === 'deepL' ? context : undefined,
            pageContext: isAIContextEnabled(current, service, modelOverride) ? pageContext : undefined,
        });
    }

    function buildBatchItemCacheKey(
        execution: TranslationRequestExecution,
        origin: string,
        itemIndex: number,
        batchOrigins: readonly string[],
        context: string,
        pageContext: string,
        mode: CacheRequestMode,
        modelOverride?: string,
    ): string {
        // AI 多段结果会受同批邻段影响，不能只按当前 origin 复用到另一种组合。
        // 把槽位序号和当前项放在首位，再携带完整有序批次；同批重复原文也不会被错误折叠。
        const sourceIdentity = mode === 'ai-multi-segment'
            ? [`slot:${itemIndex}`, origin, ...batchOrigins]
            : origin;
        return buildCacheKey(
            execution,
            sourceIdentity,
            context,
            pageContext,
            mode,
            modelOverride,
        );
    }

    function isCacheEnabled(current: TranslationProviderConfigSnapshot, message: TranslationRequestMessage): boolean {
        return current.useCache && message.useCache !== false;
    }

    function normalizeTranslationComparable(value: string): string {
        return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    }

    function isCacheableResult(origin: string, result: unknown): result is string {
        return typeof result === 'string'
            && Boolean(result.trim())
            && normalizeTranslationComparable(result) !== normalizeTranslationComparable(origin);
    }

    function requireSingleResult(result: unknown): string {
        if (typeof result !== 'string') throw new Error('单条翻译返回格式异常');
        return result;
    }

    function requireBatchResult(result: unknown, expectedLength: number): string[] {
        if (!Array.isArray(result)) throw new Error('批量翻译返回格式异常');
        if (result.length !== expectedLength) throw new Error('批量翻译返回数量异常');
        const denseResult = Array.from({length: expectedLength}, (_, index) => result[index]);
        if (denseResult.some((value) => typeof value !== 'string')) {
            throw new Error('批量翻译返回格式异常');
        }
        return denseResult as string[];
    }

    function getTranslationService(serviceName: string): TranslationProvider {
        const service = deps.providers[serviceName];
        if (!service) throw new Error(`未找到翻译服务适配器: ${serviceName}`);
        return service;
    }

    /** 公开请求至少保留一秒，避免调用方误传 0 导致请求永远无法启动。 */
    function normalizeExternalRequestTimeoutMs(requestTimeoutMs?: number): number | undefined {
        return typeof requestTimeoutMs === 'number' && Number.isFinite(requestTimeoutMs)
            ? Math.max(1_000, Math.floor(requestTimeoutMs))
            : undefined;
    }

    /** 内部剩余预算必须保持精确，不能再次抬高到公开请求的一秒下限。 */
    function normalizeDeadlineTimeoutMs(requestTimeoutMs: number): number {
        return Math.max(1, Math.floor(requestTimeoutMs));
    }

    function getRemainingDeadlineMs(requestDeadline: number): number {
        const remaining = Math.floor(requestDeadline - now());
        if (remaining <= 0) throw new TranslationProviderDeadlineError();
        return remaining;
    }

    async function runWithinDeadline<T>(
        operation: () => Promise<T>,
        requestDeadline: number,
    ): Promise<T> {
        const remaining = getRemainingDeadlineMs(requestDeadline);
        const work = operation();

        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new TranslationProviderDeadlineError()), remaining);
        });
        try {
            return await Promise.race([work, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }

    function applyRemainingDeadline<T extends TranslationRequestMessage>(
        message: T,
        requestDeadline: number,
    ): T {
        const remaining = getRemainingDeadlineMs(requestDeadline);
        return {...message, requestTimeoutMs: remaining};
    }

    function buildPendingRequestKey(cacheKey: string, requestTimeoutMs: number): string {
        const normalizedTimeoutMs = normalizeDeadlineTimeoutMs(requestTimeoutMs);
        return `${cacheKey}:timeout:${normalizedTimeoutMs}ms`;
    }

    /**
     * 把 requestTimeoutMs 落实为 broker 拥有的 provider 截止时间。
     *
     * content 端停止等待 runtime message 并不会取消 background 中的 fetch；如果只把
     * timeout 数字传给 provider，未实现 AbortSignal 的旧适配器会让 pending Map 永久
     * 保留。这里无论 provider 是否主动消费 abortSignal，都会在截止时间释放调用方和
     * pending 所有权；支持 AbortSignal 的适配器还能同步停止底层请求。
     */
    function modelUsagePurpose(message: TranslationRequestMessage): TranslationModelUsageRecord['purpose'] {
        return 'summaryPrompt' in message && typeof message.summaryPrompt === 'string' && message.summaryPrompt.trim()
            ? 'page-summary'
            : 'translation';
    }

    function modelUsageOutcome(error: unknown): TranslationModelUsageOutcome {
        if (error instanceof TranslationProviderDeadlineError) return 'timeout';
        if (error && typeof error === 'object') {
            const candidate = error as {kind?: unknown; statusCode?: unknown};
            if (candidate.kind === 'timeout' || candidate.statusCode === 408) return 'timeout';
        }
        if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
        return 'error';
    }

    function cleanModelName(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const normalized = value
            .replace(/[\u0000-\u001F\u007F]/g, '')
            .trim()
            .slice(0, 160);
        return normalized || undefined;
    }

    async function persistModelUsage(
        execution: TranslationRequestExecution,
        message: TranslationRequestMessage,
        observations: readonly TranslationModelUsageObservation[],
        startedAt: number,
        fallbackOutcome: TranslationModelUsageOutcome,
        generation: number,
    ): Promise<void> {
        if (
            !deps.recordModelUsage
            || !deps.serviceTypes.isAI(execution.service)
            || observations.length === 0
        ) return;

        const finishedAt = now();
        const elapsed = Math.max(0, finishedAt - startedAt);
        const configuredModel = getSelectedModel(execution.config, execution.service, message.modelOverride);
        const records: TranslationModelUsageRecord[] = observations.map((observation) => ({
            ...observation,
            startedAt: typeof observation.startedAt === 'number' && Number.isFinite(observation.startedAt)
                ? observation.startedAt
                : startedAt,
            durationMs: typeof observation.durationMs === 'number' && Number.isFinite(observation.durationMs)
                ? Math.max(0, observation.durationMs)
                : observations.length === 1 ? elapsed : 0,
            serviceId: execution.service,
            configuredModel,
            actualModel: cleanModelName(observation.actualModel),
            purpose: modelUsagePurpose(message),
            outcome: observation.outcome ?? fallbackOutcome,
        }));

        try {
            await deps.recordModelUsage(records, generation);
        } catch (error) {
            warn('[FluentRead] model usage write failed:', error);
        }
    }

    async function callProviderWithinDeadline(
        execution: TranslationRequestExecution,
        message: TranslationRequestMessage,
    ): Promise<unknown> {
        const provider = getTranslationService(execution.service);
        const timeoutMs = normalizeDeadlineTimeoutMs(message.requestTimeoutMs as number);
        const startedAt = now();
        const usageGeneration = deps.captureModelUsageGeneration?.() ?? 0;
        const observations: TranslationModelUsageObservation[] = [];
        const controller = new AbortController();
        const providerMessage = attachTranslationModelUsageObserver({
            ...message,
            abortSignal: controller.signal,
        }, (observation) => observations.push({...observation}));

        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new TranslationProviderDeadlineError());
            }, timeoutMs);
        });
        const operation = Promise.resolve().then(() => provider(providerMessage));

        try {
            const result = await Promise.race([operation, timeout]);
            clearTimeout(timer!);
            void persistModelUsage(execution, message, observations, startedAt, 'success', usageGeneration);
            return result;
        } catch (error) {
            clearTimeout(timer!);
            const lastObservation = observations.at(-1);
            const errorOutcome = modelUsageOutcome(error);
            const outcome = errorOutcome === 'error' && lastObservation?.statusCode === 408
                ? 'timeout'
                : errorOutcome;
            // Broker 自有 deadline 会先 abort transport；HTTP 408 也可能被第三方适配器先记为普通失败。
            // 两者都校准为 timeout，避免同一种超时被拆成不同统计口径。
            // 不覆盖更早的 success：批量下一项可能在真正 fetch 前就耗尽预算。
            if (
                outcome === 'timeout'
                && (lastObservation?.outcome === 'cancelled' || lastObservation?.outcome === 'error')
            ) {
                lastObservation.outcome = 'timeout';
            }
            void persistModelUsage(execution, message, observations, startedAt, outcome, usageGeneration);
            throw error;
        }
    }

    function shouldRecoverPageContextLeak(
        execution: TranslationRequestExecution,
        origin: string,
        result: string,
        pageContext: string,
        modelOverride?: string,
    ): boolean {
        return Boolean(pageContext.trim())
            && isAIContextEnabled(execution.config, execution.service, modelOverride)
            && isLikelyPageContextLeak(origin, result, pageContext);
    }

    function isDefiniteRecoveryPageContextLeak(
        execution: TranslationRequestExecution,
        origin: string,
        result: string,
        pageContext: string,
        modelOverride?: string,
    ): boolean {
        return Boolean(pageContext.trim())
            && isAIContextEnabled(execution.config, execution.service, modelOverride)
            && isDefinitePageContextLeak(origin, result, pageContext);
    }

    async function callSingleProviderWithoutPageContext(
        execution: TranslationRequestExecution,
        message: TranslationSingleRequestMessage,
        requestDeadline: number,
        validationPageContext = '',
    ): Promise<string> {
        const result = requireSingleResult(await callProviderWithinDeadline(
            execution,
            applyRemainingDeadline({...message, context: '', pageContext: ''}, requestDeadline),
        ));
        if (isDefiniteRecoveryPageContextLeak(
            execution,
            message.origin,
            result,
            validationPageContext,
            message.modelOverride,
        )) throw new AIContextRecoveryResponseError();
        return result;
    }

    async function callSingleProviderWithContextRecovery(
        execution: TranslationRequestExecution,
        message: TranslationSingleRequestMessage,
        context: string,
        pageContext: string,
        requestDeadline: number,
    ): Promise<string> {
        const result = requireSingleResult(await callProviderWithinDeadline(
            execution,
            applyRemainingDeadline({...message, context, pageContext}, requestDeadline),
        ));
        if (!shouldRecoverPageContextLeak(
            execution,
            message.origin,
            result,
            pageContext,
            message.modelOverride,
        )) return result;

        warn(
            '[FluentRead] AI page context leaked into translation; retrying once without page context:',
            new Error('AI_PAGE_CONTEXT_LEAK'),
        );
        return callSingleProviderWithoutPageContext(execution, message, requestDeadline, pageContext);
    }

    async function callPromptBasedAIBatch(
        execution: TranslationRequestExecution,
        message: TranslationBatchRequestMessage,
        context: string,
        pageContext: string,
        requestDeadline: number,
        startWithoutPageContext: boolean,
    ): Promise<string[]> {
        if (message.origin.length === 1) {
            const singleMessage = {...message, origin: message.origin[0] ?? ''};
            return [startWithoutPageContext
                ? await callSingleProviderWithoutPageContext(
                    execution,
                    singleMessage,
                    requestDeadline,
                    pageContext,
                )
                : await callSingleProviderWithContextRecovery(
                    execution,
                    singleMessage,
                    context,
                    pageContext,
                    requestDeadline,
                )];
        }

        const packet = serializeTranslationSlots(message.origin);
        const requestContext = startWithoutPageContext ? '' : context;
        const requestPageContext = startWithoutPageContext ? '' : pageContext;
        const requestBatch = async (nextContext: string, nextPageContext: string): Promise<string> => (
            requireSingleResult(await callProviderWithinDeadline(
                execution,
                applyRemainingDeadline({
                    ...message,
                    origin: packet.payload,
                    context: nextContext,
                    pageContext: nextPageContext,
                }, requestDeadline),
            ))
        );

        let usedContextFreeRequest = startWithoutPageContext;
        let rawResult = await requestBatch(requestContext, requestPageContext);
        if (shouldRecoverPageContextLeak(
            execution,
            packet.payload,
            rawResult,
            requestPageContext,
            message.modelOverride,
        )) {
            warn(
                '[FluentRead] AI page context leaked into multi-segment translation; retrying once without page context:',
                new Error('AI_PAGE_CONTEXT_LEAK'),
            );
            rawResult = await requestBatch('', '');
            usedContextFreeRequest = true;
            if (isDefiniteRecoveryPageContextLeak(
                execution,
                packet.payload,
                rawResult,
                pageContext,
                message.modelOverride,
            )) throw new AIContextRecoveryResponseError();
        }

        if (rawResult.trim() === packet.payload.trim()) {
            throw new AIMultiSegmentResponseError();
        }

        const parsed = parseTranslationSlots(packet, rawResult);
        if (!parsed || parsed.length !== message.origin.length
            || parsed.some((value, index) => !value.trim() && Boolean(message.origin[index]?.trim()))) {
            throw new AIMultiSegmentResponseError();
        }
        const nonEmptyIndexes = message.origin
            .map((origin, index) => origin.trim() ? index : -1)
            .filter((index) => index >= 0);
        if (nonEmptyIndexes.length > 0 && nonEmptyIndexes.every((index) => (
            normalizeTranslationComparable(parsed[index] ?? '')
                === normalizeTranslationComparable(message.origin[index] ?? '')
        ))) throw new AIMultiSegmentResponseError();

        // 若协议完整但只有个别段落误译了页面上下文，只对这些段落做极简单段重译，
        // 已正确的同批结果继续复用，避免整批再次消耗。
        for (let index = 0; index < parsed.length; index += 1) {
            const origin = message.origin[index] ?? '';
            const leakedPageContext = shouldRecoverPageContextLeak(
                execution,
                origin,
                parsed[index] ?? '',
                pageContext,
                message.modelOverride,
            );
            if (!leakedPageContext) continue;
            if (usedContextFreeRequest) {
                if (isDefiniteRecoveryPageContextLeak(
                    execution,
                    origin,
                    parsed[index] ?? '',
                    pageContext,
                    message.modelOverride,
                )) throw new AIContextRecoveryResponseError();
                continue;
            }
            parsed[index] = await callSingleProviderWithoutPageContext(
                execution,
                {...message, origin},
                requestDeadline,
                pageContext,
            );
        }
        return parsed;
    }

    async function callBatchProviderWithContextRecovery(
        execution: TranslationRequestExecution,
        message: TranslationBatchRequestMessage,
        context: string,
        pageContext: string,
        requestDeadline: number,
        startWithoutPageContext = false,
    ): Promise<string[]> {
        const promptBasedAI = isPromptBasedAI(
            execution.config,
            execution.service,
            message.modelOverride,
        );
        if (message.aiMultiSegment === true && promptBasedAI) {
            return callPromptBasedAIBatch(
                execution,
                message,
                context,
                pageContext,
                requestDeadline,
                startWithoutPageContext,
            );
        }
        const results = requireBatchResult(
            await callProviderWithinDeadline(
                execution,
                applyRemainingDeadline({
                    ...message,
                    context: startWithoutPageContext ? '' : context,
                    pageContext: startWithoutPageContext ? '' : pageContext,
                }, requestDeadline),
            ),
            message.origin.length,
        );
        if (!promptBasedAI) return results;

        for (let index = 0; index < results.length; index += 1) {
            const origin = message.origin[index] ?? '';
            const leakedPageContext = shouldRecoverPageContextLeak(
                execution,
                origin,
                results[index] ?? '',
                pageContext,
                message.modelOverride,
            );
            if (!leakedPageContext) continue;
            if (startWithoutPageContext) {
                if (isDefiniteRecoveryPageContextLeak(
                    execution,
                    origin,
                    results[index] ?? '',
                    pageContext,
                    message.modelOverride,
                )) throw new AIContextRecoveryResponseError();
                continue;
            }
            results[index] = await callSingleProviderWithoutPageContext(
                execution,
                {...message, origin},
                requestDeadline,
                pageContext,
            );
        }
        return results;
    }

    function buildPageSummaryCacheKey(
        execution: TranslationRequestExecution,
        pageContext: string,
        modelOverride?: string,
    ): string {
        const {config: current, service} = execution;
        return deps.buildTranslationCacheKey({
            requestMode: 'page-summary',
            sourceLanguage: current.from,
            targetLanguage: '',
            sourceText: pageContext,
            service,
            model: getSelectedModel(current, service, modelOverride),
            endpoint: getProviderEndpoint(current, service),
            customBody: current.customBody[service] || '',
            transportProfile: deps.serviceTypes.isAiSdk(service)
                ? deps.endpointResolver.aiSdkTransportProfile
                : undefined,
        });
    }

    function cachePageSummary(key: string, value: string): void {
        if (pageSummaryCache.size >= PAGE_SUMMARY_CACHE_SIZE) {
            const oldestKey = pageSummaryCache.keys().next().value;
            if (oldestKey) pageSummaryCache.delete(oldestKey);
        }
        pageSummaryCache.set(key, value);
    }

    async function writeCacheIfCurrent(generation: number, key: string, value: string): Promise<void> {
        if (generation !== cacheGeneration) return;

        const write = Promise.resolve(deps.cache.set(key, value));
        pendingCacheWrites.set(write, generation);
        try {
            await write;
        } finally {
            pendingCacheWrites.delete(write);
        }
    }

    function scheduleCacheWrite(generation: number, key: string, value: string): void {
        // 缓存是旁路优化：写入仍参与 generation/clear 纪律，但不能阻塞成功译文或摘要正文。
        void writeCacheIfCurrent(generation, key, value).catch((error) => {
            warn('[FluentRead] translation cache write failed:', error);
        });
    }

    async function addPageSummary(
        execution: TranslationRequestExecution,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestDeadline: number,
        modelOverride?: string,
        requestTimeoutMs?: number,
    ): Promise<string> {
        if (!isAIContextEnabled(execution.config, execution.service, modelOverride) || !pageContext.trim()) return '';

        const key = buildPageSummaryCacheKey(execution, pageContext, modelOverride);
        if (useCache) {
            const cached = pageSummaryCache.get(key);
            if (cached) return cached;
        }

        const summaryTimeoutMs = normalizeDeadlineTimeoutMs(requestTimeoutMs as number);
        const pendingKey = `${buildPendingRequestKey(key, summaryTimeoutMs)}:cache:${useCache ? 'on' : 'off'}`;
        const existing = pendingPageSummaries.get(pendingKey);
        if (existing) return runWithinDeadline(() => existing, requestDeadline);

        const request = (async () => {
            try {
                // 步骤 1：先读持久缓存，覆盖 MV3 service worker 重启后的重复摘要。
                if (useCache) {
                    const persisted = await runWithinDeadline(() => deps.cache.get(key), requestDeadline);
                    if (persisted !== null) {
                        if (requestGeneration === cacheGeneration) cachePageSummary(key, persisted);
                        return persisted;
                    }
                }

                // 步骤 2：缓存未命中时生成短摘要，失败时回退到原始上下文。
                const remainingTotalMs = getRemainingDeadlineMs(requestDeadline);
                const providerTimeoutMs = Math.min(summaryTimeoutMs, remainingTotalMs);
                const result = await callProviderWithinDeadline(
                    execution,
                    attachTranslationProviderConfig({
                        origin: '',
                        context: '',
                        pageContext: '',
                        summaryPrompt: deps.promptBuilder.buildPageSummaryPrompt(pageContext),
                        summarySystemPrompt: deps.promptBuilder.buildPageSummarySystemPrompt(),
                        serviceOverride: execution.service,
                        sourceLanguage: execution.sourceLanguage,
                        targetLanguage: execution.targetLanguage,
                        modelOverride,
                        requestTimeoutMs: providerTimeoutMs,
                    }, execution.config),
                );
                const summary = typeof result === 'string' ? result.trim().slice(0, PAGE_SUMMARY_LIMIT) : '';
                if (!summary) {
                    if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, pageContext);
                    return pageContext;
                }

                const summarizedContext = `Page summary (AI-generated reference):\n${summary}\n\n${pageContext}`.slice(0, 4000);
                if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, summarizedContext);
                if (useCache) scheduleCacheWrite(requestGeneration, key, summarizedContext);
                return summarizedContext;
            } catch (error) {
                warn('[FluentRead] page context summary failed; using extracted context:', error);
                // 超时只是本次摘要预算耗尽，不能把原上下文当成成功摘要缓存，否则同 key 无法重试。
                if (!(error instanceof TranslationProviderDeadlineError)
                    && useCache
                    && requestGeneration === cacheGeneration) {
                    cachePageSummary(key, pageContext);
                }
                return pageContext;
            }
        })();

        pendingPageSummaries.set(pendingKey, request);
        // addPageSummary 内部把 provider/cache/logger 失败都降级为原始上下文，因此该 Promise 只会 fulfilled。
        void request.then(() => {
            if (pendingPageSummaries.get(pendingKey) === request) pendingPageSummaries.delete(pendingKey);
        });
        return request;
    }

    async function translateSingleWithCache(
        execution: TranslationRequestExecution,
        message: TranslationSingleRequestMessage,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestDeadline: number,
        pendingBudgetMs: number,
    ): Promise<string> {
        if (!useCache) {
            return callSingleProviderWithContextRecovery(
                execution,
                message,
                context,
                pageContext,
                requestDeadline,
            );
        }

        const key = buildCacheKey(execution, message.origin, context, pageContext, 'single', message.modelOverride);
        const pendingKey = buildPendingRequestKey(key, pendingBudgetMs);
        const existing = pendingTranslations.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            // 步骤 1：先读持久缓存；未命中后只发起一次 provider 请求。
            const cached = await runWithinDeadline(() => deps.cache.get(key), requestDeadline);
            if (cached !== null) {
                getRemainingDeadlineMs(requestDeadline);
                // 缓存中的软重合可能是已经经过无上下文复验的合法译名；
                // 只用明确边界/长复制信号否定旧缓存，避免每次都重译。
                const leakedPageContext = isDefiniteRecoveryPageContextLeak(
                    execution,
                    message.origin,
                    cached,
                    pageContext,
                    message.modelOverride,
                );
                if (isCacheableResult(message.origin, cached) && !leakedPageContext) return cached;

                const recovered = leakedPageContext
                    ? await callSingleProviderWithoutPageContext(
                        execution,
                        message,
                        requestDeadline,
                        pageContext,
                    )
                    : await callSingleProviderWithContextRecovery(
                        execution,
                        message,
                        context,
                        pageContext,
                        requestDeadline,
                    );
                if (isCacheableResult(message.origin, recovered)) {
                    scheduleCacheWrite(requestGeneration, key, recovered);
                }
                return recovered;
            }

            const result = await callSingleProviderWithContextRecovery(
                execution,
                message,
                context,
                pageContext,
                requestDeadline,
            );
            if (isCacheableResult(message.origin, result)) {
                scheduleCacheWrite(requestGeneration, key, result);
            }
            return result;
        })();

        pendingTranslations.set(pendingKey, request);
        void request.then(
            () => {
                if (pendingTranslations.get(pendingKey) === request) pendingTranslations.delete(pendingKey);
            },
            () => {
                if (pendingTranslations.get(pendingKey) === request) pendingTranslations.delete(pendingKey);
            },
        );
        return request;
    }

    async function translateBatchWithCache(
        execution: TranslationRequestExecution,
        message: TranslationBatchRequestMessage,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestDeadline: number,
        pendingBudgetMs: number,
    ): Promise<string[]> {
        if (!useCache) {
            return callBatchProviderWithContextRecovery(
                execution,
                message,
                context,
                pageContext,
                requestDeadline,
            );
        }

        const cacheMode: CacheRequestMode = message.aiMultiSegment === true
            ? 'ai-multi-segment'
            : 'batch';
        const batchKey = buildCacheKey(
            execution,
            message.origin,
            context,
            pageContext,
            cacheMode,
            message.modelOverride,
        );
        const pendingKey = buildPendingRequestKey(batchKey, pendingBudgetMs);
        const existing = pendingBatches.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            // 步骤 1：分项读取缓存，只把缺失且去重后的原文交给 provider。
            const cached = await runWithinDeadline(
                () => Promise.all(message.origin.map((origin, index) => deps.cache.get(
                    buildBatchItemCacheKey(
                        execution,
                        origin,
                        index,
                        message.origin,
                        context,
                        pageContext,
                        cacheMode,
                        message.modelOverride,
                    ),
                ))),
                requestDeadline,
            );
            const leakedCachedIndexes = new Set<number>();
            const validatedCached = cached.map((value, index) => {
                if (value === null || !isCacheableResult(message.origin[index] ?? '', value)) return null;
                if (!isDefiniteRecoveryPageContextLeak(
                    execution,
                    message.origin[index] ?? '',
                    value,
                    pageContext,
                    message.modelOverride,
                )) return value;
                leakedCachedIndexes.add(index);
                return null;
            });
            const missingIndexes = validatedCached
                .map((value, index) => value === null ? index : -1)
                .filter((index) => index >= 0);

            if (missingIndexes.length === 0) {
                getRemainingDeadlineMs(requestDeadline);
                return validatedCached as string[];
            }

            const missingEntries = missingIndexes.map((index) => ({index, origin: message.origin[index]}));
            const normalMissingIndexes = missingIndexes.filter((index) => !leakedCachedIndexes.has(index));
            if (cacheMode === 'ai-multi-segment' && normalMissingIndexes.length > 0) {
                // AI 合批的邻段本身就是翻译输入。只要有普通 miss，必须用完整原批次重算，
                // 否则“完整批次指纹”会缓存一份实际没看到邻段的结果。
                const translated = await callBatchProviderWithContextRecovery(
                    execution,
                    message,
                    context,
                    pageContext,
                    requestDeadline,
                );
                translated.forEach((value, index) => {
                    const origin = message.origin[index] ?? '';
                    if (!isCacheableResult(origin, value)) return;
                    scheduleCacheWrite(
                        requestGeneration,
                        buildBatchItemCacheKey(
                            execution,
                            origin,
                            index,
                            message.origin,
                            context,
                            pageContext,
                            cacheMode,
                            message.modelOverride,
                        ),
                        value,
                    );
                });
                return translated;
            }
            const translatedByKey = new Map<string, string>();
            const groups = [
                {
                    entries: missingEntries.filter(({index}) => !leakedCachedIndexes.has(index)),
                    startWithoutPageContext: false,
                },
                {
                    entries: missingEntries.filter(({index}) => leakedCachedIndexes.has(index)),
                    startWithoutPageContext: true,
                },
            ];
            for (const group of groups) {
                if (group.entries.length === 0) continue;
                const uniqueEntries = [...new Map(group.entries.map(({origin, index}) => [
                    buildBatchItemCacheKey(
                        execution,
                        origin,
                        index,
                        message.origin,
                        context,
                        pageContext,
                        cacheMode,
                        message.modelOverride,
                    ),
                    origin,
                ])).entries()];
                const uniqueOrigins = uniqueEntries.map(([, origin]) => origin);
                const translated = await callBatchProviderWithContextRecovery(
                    execution,
                    {...message, origin: uniqueOrigins},
                    context,
                    pageContext,
                    requestDeadline,
                    group.startWithoutPageContext,
                );
                uniqueEntries.forEach(([key], index) => {
                    translatedByKey.set(key, translated[index] ?? '');
                });
            }

            // 步骤 2：按原请求顺序回填结果，并只缓存有效译文。
            const result = [...validatedCached] as Array<string | null>;
            missingEntries.forEach(({index, origin}) => {
                const itemKey = buildBatchItemCacheKey(
                    execution,
                    origin,
                    index,
                    message.origin,
                    context,
                    pageContext,
                    cacheMode,
                    message.modelOverride,
                );
                const value = translatedByKey.get(itemKey);
                result[index] = value as string;
                if (isCacheableResult(origin, value)) {
                    scheduleCacheWrite(
                        requestGeneration,
                        itemKey,
                        value,
                    );
                }
            });

            return result as string[];
        })();

        pendingBatches.set(pendingKey, request);
        void request.then(
            () => {
                if (pendingBatches.get(pendingKey) === request) pendingBatches.delete(pendingKey);
            },
            () => {
                if (pendingBatches.get(pendingKey) === request) pendingBatches.delete(pendingKey);
            },
        );
        return request;
    }

    async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
        // 空请求没有 provider 语义，也不应被配置水合阻塞。
        if (Array.isArray(message.origin) && message.origin.length === 0) return [];
        if (typeof message.origin === 'string' && !message.origin.trim()) return message.origin;

        // deadline 从公开入口开始计时，配置水合不能让上层剩余预算重新获得完整时长。
        const providerStartedAt = now();
        const isRemainingBudget = (message as TranslationRequestMessage & TranslationRemainingBudgetContext)
            [TRANSLATION_REMAINING_BUDGET] === true;
        const providerBudget = (isRemainingBudget
            ? normalizeDeadlineTimeoutMs(message.requestTimeoutMs as number)
            : normalizeExternalRequestTimeoutMs(message.requestTimeoutMs)) ?? DEFAULT_PROVIDER_TIMEOUT_MS;
        const providerDeadline = providerStartedAt + providerBudget;
        await runWithinDeadline(() => deps.ready, providerDeadline);

        const requestGeneration = cacheGeneration;

        // 步骤 1：在任何 cache/provider await 前复制一次配置；后续 UI 原地修改不能改变本请求身份。
        const current = createTranslationProviderConfigSnapshot(config());
        const serviceOverride = message.serviceOverride;
        const selectedService = serviceOverride || current.service;
        const {sourceLanguage, targetLanguage} = deps.getTranslationLanguages({
            sourceLanguage: message.sourceLanguage?.trim() || current.from,
            targetLanguage: message.targetLanguage?.trim() || current.to,
        });
        const execution: TranslationRequestExecution = {
            config: current,
            service: selectedService,
            sourceLanguage,
            targetLanguage,
        };
        const credentialConfig = message.modelOverride
            ? {
                ...current,
                model: {...current.model, [selectedService]: message.modelOverride},
                customModel: {...current.customModel, [selectedService]: message.modelOverride},
            }
            : current;
        const missingCredentialMessage = deps.getMissingCredentialMessage(selectedService, credentialConfig);
        if (missingCredentialMessage) throw new Error(missingCredentialMessage);
        if (serviceOverride && !deps.serviceTypes.machine.has(serviceOverride) && !deps.serviceTypes.isAI(serviceOverride)) {
            throw new Error('独立翻译服务不可用，请选择已配置的机器翻译或 AI 服务');
        }

        const context = typeof message.context === 'string' ? message.context : '';
        const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
        const useCache = isCacheEnabled(current, message);
        // 步骤 2：摘要是 AI 上下文增强，只拿 provider deadline 的一小段预算。
        const summaryBudget = Math.min(10_000, Math.max(1_000, Math.floor(providerBudget / 4)));
        const pageContext = await addPageSummary(
            execution,
            rawPageContext,
            useCache,
            requestGeneration,
            providerDeadline,
            message.modelOverride,
            summaryBudget,
        );
        const remainingProviderBudget = getRemainingDeadlineMs(providerDeadline);

        // 步骤 3：把摘要耗时从剩余 provider 请求中扣除，避免后台无限等待。
        const requestMessage = attachTranslationProviderConfig(
            {
                ...message,
                sourceLanguage,
                targetLanguage,
                requestTimeoutMs: remainingProviderBudget,
            } as TranslationRequestMessage,
            current,
        );
        // 步骤 4：根据 origin 类型进入单条或批量管线，两者共享缓存身份与 pending 去重。
        if (Array.isArray(requestMessage.origin)) {
            return translateBatchWithCache(
                execution,
                requestMessage as TranslationBatchRequestMessage,
                context,
                pageContext,
                useCache,
                requestGeneration,
                providerDeadline,
                providerBudget,
            );
        }
        return translateSingleWithCache(
            execution,
            requestMessage as TranslationSingleRequestMessage,
            context,
            pageContext,
            useCache,
            requestGeneration,
            providerDeadline,
            providerBudget,
        );
    }

    async function clearTranslationCache(): Promise<void> {
        // 步骤 1：先切换代次并断开旧请求去重；旧 provider 仍可返回给原调用者，但不能重新填充缓存。
        cacheGeneration += 1;
        pendingTranslations.clear();
        pendingBatches.clear();
        pendingPageSummaries.clear();
        pageSummaryCache.clear();

        // 步骤 2：等待清理开始前已经进入存储适配器的写入，随后再清库，保证成功返回后没有旧写入复活。
        const staleWrites = [...pendingCacheWrites]
            .filter(([, generation]) => generation < cacheGeneration)
            .map(([write]) => write);
        await Promise.allSettled(staleWrites);
        await deps.cache.clear();
        pageSummaryCache.clear();
    }

    async function cleanupTranslationCache(): Promise<void> {
        await deps.cache.cleanup();
    }

    return {
        translateWithCache,
        clearTranslationCache,
        cleanupTranslationCache,
    };
}
