/**
 * @file src/app/background/handlers/configPersistence.ts
 * 文件职责：在后台可信边界接收整份配置替换或字段补丁，规范化客户端身份与序号，并协调串行持久化和响应。
 * 主要内容：声明 persistConfig replace/patch 协议及依赖，校验普通对象、mode、clientId 与非负 sequence，屏蔽同客户端过期序号，共享同序号在途结果并允许失败后重试，最后返回实际提交 revision。
 * 模块边界：这里只处理跨上下文消息和保存编排，不定义 Config 字段、不直接操作 browser.storage，也不负责历史裁剪；校验、凭据拆分和存储事务由注入的配置服务承担。
 */
import type {BackgroundMessageHandler} from '../messageRouter';

export const CONFIG_PERSIST_MESSAGE_TYPE = 'persistConfig' as const;
export type ConfigPersistenceMode = 'replace' | 'patch';

export interface ConfigPersistenceMessage {
    type: typeof CONFIG_PERSIST_MESSAGE_TYPE;
    mode?: unknown;
    config?: unknown;
    expected?: unknown;
    clientId?: unknown;
    sequence?: unknown;
    baseRevision?: unknown;
}

export interface ConfigPersistenceContext {
    sender?: {
        id?: string;
        url?: string;
        frameId?: number;
        tab?: {
            id?: number;
        };
    };
}

export interface ConfigPersistenceResponse {
    success: true;
    revision: number;
}

export interface ConfigMutationCoordinator {
    run<T>(mutation: () => Promise<T>): Promise<T>;
}

/** 所有配置写操作共用一条队列，避免恢复、导入和普通保存交叉落盘。 */
export function createConfigMutationCoordinator(): ConfigMutationCoordinator {
    let queue: Promise<unknown> = Promise.resolve();
    return {
        run<T>(mutation: () => Promise<T>): Promise<T> {
            const result = queue.catch(() => undefined).then(mutation);
            queue = result.then(() => undefined, () => undefined);
            return result;
        },
    };
}

export interface ConfigPersistenceDependencies<TConfig> {
    readonly ready: Promise<void>;
    readonly getCurrentConfig: () => TConfig;
    readonly prepareConfigSaveRequest: (
        incomingConfig: Record<string, unknown>,
        currentConfig: TConfig,
        allowCredentialUpdates: boolean,
    ) => TConfig;
    readonly prepareConfigPatchRequest: (
        incomingPatch: Record<string, unknown>,
        expectedPatch: Record<string, unknown>,
        currentConfig: TConfig,
        allowCredentialUpdates: boolean,
    ) => TConfig;
    readonly saveConfig: (config: TConfig, options: {recordHistory: true}) => Promise<void>;
    readonly isExtensionUrl: (url: string) => boolean;
    readonly getCurrentRevision?: () => number;
    readonly runMutation?: ConfigMutationCoordinator['run'];
}

interface ParsedConfigPersistenceRequest {
    mode: ConfigPersistenceMode;
    config: Record<string, unknown>;
    expected?: Record<string, unknown>;
    clientId: string;
    sequence: number;
    baseRevision?: number;
    allowCredentialUpdates: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fallbackClientId(sender: ConfigPersistenceContext['sender']): string {
    const senderId = sender?.id || 'legacy';
    const tabId = sender?.tab?.id ?? 'extension';
    const frameId = sender?.frameId ?? 0;
    return `${senderId}:${tabId}:${frameId}`;
}

function parseClientId(value: unknown, sender: ConfigPersistenceContext['sender']): string {
    if (value === undefined) return fallbackClientId(sender);
    if (typeof value === 'string' && value.trim()) return value;
    throw new TypeError('配置保存 clientId 必须是非空字符串');
}

function parseSequence(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    throw new TypeError('配置保存 sequence 必须是非负安全整数');
}

function parseBaseRevision(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    throw new TypeError('配置保存 baseRevision 必须是非负安全整数');
}

function parsePersistenceMode(value: unknown): ConfigPersistenceMode {
    if (value === undefined || value === 'replace') return 'replace';
    if (value === 'patch') return 'patch';
    throw new TypeError('配置保存 mode 必须是 replace 或 patch');
}

function parseExpectedPatch(value: unknown, mode: ConfigPersistenceMode): Record<string, unknown> | undefined {
    if (mode === 'replace') return undefined;
    if (!isPlainRecord(value)) throw new TypeError('配置 patch 缺少有效 expected');
    return value;
}

function parseConfigPersistenceMessage(
    message: ConfigPersistenceMessage,
    context: ConfigPersistenceContext,
    isExtensionUrl: (url: string) => boolean,
): ParsedConfigPersistenceRequest {
    if (!isPlainRecord(message.config)) throw new TypeError('配置保存 payload 缺少有效 config');

    // 步骤 1：clientId/sequence 是 latest-write-wins 的身份和版本边界。
    const clientId = parseClientId(message.clientId, context.sender);
    const sequence = parseSequence(message.sequence);

    // 步骤 2：只有扩展自身页面可以更新凭据；content/page 消息只能保存公开字段。
    const senderUrl = typeof context.sender?.url === 'string' ? context.sender.url : '';
    const mode = parsePersistenceMode(message.mode);
    return {
        mode,
        config: message.config,
        expected: parseExpectedPatch(message.expected, mode),
        clientId,
        sequence,
        baseRevision: parseBaseRevision(message.baseRevision),
        allowCredentialUpdates: isExtensionUrl(senderUrl),
    };
}

/** 创建配置持久化 handler；队列状态封装在 handler 实例内，避免 background 暴露全局可变状态。 */
export function createConfigPersistenceHandler<TConfig>(
    dependencies: ConfigPersistenceDependencies<TConfig>,
): BackgroundMessageHandler<ConfigPersistenceContext, ConfigPersistenceMessage, ConfigPersistenceResponse> {
    let persistQueue: Promise<void> = Promise.resolve();
    const latestSequenceByClient = new Map<string, number>();
    const committedSequenceByClient = new Map<string, number>();
    const activeSequenceByClient = new Map<string, {sequence: number; result: Promise<number>}>();
    const localCoordinator = createConfigMutationCoordinator();
    const runMutation = dependencies.runMutation || localCoordinator.run;

    return {
        type: CONFIG_PERSIST_MESSAGE_TYPE,
        async handle(message, context) {
            const request = parseConfigPersistenceMessage(message, context, dependencies.isExtensionUrl);
            if (request.sequence) {
                const committedSequence = committedSequenceByClient.get(request.clientId) || 0;
                if (request.sequence <= committedSequence) {
                    return {success: true, revision: dependencies.getCurrentRevision?.() ?? 0};
                }

                const latestSequence = latestSequenceByClient.get(request.clientId) || 0;
                if (request.sequence < latestSequence) {
                    return {success: true, revision: dependencies.getCurrentRevision?.() ?? 0};
                }
                const active = activeSequenceByClient.get(request.clientId);
                if (request.sequence === latestSequence && active?.sequence === request.sequence) {
                    return {success: true, revision: await active.result};
                }
                if (request.sequence > latestSequence) {
                    latestSequenceByClient.set(request.clientId, request.sequence);
                }
            }

            const persist = persistQueue
                .catch(() => undefined)
                .then(() => runMutation(async () => {
                    // 步骤 1：队列轮到当前请求时再判断它是否仍是该 client 的最新序列。
                    if (request.sequence && latestSequenceByClient.get(request.clientId) !== request.sequence) {
                        return dependencies.getCurrentRevision?.() ?? 0;
                    }
                    await dependencies.ready;

                    const currentRevision = dependencies.getCurrentRevision?.();
                    if (request.mode === 'replace'
                        && request.baseRevision !== undefined
                        && currentRevision !== undefined
                        && request.baseRevision !== currentRevision) {
                        throw new Error(`配置已更新（当前 revision ${currentRevision}），请同步后重试`);
                    }

                    // 步骤 2：使用注入的 prepare/save 保持凭据策略、规范化和历史记录行为。
                    const currentConfig = dependencies.getCurrentConfig();
                    const prepared = request.mode === 'patch'
                        ? dependencies.prepareConfigPatchRequest(
                            request.config,
                            request.expected!,
                            currentConfig,
                            request.allowCredentialUpdates,
                        )
                        : dependencies.prepareConfigSaveRequest(
                            request.config,
                            currentConfig,
                            request.allowCredentialUpdates,
                        );
                    await dependencies.saveConfig(prepared, {recordHistory: true});
                    if (request.sequence) {
                        committedSequenceByClient.set(request.clientId, Math.max(
                            committedSequenceByClient.get(request.clientId) || 0,
                            request.sequence,
                        ));
                    }
                    // 必须在同一个 mutation 临界区内捕获本次提交 revision；释放队列后
                    // 其他恢复可能立刻推进全局 revision，不能把它误报成本请求的版本。
                    return dependencies.getCurrentRevision?.() ?? 0;
                }));
            persistQueue = persist.then(() => undefined, () => undefined);
            const active = request.sequence ? {sequence: request.sequence, result: persist} : null;
            if (active) activeSequenceByClient.set(request.clientId, active);
            try {
                const committedRevision = await persist;
                return {success: true, revision: committedRevision};
            } finally {
                if (activeSequenceByClient.get(request.clientId) === active) {
                    activeSequenceByClient.delete(request.clientId);
                }
            }
        },
    };
}
