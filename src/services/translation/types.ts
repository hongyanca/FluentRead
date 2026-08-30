/**
 * @file src/services/translation/types.ts
 *
 * 文件职责：定义翻译 broker、缓存和 provider 之间的端口与消息契约，约束单条、批量、语言和配置快照的数据形状。
 * 主要内容：包含 TranslationRequestMessage、ProviderRegistry、CachePort、ConfigSnapshot、ProviderConfigFields 及 BrokerDependencies/Broker 等接口，为依赖注入和测试替身提供稳定边界。 可核对的公开符号包括 TranslationRequestMessageBase、TranslationSingleRequestMessage、TranslationBatchRequestMessage、TranslationRequestMessage、TranslationProvider、TranslationProviderRegistry、TranslationLanguageOverride、TranslationLanguages。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

export interface TranslationRequestMessageBase {
    context?: string;
    pageContext?: string;
    useCache?: boolean;
    /** 全文翻译内部标记；仅允许通用提示词型 AI 把数组合并为一次上游请求。 */
    aiMultiSegment?: boolean;
    /** 视频字幕、文档等独立入口使用的翻译服务；普通网页请求不设置。 */
    serviceOverride?: string;
    /** 文档、翻译中心等独立入口指定的实际模型；普通网页请求不设置。 */
    modelOverride?: string;
    /** 翻译中心仅对当前请求使用的语言，不改变全局设置。 */
    sourceLanguage?: string;
    targetLanguage?: string;
    /** provider deadline；用于避免可选摘要耗尽整次请求。 */
    requestTimeoutMs?: number;
}

export type TranslationSingleRequestMessage = TranslationRequestMessageBase & {origin: string};
export type TranslationBatchRequestMessage = TranslationRequestMessageBase & {origin: string[]};
export type TranslationRequestMessage = TranslationSingleRequestMessage | TranslationBatchRequestMessage;

export type TranslationProvider = (message: Record<string, unknown>) => Promise<unknown>;
export type TranslationProviderRegistry = Record<string, TranslationProvider>;

export type TranslationModelUsageOutcome = 'success' | 'error' | 'timeout' | 'cancelled';
export type TranslationModelUsageAvailability = 'reported' | 'unreported' | 'malformed';
export type TranslationModelUsagePurpose = 'translation' | 'page-summary' | 'connection-test';

/** Provider 或 transport 对单次真实上游尝试返回的最小、无敏感信息用量观察。 */
export interface TranslationModelUsageObservation {
    startedAt?: number;
    durationMs?: number;
    actualModel?: string;
    outcome?: TranslationModelUsageOutcome;
    usageAvailability: TranslationModelUsageAvailability;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    statusCode?: number;
}

/** Broker 补齐服务、用途和输入规模后交给本地统计仓库的事件。 */
export interface TranslationModelUsageRecord extends TranslationModelUsageObservation {
    startedAt: number;
    durationMs: number;
    serviceId: string;
    configuredModel: string;
    purpose: TranslationModelUsagePurpose;
    outcome: TranslationModelUsageOutcome;
}

export interface TranslationLanguageOverride {
    sourceLanguage?: string;
    targetLanguage?: string;
}

export interface TranslationLanguages {
    sourceLanguage: string;
    targetLanguage: string;
}

export interface TranslationCachePort {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    clear: () => Promise<void>;
    cleanup: () => Promise<void>;
}

export interface TranslationConfigSnapshot {
    service: string;
    from: string;
    to: string;
    useCache: boolean;
    enableAIContext: boolean;
    model: Record<string, string>;
    customModel: Record<string, string>;
    proxy: Record<string, string>;
    custom: string;
    deeplx: string;
    newApiUrl: string;
    minimaxBillingPlan: string;
    minimaxRegion: string;
    mimoBillingPlan: string;
    mimoRegion: string;
    azureOpenaiEndpoint: string;
    customBody: Record<string, string>;
    system_role: Record<string, string>;
    user_role: Record<string, string>;
    deepseekApiType: string;
    deepseekThinkingMode: string;
}

export interface TranslationProviderConfigFields {
    token: Record<string, string>;
    requireApiKey: Record<string, boolean>;
    youdaoAppKey: string;
    youdaoAppSecret: string;
    tencentSecretId: string;
    tencentSecretKey: string;
}

/** 一次 provider 调用使用的完整、不可变配置视图。 */
export type TranslationProviderConfigSnapshot = Readonly<TranslationConfigSnapshot & TranslationProviderConfigFields>;

/** 测试或迁移期配置源可以省略凭据字段，snapshot factory 会补安全默认值。 */
export type TranslationConfigSource = TranslationConfigSnapshot & Partial<TranslationProviderConfigFields>;

export interface TranslationServiceIds {
    minimax: string;
    mimo: string;
}

export interface TranslationServiceTypes {
    machine: {has: (service: string) => boolean};
    isAI: (service: string) => boolean;
    isAiSdk: (service: string) => boolean;
    isUseAIContext: (service: string, model?: string) => boolean;
}

export interface TranslationEndpointResolver {
    resolveOpenAICompatibleEndpoint: (
        service: string,
        config?: TranslationProviderConfigSnapshot,
    ) => {endpoint: string};
    getMimoEndpoint: (plan: string, region: string) => string;
    minimaxEndpoints: Record<string, Record<string, string>>;
    aiSdkTransportProfile: string;
}

export interface TranslationPromptBuilder {
    buildPageSummaryPrompt: (pageContext: string) => string;
    buildPageSummarySystemPrompt: () => string;
}

export interface TranslationBrokerDependencies {
    ready: Promise<unknown>;
    getConfig: () => TranslationConfigSource;
    providers: TranslationProviderRegistry;
    cache: TranslationCachePort;
    serviceIds: TranslationServiceIds;
    serviceTypes: TranslationServiceTypes;
    endpointResolver: TranslationEndpointResolver;
    promptBuilder: TranslationPromptBuilder;
    getMissingCredentialMessage: (service: string, config: TranslationConfigSnapshot) => string | null;
    getTranslationLanguages: (override?: TranslationLanguageOverride) => TranslationLanguages;
    resolveConfiguredModel: (selected?: string, custom?: string) => string;
    buildTranslationCacheKey: (identity: Record<string, unknown>) => string;
    /** 在 provider 真正开始前捕获重置代次，避免清除后在途旧请求把事件写回来。 */
    captureModelUsageGeneration?: () => number;
    /** 本地统计是旁路能力；写入失败或挂起不得改变、延迟翻译结果。 */
    recordModelUsage?: (
        events: readonly TranslationModelUsageRecord[],
        generation: number,
    ) => Promise<void>;
    now?: () => number;
    logger?: Pick<Console, 'warn'>;
}

export interface TranslationBroker {
    translateWithCache: (message: TranslationRequestMessage) => Promise<string | string[]>;
    clearTranslationCache: () => Promise<void>;
    cleanupTranslationCache: () => Promise<void>;
}
