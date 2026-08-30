/**
 * @file src/services/translation/requestSnapshot.ts
 *
 * 文件职责：在翻译消息上附加只读 provider 配置快照，消除异步缓存读取期间全局配置变化造成的请求身份错配。
 * 主要内容：定义配置快照与剩余预算 symbol，精确复制 token、proxy、model、prompt 等字段，并提供 attach/get 函数供 broker 和 provider 共享同一快照。 可核对的公开符号包括 TRANSLATION_PROVIDER_CONFIG、TRANSLATION_REMAINING_BUDGET、TranslationProviderRequestContext、markTranslationRemainingBudget、createTranslationProviderConfigSnapshot、attachTranslationProviderConfig、getTranslationProviderConfig。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

import type {
    TranslationConfigSource,
    TranslationModelUsageObservation,
    TranslationProviderConfigSnapshot,
    TranslationRequestMessageBase,
} from './types';

/** 内部 symbol 无法由 content runtime 消息伪造，也不会进入网络 JSON。 */
export const TRANSLATION_PROVIDER_CONFIG = Symbol('fluentread.translation-provider-config');
export const TRANSLATION_REMAINING_BUDGET = Symbol('fluentread.translation-remaining-budget');
export const TRANSLATION_MODEL_USAGE_OBSERVER = Symbol('fluentread.translation-model-usage-observer');

export type TranslationModelUsageObserver = (observation: TranslationModelUsageObservation) => void;

export type TranslationRemainingBudgetContext = {
    readonly [TRANSLATION_REMAINING_BUDGET]?: true;
};

export type TranslationProviderRequestContext = {
    readonly [TRANSLATION_PROVIDER_CONFIG]?: TranslationProviderConfigSnapshot;
    readonly [TRANSLATION_MODEL_USAGE_OBSERVER]?: TranslationModelUsageObserver;
    /** 仅由 broker 在后台注入；provider 必须向底层 transport 继续传递。 */
    readonly abortSignal?: AbortSignal;
};

/** 把进程内观察器附到 provider 请求；symbol 不会通过 runtime 或 JSON 越过边界。 */
export function attachTranslationModelUsageObserver<T extends object>(
    message: T,
    observer: TranslationModelUsageObserver,
): T & TranslationProviderRequestContext {
    return Object.assign(message, {[TRANSLATION_MODEL_USAGE_OBSERVER]: observer});
}

/** Provider 直调时没有观察器；统计旁路也绝不能让正常翻译失败。 */
export function reportTranslationModelUsage(
    message: unknown,
    observation: TranslationModelUsageObservation,
): void {
    if (!message || typeof message !== 'object') return;
    const observer = (message as TranslationProviderRequestContext)[TRANSLATION_MODEL_USAGE_OBSERVER];
    if (!observer) return;
    try {
        observer(observation);
    } catch {
        // 统计观察器是旁路，不允许反向影响 provider 响应解析。
    }
}

/** 只在 transport 已实际启动后调用；把网络/HTTP/解析失败记为无 usage 的真实尝试。 */
export function reportTranslationModelUsageFailure(
    message: unknown,
    error: unknown,
    startedAt: number,
    actualModel?: string,
    statusCode?: number,
): void {
    const candidateStatus = statusCode ?? (
        error && typeof error === 'object'
            ? (error as {statusCode?: unknown}).statusCode
            : undefined
    );
    const safeStatusCode = typeof candidateStatus === 'number'
        && Number.isInteger(candidateStatus)
        && candidateStatus >= 100
        && candidateStatus <= 599
        ? candidateStatus
        : undefined;
    const aborted = (error instanceof Error && error.name === 'AbortError')
        || Boolean((message as TranslationProviderRequestContext | null)?.abortSignal?.aborted);
    reportTranslationModelUsage(message, {
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(actualModel ? {actualModel} : {}),
        outcome: safeStatusCode === 408 ? 'timeout' : aborted ? 'cancelled' : 'error',
        usageAvailability: 'unreported',
        ...(safeStatusCode !== undefined ? {statusCode: safeStatusCode} : {}),
    });
}

/** 标记 requestTimeoutMs 已是上层事务的剩余预算，broker 不得再次抬高到公开入口下限。 */
export function markTranslationRemainingBudget<T extends {requestTimeoutMs: number}>(
    request: T,
): T & TranslationRemainingBudgetContext {
    Object.defineProperty(request, TRANSLATION_REMAINING_BUDGET, {value: true});
    return request as T & TranslationRemainingBudgetContext;
}

/** Provider 收到的类型化内部请求；在公开翻译消息之上附加配置快照和取消信号。 */
export type TranslationProviderRequest<TOrigin = string | string[]> = TranslationRequestMessageBase
    & TranslationProviderRequestContext
    & {
        origin: TOrigin;
        /** 仅摘要请求使用；普通正文 provider 可忽略。 */
        summaryPrompt?: string;
        summarySystemPrompt?: string;
    };

function frozenStringMap(value: Record<string, string> | undefined): Readonly<Record<string, string>> {
    return Object.freeze({...value});
}

function frozenBooleanMap(value: Record<string, boolean> | undefined): Readonly<Record<string, boolean>> {
    return Object.freeze({...value});
}

/**
 * 在任何 await 之前复制 provider 与缓存身份会读取的字段。嵌套映射和顶层对象
 * 均冻结，配置页后续原地修改不会改变已在途请求。
 */
export function createTranslationProviderConfigSnapshot(
    source: TranslationConfigSource,
): TranslationProviderConfigSnapshot {
    return Object.freeze({
        ...source,
        model: frozenStringMap(source.model),
        customModel: frozenStringMap(source.customModel),
        proxy: frozenStringMap(source.proxy),
        customBody: frozenStringMap(source.customBody),
        system_role: frozenStringMap(source.system_role),
        user_role: frozenStringMap(source.user_role),
        token: frozenStringMap(source.token),
        requireApiKey: frozenBooleanMap(source.requireApiKey),
        youdaoAppKey: source.youdaoAppKey ?? '',
        youdaoAppSecret: source.youdaoAppSecret ?? '',
        tencentSecretId: source.tencentSecretId ?? '',
        tencentSecretKey: source.tencentSecretKey ?? '',
    }) as TranslationProviderConfigSnapshot;
}

export function attachTranslationProviderConfig<T extends object>(
    message: T,
    snapshot: TranslationProviderConfigSnapshot,
): T & TranslationProviderRequestContext {
    return Object.assign(message, {[TRANSLATION_PROVIDER_CONFIG]: snapshot});
}

/** Provider 直调测试保留 fallback；broker 路径始终命中不可伪造的 request snapshot。 */
export function getTranslationProviderConfig(
    message: unknown,
    fallback: TranslationProviderConfigSnapshot,
): TranslationProviderConfigSnapshot {
    if (message && typeof message === 'object') {
        const snapshot = (message as TranslationProviderRequestContext)[TRANSLATION_PROVIDER_CONFIG];
        if (snapshot) return snapshot;
    }
    return fallback;
}
