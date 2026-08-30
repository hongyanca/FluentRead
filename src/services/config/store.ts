/**
 * @file src/services/config/store.ts
 *
 * 文件职责：协调 FluentRead 配置、凭据与历史记录在后台加密配置仓库中的读取、订阅、保存和并发持久化。
 * 主要内容：维护 config 响应式状态和监听器，区分公开配置与加密持久凭据，串行发送整份替换或字段级 patch，处理乐观更新回滚、revision 冲突、旧会话凭据迁移、历史 debounce 及 undo/redo 请求。
 * 模块边界：本文件位于配置 application service 层，可协调 core 规则与浏览器存储端口；不包含设置页面组件，也不实现具体翻译供应商协议，调用方应通过公开服务 API 订阅或提交配置。
 */

import {configStorage as storage} from '@/src/platform/storage/configStorageRuntime';
import { Config, normalizeConfig } from '@/src/core/config/model';
import {
    CONFIG_CREDENTIAL_FIELDS,
    LOCAL_CREDENTIALS_STORAGE_KEY,
    SESSION_CREDENTIALS_STORAGE_KEY,
    credentialsEqual,
    extractConfigCredentials,
    hasCredentialData,
    hasCredentialFields,
    mergeConfigCredentials,
    parseStoredCredentials,
    sanitizeConfigCredentials,
    sanitizeConfigHistoryCredentials,
    type ConfigCredentials,
} from '@/src/core/config/credentials';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';
import {
    CONFIG_HISTORY_LIMIT,
    appendConfigHistorySnapshot,
    cloneConfigHistory,
    createBaselineConfigHistory,
    parseConfigHistory,
    restoreRestorableConfig,
    resolveConfigHistoryTargetIndex,
    serializeConfigHistory,
    toPublicConfig,
    toRestorableConfig,
    type ConfigHistoryAction,
    type ConfigHistoryState,
    type RestorableConfig,
} from './history';
import {
    CONFIG_REVISION_FIELD,
    getStoredConfigRevision,
    isConfigRecord,
    parseStoredConfig,
    serializeConfig,
} from './schema';
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
    parseConfigCountOperationId,
} from './count';

export {CONFIG_HISTORY_LIMIT, parseStoredConfig, serializeConfig};
export type {ConfigHistoryAction, ConfigHistoryEntry, ConfigHistoryState} from './history';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;

type ConfigListener = (nextConfig: Config) => void;

type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;

const listeners = new Set<ConfigListener>();
const historyListeners = new Set<ConfigHistoryListener>();
let storageRevision = 0;
let initialized = false;
let lastPersistedSerialized = '';
let writeRevision = 0;
let writeQueue: Promise<void> = Promise.resolve();
let latestRequestedSerialized = '';
let latestRequestedMode: ConfigPersistenceMode | null = null;
let persistedConfigRevision = 0;
let requestSequence = 0;
let requestGeneration = 0;
let requestQueue: Promise<void> = Promise.resolve();
let lastEnqueuedRemoteRequestSequence = 0;
let lastCommittedRemoteRequestSequence = 0;
let lastCommittedRemoteRequestRevision = 0;
let lastCommittedRemoteRequestGeneration = -1;
let lastCommittedRemoteRequestMode: ConfigPersistenceMode | null = null;
let activeRequestSerialized = '';
let hasDeferredStoredConfigChange = false;
let deferredStoredConfigChange: unknown;
const completedCountOperations = new Map<string, {delta: number; count: number}>();
const activeCountOperations = new Map<string, {delta: number; promise: Promise<number>}>();
const CONFIG_COUNT_OPERATION_CACHE_LIMIT = 1_024;
const CONFIG_COUNT_OPERATIONS_FIELD = '__fluentCountOperations' as const;
const CONFIG_PATCH_PROTECTED_FIELDS = new Set<string>([
    'count',
    'videoServiceDefaultMigrated',
]);
const CONFIG_KNOWN_FIELDS = new Set<string>(Object.keys(new Config()));
const CONFIG_CREDENTIAL_FIELD_SET = new Set<string>(CONFIG_CREDENTIAL_FIELDS);
const requestClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let historyState: ConfigHistoryState;
let historyInitialized = false;
let historyLastSerialized = '';
let historyPendingSerialized = '';
let historyWriteRevision = 0;
let historyWriteQueue: Promise<void> = Promise.resolve();
let pendingHistorySnapshot: RestorableConfig | null = null;
let pendingHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let historyFlushPromise: Promise<void> | null = null;

type ConfigPersistenceMode = 'replace' | 'patch';

// 所有运行时模块共享同一个可变配置对象；存储层负责把跨上下文变更同步进来。
export const config = new Config();

interface PersistedCountOperation {
    id: string;
    delta: number;
    count: number;
}

function parsePersistedCountOperations(value: unknown): PersistedCountOperation[] | null {
    const record = parseStoredConfig(value);
    const rawOperations = record?.[CONFIG_COUNT_OPERATIONS_FIELD];
    if (!Array.isArray(rawOperations)) return null;

    const operations: PersistedCountOperation[] = [];
    for (const value of rawOperations.slice(-CONFIG_COUNT_OPERATION_CACHE_LIMIT)) {
        if (!value || typeof value !== 'object') continue;
        const candidate = value as Partial<PersistedCountOperation>;
        const id = parseConfigCountOperationId(candidate.id);
        const delta = parseConfigCountIncrement(candidate.delta);
        if (!id || delta === null || !Number.isSafeInteger(candidate.count) || Number(candidate.count) < delta) continue;
        operations.push({id, delta, count: Number(candidate.count)});
    }
    return operations;
}

function replaceCompletedCountOperations(operations: PersistedCountOperation[], maximumCount: number): void {
    completedCountOperations.clear();
    for (const operation of operations) {
        if (operation.count <= maximumCount) {
            completedCountOperations.set(operation.id, {delta: operation.delta, count: operation.count});
        }
    }
}

function getPersistedCountOperations(nextOperation?: PersistedCountOperation): PersistedCountOperation[] {
    const operations = [...completedCountOperations].map(([id, value]) => ({id, ...value}));
    if (nextOperation) {
        const existingIndex = operations.findIndex((operation) => operation.id === nextOperation.id);
        if (existingIndex >= 0) operations.splice(existingIndex, 1);
        operations.push(nextOperation);
    }
    return operations.slice(-CONFIG_COUNT_OPERATION_CACHE_LIMIT);
}

function createStoredConfigRecord(
    nextConfig: Config,
    revision: number,
    countOperations = getPersistedCountOperations(),
): Record<string, unknown> {
    return {
        ...toPublicConfig(nextConfig),
        [CONFIG_REVISION_FIELD]: revision,
        ...(trustedCredentialStorageContext && countOperations.length > 0
            ? {[CONFIG_COUNT_OPERATIONS_FIELD]: countOperations}
            : {}),
    };
}

function notifyHistoryListeners(): void {
    if (!historyState) return;
    const snapshot = cloneConfigHistory(historyState);
    historyListeners.forEach((listener) => listener(snapshot));
}

function setHistoryState(nextHistory: ConfigHistoryState, notify = true): void {
    historyState = cloneConfigHistory(nextHistory);
    historyLastSerialized = serializeConfigHistory(historyState);
    if (notify) notifyHistoryListeners();
}

function handleStoredHistoryChange(value: unknown): void {
    const parsed = parseConfigHistory(value);
    if (!parsed) return;
    const serialized = serializeConfigHistory(parsed);
    if (serialized === historyLastSerialized) return;
    // 步骤 1：写队列处理中只接收最新请求的回声，避免较慢的旧写入覆盖新快照。
    if (historyPendingSerialized && serialized !== historyPendingSerialized) return;

    // 步骤 2：外部上下文没有与本地写入竞争时，立即同步历史游标和订阅者。
    setHistoryState(parsed);
}

async function queueHistoryWrite(nextHistory: ConfigHistoryState): Promise<void> {
    const sanitizedHistory = cloneConfigHistory(nextHistory);
    const serialized = serializeConfigHistory(sanitizedHistory);
    if (!historyPendingSerialized && serialized === historyLastSerialized) return;
    if (serialized === historyPendingSerialized) return;

    historyPendingSerialized = serialized;
    const revision = ++historyWriteRevision;
    historyWriteQueue = historyWriteQueue
        .catch(() => undefined)
        .then(async () => {
            // 步骤 1：队列轮到当前写入时再次执行最后写入者优先检查。
            if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
            await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, sanitizedHistory);

            // 步骤 2：storage.setItem 期间可能产生更新请求；旧写入完成后不能回滚内存状态。
            if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
            setHistoryState(sanitizedHistory);
            historyPendingSerialized = '';
        });
    try {
        await historyWriteQueue;
    } catch (error) {
        if (revision === historyWriteRevision && historyPendingSerialized === serialized) {
            historyPendingSerialized = '';
        }
        throw error;
    }
}

async function initializeConfigHistory(): Promise<void> {
    try {
        await configReady;
        const storedHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const parsed = parseConfigHistory(storedHistory);
        historyInitialized = true;
        if (parsed) {
            setHistoryState(parsed);
            // 旧历史可能仍含统计、安全开关或内部迁移字段；读取时立即迁移为
            // 可恢复投影，避免这些字段继续占用存储或在其他上下文中泄漏出来。
            if (serializeConfig(storedHistory) !== serializeConfig(parsed)) {
                try {
                    await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, parsed);
                } catch (error) {
                    console.warn('[FluentRead] 配置历史可恢复投影迁移暂未落盘', error);
                }
            }
        } else {
            setHistoryState(createBaselineConfigHistory(config, persistedConfigRevision), false);
        }
    } catch (error) {
        historyInitialized = true;
        setHistoryState(createBaselineConfigHistory(config, persistedConfigRevision), false);
        console.error('[FluentRead] 配置历史读取失败，使用当前配置快照', error);
    }
}

async function appendHistorySnapshotNow(value: unknown): Promise<void> {
    await configHistoryReady;
    const nextHistory = appendConfigHistorySnapshot(historyState, value);
    if (!nextHistory) return;
    await queueHistoryWrite(nextHistory);
}

function takePendingHistorySnapshot(): RestorableConfig | null {
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = undefined;
    const snapshot = pendingHistorySnapshot;
    pendingHistorySnapshot = null;
    return snapshot;
}

function flushHistorySnapshot(snapshot: RestorableConfig): Promise<void> {
    // 步骤 1：每次追加都等待前一个追加完成，确保它读取到已提交的游标与 nextVersion。
    const previous = historyFlushPromise;
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
        .then(() => appendHistorySnapshotNow(snapshot));
    historyFlushPromise = current;

    // 步骤 2：只有队尾任务可以清空引用；较早任务结束不能让调用方漏等后续快照。
    const clearIfCurrent = () => {
        if (historyFlushPromise === current) historyFlushPromise = null;
    };
    void current.then(clearIfCurrent, clearIfCurrent);
    void current.catch((error) => console.error('[FluentRead] 配置历史保存失败', error));
    return current;
}

function scheduleHistorySnapshot(value: unknown): void {
    pendingHistorySnapshot = toRestorableConfig(value);
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = setTimeout(() => {
        const snapshot = takePendingHistorySnapshot();
        if (snapshot) flushHistorySnapshot(snapshot);
    }, CONFIG_HISTORY_DEBOUNCE_MS);
}

export async function flushConfigHistory(): Promise<void> {
    const snapshot = takePendingHistorySnapshot();
    let current = snapshot ? flushHistorySnapshot(snapshot) : historyFlushPromise;
    while (current) {
        await current;
        current = historyFlushPromise === current ? null : historyFlushPromise;
    }
}

function notifyListeners(nextConfig: Config): void {
    const snapshot = normalizeConfig(nextConfig);
    listeners.forEach((listener) => listener(snapshot));
}

function applyConfig(nextConfig: Config): void {
    Object.assign(config, nextConfig);
    notifyListeners(config);
}

const trustedCredentialStorageContext = isTrustedCredentialStorageContext();
const configStorageWriteOwner = storage.writeOwner !== false;
let credentialWatchRegistered = false;
let configStorageWritesBlocked = false;

function assertConfigStorageWritesAllowed(): void {
    if (!configStorageWriteOwner) {
        throw new Error('当前上下文必须通过后台配置协议保存');
    }
    if (configStorageWritesBlocked) {
        throw new Error('配置安全迁移未完成，暂不写入存储；请重新加载扩展后重试');
    }
}

async function writeAndVerifyCredentials(
    credentials: ConfigCredentials,
): Promise<void> {
    await storage.setItem<ConfigCredentials>(LOCAL_CREDENTIALS_STORAGE_KEY, credentials);
    await verifyStoredCredentials(credentials);
}

async function verifyStoredCredentials(
    credentials: ConfigCredentials,
): Promise<void> {
    const verified = parseStoredCredentials(await storage.getItem<unknown>(LOCAL_CREDENTIALS_STORAGE_KEY));
    if (!verified || !credentialsEqual(credentials, verified)) {
        throw new Error(`${LOCAL_CREDENTIALS_STORAGE_KEY} 凭据写入校验失败`);
    }
}

async function sanitizeStoredHistory(rawHistory?: unknown): Promise<void> {
    const storedHistory = arguments.length > 0
        ? rawHistory
        : await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
    if (storedHistory === null || storedHistory === undefined) return;
    const sanitized = sanitizeConfigHistoryCredentials(storedHistory);
    if (serializeConfig(storedHistory) === serializeConfig(sanitized)) return;
    if (sanitized === null) {
        await storage.removeItem(CONFIG_HISTORY_STORAGE_KEY);
        return;
    }
    await storage.setItem(CONFIG_HISTORY_STORAGE_KEY, sanitized);
}

function queueStorageWrite(nextConfig: Config, serialized: string, revision: number): Promise<void> {
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            // 只写最后一次快照，避免连续输入或多个页面初始化时排队回写旧配置。
            if (revision !== writeRevision || lastPersistedSerialized !== serialized) return;
            assertConfigStorageWritesAllowed();
            try {
                // revision 代表已经成功提交到 local:config 的版本，不能在写入前发布。
                // 若 storage 暂时失败，下一次保存仍应从原版本继续，而不是永久冲突。
                const storedRevision = persistedConfigRevision + 1;
                if (!trustedCredentialStorageContext) {
                    // 扩展 content script 只能持久化公开配置，不能访问专用凭据记录。
                    // 兜底写入前，toPublicConfig 会移除凭据。
                    await storage.setItem(CONFIG_STORAGE_KEY, createStoredConfigRecord(nextConfig, storedRevision));
                    persistedConfigRevision = Math.max(persistedConfigRevision, storedRevision);
                    return;
                }

                const credentials = extractConfigCredentials(nextConfig);

                if (storage.setItems) {
                    await storage.setItems(new Map<string, unknown>([
                        [LOCAL_CREDENTIALS_STORAGE_KEY, credentials],
                        [CONFIG_STORAGE_KEY, createStoredConfigRecord(nextConfig, storedRevision)],
                    ]), [SESSION_CREDENTIALS_STORAGE_KEY]);
                    await verifyStoredCredentials(credentials);
                    persistedConfigRevision = Math.max(persistedConfigRevision, storedRevision);
                    return;
                }

                await writeAndVerifyCredentials(credentials);
                await storage.setItem(CONFIG_STORAGE_KEY, createStoredConfigRecord(nextConfig, storedRevision));
                persistedConfigRevision = Math.max(persistedConfigRevision, storedRevision);
                // session:credentials 仅是上一版的兼容来源。持久记录和公开配置
                // 均成功后再删除，任何中断都至少保留一份可恢复凭据。
                await storage.removeItem(SESSION_CREDENTIALS_STORAGE_KEY);
            } catch (error) {
                if (lastPersistedSerialized === serialized) lastPersistedSerialized = '';
                throw error;
            }
        });
    return writeQueue;
}

async function persistNormalizedConfig(nextConfig: Config, serialized = serializeConfig(nextConfig)): Promise<void> {
    if (serialized === lastPersistedSerialized) return;

    lastPersistedSerialized = serialized;
    const revision = ++writeRevision;
    await queueStorageWrite(nextConfig, serialized, revision);
}

interface StoredConfigChangeOptions {
    confirmedRequestRevision?: number;
    confirmedRequestSerialized?: string;
}

function takeDeferredStoredConfigChange(): {hasValue: boolean; value: unknown} {
    const result = {hasValue: hasDeferredStoredConfigChange, value: deferredStoredConfigChange};
    hasDeferredStoredConfigChange = false;
    deferredStoredConfigChange = undefined;
    return result;
}

function handleStoredConfigChange(value: unknown, options: StoredConfigChangeOptions = {}): void {
    storageRevision += 1;
    const parsed = parseStoredConfig(value);
    if (!parsed) return;

    const normalized = normalizeConfig(mergeConfigCredentials(parsed, extractConfigCredentials(config)));
    const serialized = serializeConfig(normalized);
    const storedRevision = getStoredConfigRevision(parsed);
    if (storedRevision && storedRevision < persistedConfigRevision) return;
    const revisionAdvanced = storedRevision > persistedConfigRevision;
    const isConfirmedRequestEcho = options.confirmedRequestRevision === storedRevision
        && Boolean(options.confirmedRequestSerialized);

    // runtime 消息的 storage 回声可能早于响应，并且后台会保留 count、凭据等
    // canonical 字段，因此不能靠整份 serialized 猜测归属。先暂存，收到响应
    // revision 后再判断它是本次提交还是更新的外部恢复。
    if (revisionAdvanced && activeRequestSerialized && !isConfirmedRequestEcho) {
        hasDeferredStoredConfigChange = true;
        deferredStoredConfigChange = value;
        return;
    }

    // 普通 watch 的更高 revision 不能只因内容等于 lastPersistedSerialized 就认作
    // 本地回声：凭据事件可能先把 last 更新成另一个页面的新状态。
    const isLocalEcho = isConfirmedRequestEcho
        || (!revisionAdvanced && serialized === lastPersistedSerialized);
    if (storedRevision) persistedConfigRevision = storedRevision;

    // 一个更高 revision 且无法归属于本页面保存请求的快照，必然来自恢复、导入
    // 或其他页面。replace 请求逐个捕获该 generation，因此即使队尾后来换成
    // patch，队列中更早的旧整份快照也会失效；patch 自身则交给字段级 CAS。
    if (revisionAdvanced && !isLocalEcho) {
        requestGeneration += 1;
        if (latestRequestedSerialized && latestRequestedMode === 'replace') {
            latestRequestedSerialized = '';
            latestRequestedMode = null;
        }
    }
    // 同一个短生命周期页面可能在极短时间内产生多个快照。storage.watch
    // 可能先回传前一个快照，不能让它覆盖页面尚未完成发送的最新快照。
    if (isConfirmedRequestEcho
        && latestRequestedSerialized
        && latestRequestedSerialized !== options.confirmedRequestSerialized) return;
    if (!isConfirmedRequestEcho
        && isLocalEcho
        && latestRequestedSerialized
        && serialized !== latestRequestedSerialized) return;
    if (!revisionAdvanced && latestRequestedSerialized && serialized !== latestRequestedSerialized) return;
    const persistedCountOperations = parsePersistedCountOperations(value);
    if (persistedCountOperations) {
        replaceCompletedCountOperations(persistedCountOperations, normalized.count);
    }
    const runtimeAlreadyMatches = serialized === serializeConfig(config);
    if (serialized === lastPersistedSerialized && runtimeAlreadyMatches) return;

    // 外部上下文已经产生了新快照，使尚未写入的旧快照失效。
    writeRevision += 1;
    lastPersistedSerialized = serialized;
    // patch 在请求发出前已经乐观更新并通知订阅者。确认回声只更新持久化
    // revision/去重基线，不能再次 apply 同值导致 UI 重绘或监听器重复执行。
    if (runtimeAlreadyMatches) return;
    applyConfig(normalized);
}

// 在首次读取前注册监听，避免设置页打开期间丢失其他上下文的更新。
storage.watch(CONFIG_STORAGE_KEY, (value) => handleStoredConfigChange(value));
storage.watch(CONFIG_HISTORY_STORAGE_KEY, handleStoredHistoryChange);

function registerCredentialWatch(): void {
    if (!trustedCredentialStorageContext || credentialWatchRegistered) return;
    try {
        storage.watch(LOCAL_CREDENTIALS_STORAGE_KEY, (value) => {
            const nextCredentials = parseStoredCredentials(value) || extractConfigCredentials({});
            const normalized = normalizeConfig(mergeConfigCredentials(config, nextCredentials));
            const serialized = serializeConfig(normalized);
            if (serialized === serializeConfig(config)) return;
            lastPersistedSerialized = serialized;
            applyConfig(normalized);
        });
        credentialWatchRegistered = true;
    } catch (error) {
        console.warn('[FluentRead] 持久凭据监听不可用', error);
    }
}

async function initializeConfig(): Promise<void> {
    let safePublicConfig: Config | null = null;
    let storedValueRevision = storageRevision;
    try {
        let storedValue: unknown = null;

        // 读取过程中若收到 storage.onChanged，重新读取一次，避免旧读结果覆盖新配置。
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const revisionAtRead = storageRevision;
            storedValue = await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
            storedValueRevision = revisionAtRead;
            if (revisionAtRead === storageRevision) break;
        }

        const parsed = parseStoredConfig(storedValue);
        persistedConfigRevision = getStoredConfigRevision(storedValue);
        const publicConfig = parsed
            ? normalizeConfig(sanitizeConfigCredentials(parsed))
            : new Config();
        safePublicConfig = publicConfig;

        // 计数操作日志与公开配置同属 local:config，必须在任何凭据 I/O 前恢复。
        // 即使 session 读取、迁移或检查点失败，同一 operationId 的重试仍能保持幂等。
        const persistedCountOperations = parsePersistedCountOperations(storedValue);
        if (persistedCountOperations) {
            replaceCompletedCountOperations(persistedCountOperations, publicConfig.count);
        }

        if (!trustedCredentialStorageContext) {
            if (storedValueRevision !== storageRevision) return initializeConfig();
            // content script 的 location 属于网页 origin，且默认无权访问 storage.session。
            // 只加载公开配置，不在此上下文迁移、回写或监听凭据。
            initialized = true;
            lastPersistedSerialized = serializeConfig(publicConfig);
            applyConfig(publicConfig);
            return;
        }

        const legacyCredentials = parsed && hasCredentialFields(parsed)
            ? extractConfigCredentials(parsed)
            : null;
        const localCredentialsValue = await storage.getItem<unknown>(LOCAL_CREDENTIALS_STORAGE_KEY);
        const localCredentials = parseStoredCredentials(localCredentialsValue);
        const rawHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const sanitizedRawHistory = sanitizeConfigHistoryCredentials(rawHistory);
        const historyNeedsSanitizing = rawHistory !== null
            && rawHistory !== undefined
            && serializeConfig(rawHistory) !== serializeConfig(sanitizedRawHistory);

        let sessionCredentials: ConfigCredentials | null = null;
        let sessionReadError: unknown;
        try {
            sessionCredentials = parseStoredCredentials(
                await storage.getItem<unknown>(SESSION_CREDENTIALS_STORAGE_KEY),
            );
        } catch (error) {
            sessionReadError = error;
        }

        // config 读完后还要等待 local/history/session 凭据。若这段水合窗口内其他
        // 页面提交了更高 revision，当前 parsed 与凭据不再属于同一个原子快照；
        // 整轮重读，禁止旧配置在新 watch 已应用后回滚 UI 并覆盖新设置。
        if (storedValueRevision !== storageRevision) return initializeConfig();

        const legacyCredentialPolicyPresent = Boolean(parsed
            && Object.prototype.hasOwnProperty.call(parsed, 'persistCredentials'));
        // 上一版可能在非原子 userscript 写入中留下“session 新、local 旧”的
        // 双副本；旧策略字段仍在时让 session 胜出。完成升级并删除该字段后，
        // local:credentials 才是唯一权威，残留 session 不得回滚新凭据。
        const activeCredentials = legacyCredentialPolicyPresent && sessionCredentials
            ? sessionCredentials
            : localCredentials
            || sessionCredentials
            || legacyCredentials
            || extractConfigCredentials({});
        const normalized = parsed
            ? normalizeConfig(mergeConfigCredentials(parsed, activeCredentials))
            : normalizeConfig(mergeConfigCredentials(new Config(), activeCredentials));
        const serialized = serializeConfig(normalized);

        initialized = true;
        applyConfig(normalized);

        // popup/options/document 可以从后台读取完整凭据，但不是 IndexedDB 写入所有者。
        // 后台已经完成旧存储迁移与检查点；远程页面只水合并监听，不能再次 setItem。
        if (!configStorageWriteOwner) {
            if (sessionReadError && legacyCredentialPolicyPresent) configStorageWritesBlocked = true;
            lastPersistedSerialized = serialized;
            registerCredentialWatch();
            return;
        }

        const hasLegacyCredentialSource = sessionCredentials !== null || legacyCredentials !== null;
        const credentialsNeedPersistence = localCredentials === null
            ? hasCredentialData(activeCredentials) || hasLegacyCredentialSource
            : !credentialsEqual(localCredentials, activeCredentials);

        // 旧 session 读取暂时失败且还没有持久副本时，不能用空值覆盖未知凭据。
        if (sessionReadError && legacyCredentialPolicyPresent) {
            configStorageWritesBlocked = true;
            lastPersistedSerialized = serialized;
            console.warn('[FluentRead] 旧会话凭据暂不可读，保留原记录并暂停配置写入', sessionReadError);
            registerCredentialWatch();
            return;
        }
        // IndexedDB 已有且内容一致时直接使用，不在每次启动重复加密写回；只有
        // local 缺失或旧 session/公开配置携带了更新凭据时才建立新持久副本。
        if (credentialsNeedPersistence) {
            await writeAndVerifyCredentials(activeCredentials);
        }

        // 先建立并验证持久凭据，再清理旧历史与旧会话；最后才移除公开配置中的
        // 旧策略字段。这样任一步中断时，下次启动仍能从字段存在判断 session
        // 是否应该优先，避免非原子旧写入中的新 Key 被较旧 local 副本覆盖。
        if (historyNeedsSanitizing) await sanitizeStoredHistory(rawHistory);
        if (sessionCredentials !== null) await storage.removeItem(SESSION_CREDENTIALS_STORAGE_KEY);

        const nextStoredConfig = createStoredConfigRecord(normalized, persistedConfigRevision);
        const storedNeedsMigration = !isConfigRecord(storedValue)
            || typeof storedValue === 'string'
            || serializeConfig(storedValue) !== serializeConfig(nextStoredConfig);
        if (storedNeedsMigration) {
            const migratedRevision = persistedConfigRevision + 1;
            await storage.setItem(CONFIG_STORAGE_KEY, createStoredConfigRecord(normalized, migratedRevision));
            persistedConfigRevision = Math.max(persistedConfigRevision, migratedRevision);
        }
        lastPersistedSerialized = serialized;
        registerCredentialWatch();
    } catch (error) {
        // 凭据 I/O 可能在更高 revision 的 watch 到达后失败。此时旧轮次的
        // safePublicConfig 已经过期；先用最新主记录整轮重试。若同一 I/O 继续失败，
        // 下一轮 fallback 也会基于最新公开配置，不能出现旧内容搭配新 revision。
        if (storedValueRevision !== storageRevision) return initializeConfig();
        // 在任何读取或迁移边界不确定时禁止后续覆盖 local:config；重新加载后会重新尝试水合。
        configStorageWritesBlocked = true;
        if (initialized) {
            lastPersistedSerialized = serializeConfig(config);
            console.error('[FluentRead] 配置安全迁移未完成，保留当前运行时与旧存储以便重试', error);
            return;
        }
        // local:config 已成功读取时至少保留其公开字段；凭据相关 I/O 的失败不能把计数等
        // 用户状态回滚到默认值。若连公开配置也无法读取，才使用安全默认配置。
        console.error('[FluentRead] 配置读取或安全迁移失败，保留已读取的公开配置', error);
        const fallback = safePublicConfig ?? new Config();
        initialized = true;
        lastPersistedSerialized = safePublicConfig ? serializeConfig(fallback) : '';
        applyConfig(fallback);
        // 读取失败时不做清理或迁移，避免把暂时不可用误判为“没有凭据”。
    }
}

export const configReady = initializeConfig();
export const configHistoryReady = initializeConfigHistory();

export function subscribeConfig(listener: ConfigListener): () => void {
    listeners.add(listener);
    if (initialized) listener(normalizeConfig(config));
    return () => listeners.delete(listener);
}

export function getConfigRevision(): number {
    return persistedConfigRevision;
}

/** 翻译计数只做后台原子增量，不携带可能过期的整份用户配置。 */
export async function incrementConfigCount(delta: number, operationId?: string): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    const normalizedOperationId = operationId === undefined ? undefined : parseConfigCountOperationId(operationId);
    if (operationId !== undefined && normalizedOperationId === null) throw new TypeError('无效的翻译计数操作标识');

    if (normalizedOperationId) {
        const completed = completedCountOperations.get(normalizedOperationId);
        if (completed) {
            if (completed.delta !== normalizedDelta) throw new Error('翻译计数操作标识与增量不一致');
            return completed.count;
        }
        const active = activeCountOperations.get(normalizedOperationId);
        if (active) {
            if (active.delta !== normalizedDelta) throw new Error('翻译计数操作标识与增量不一致');
            return active.promise;
        }
    }

    const operation = (async () => {
        await configReady;
        // 请求可能早于首次 local:config 读取完成；初始化水合后必须再次检查，
        // 否则后台重启期间的同一 operationId 仍会被重复累加。
        if (normalizedOperationId) {
            const completed = completedCountOperations.get(normalizedOperationId);
            if (completed) {
                if (completed.delta !== normalizedDelta) throw new Error('翻译计数操作标识与增量不一致');
                return {count: completed.count, persistedOperations: getPersistedCountOperations()};
            }
        }
        assertConfigStorageWritesAllowed();
        if (!Number.isSafeInteger(config.count) || config.count < 0) {
            throw new TypeError('当前翻译计数不是非负安全整数');
        }
        const nextCount = config.count + normalizedDelta;
        if (!Number.isSafeInteger(nextCount)) throw new RangeError('翻译计数超过安全整数范围');
        const nextConfig = normalizeConfig({...config, count: nextCount});
        const nextOperation = normalizedOperationId
            ? {id: normalizedOperationId, delta: normalizedDelta, count: nextConfig.count}
            : undefined;
        const persistedOperations = getPersistedCountOperations(nextOperation);
        // count 与 operationId 同属一个 storage 记录；后台在响应前退出后，新实例仍能识别已提交操作。
        await storage.setItem(
            CONFIG_STORAGE_KEY,
            createStoredConfigRecord(nextConfig, persistedConfigRevision, persistedOperations),
        );
        writeRevision += 1;
        lastPersistedSerialized = serializeConfig(nextConfig);
        applyConfig(nextConfig);
        return {count: nextConfig.count, persistedOperations};
    });
    const operationPromise = operation();
    if (!normalizedOperationId) return operationPromise.then((result) => result.count);

    const promise = operationPromise.then((result) => {
        replaceCompletedCountOperations(result.persistedOperations, result.count);
        return result.count;
    });

    activeCountOperations.set(normalizedOperationId, {delta: normalizedDelta, promise});
    try {
        return await promise;
    } finally {
        activeCountOperations.delete(normalizedOperationId);
    }
}

type ConfigCountMessageResponse = {success?: boolean; error?: string; count?: number} | undefined;
type ConfigCountMessageSender = (message: {
    type: typeof CONFIG_COUNT_INCREMENT_MESSAGE;
    delta: number;
    operationId: string;
}) => Promise<ConfigCountMessageResponse>;

export async function requestConfigCountIncrement(
    delta: number,
    sendMessage?: ConfigCountMessageSender,
    operationId?: string,
): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    const normalizedOperationId = parseConfigCountOperationId(operationId);
    if (normalizedOperationId === null) throw new TypeError('无效的翻译计数操作标识');
    if (!sendMessage) return incrementConfigCount(normalizedDelta, normalizedOperationId);

    const response = await sendMessage({
        type: CONFIG_COUNT_INCREMENT_MESSAGE,
        delta: normalizedDelta,
        operationId: normalizedOperationId,
    });
    if (response?.success === false) throw new Error(response.error || '翻译计数保存失败');
    if (typeof response?.count !== 'number') throw new Error('翻译计数保存没有返回结果');
    return response.count;
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function configPatchValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => configPatchValuesEqual(item, right[index]));
    }
    if (!isConfigObject(left) || !isConfigObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => (
            key === rightKeys[index]
            && configPatchValuesEqual(left[key], right[key])
        ));
}

function createConfigPatch(
    value: unknown,
    currentValue: unknown,
    allowCredentialUpdates: boolean,
    omitUnchanged = true,
): Record<string, unknown> {
    if (!isConfigObject(value)) return {};
    const currentConfig = normalizeConfig(currentValue);
    const requestedFields = Object.fromEntries(
        Object.entries(value).filter(([key]) => (
            CONFIG_KNOWN_FIELDS.has(key)
            && !CONFIG_PATCH_PROTECTED_FIELDS.has(key)
            && (allowCredentialUpdates || !CONFIG_CREDENTIAL_FIELD_SET.has(key))
        )),
    );
    if (Object.keys(requestedFields).length === 0) return {};

    const normalized = normalizeConfig({
        ...currentConfig,
        ...requestedFields,
        count: currentConfig.count,
        videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
    });
    return Object.fromEntries(
        Object.keys(requestedFields)
            .filter((key) => !omitUnchanged || !configPatchValuesEqual(
                normalized[key as keyof Config],
                currentConfig[key as keyof Config],
            ))
            .map((key) => [key, normalized[key as keyof Config]]),
    );
}

function createConfigPatchExpectedValues(
    patch: Record<string, unknown>,
    currentValue: unknown,
): Record<string, unknown> {
    const currentConfig = normalizeConfig(currentValue);
    return Object.fromEntries(
        Object.keys(patch).map((key) => [key, currentConfig[key as keyof Config]]),
    );
}

/**
 * 网页/content 发来的保存请求只能修改公开配置；凭据必须由 popup/options
 * 等扩展 origin 明确更新，避免无凭据的 content 快照清空后台持久记录。
 */
export function prepareConfigSaveRequest(
    value: unknown,
    currentValue: unknown = config,
    allowCredentialUpdates = false,
): Config {
    const currentConfig = normalizeConfig(currentValue);
    const incomingConfig = normalizeConfig(value);
    if (allowCredentialUpdates) {
        return normalizeConfig({
            ...incomingConfig,
            count: currentConfig.count,
            videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
        });
    }

    return normalizeConfig(mergeConfigCredentials({
        ...sanitizeConfigCredentials(incomingConfig),
        count: currentConfig.count,
        videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
    }, extractConfigCredentials(currentConfig)));
}

/**
 * 字段级配置修改在后台 mutation 临界区内基于最新配置合并。补丁只接受当前
 * Config 已知顶层字段；统计和迁移标记永远由后台保留，content 也不能修改凭据。
 */
export function prepareConfigPatchRequest(
    value: unknown,
    expectedValue: unknown,
    currentValue: unknown = config,
    allowCredentialUpdates = false,
): Config {
    const currentConfig = normalizeConfig(currentValue);
    // 后台必须对 wire patch 中每个合法字段执行 CAS；即使别的页面已经写成
    // 相同目标值，也不能先按“当前无变化”删掉该字段并绕过 expected 校验。
    const patch = createConfigPatch(value, currentConfig, allowCredentialUpdates, false);
    const expected = isConfigObject(expectedValue) ? expectedValue : {};
    const conflicts = Object.keys(patch).filter((key) => (
        !Object.prototype.hasOwnProperty.call(expected, key)
        || !configPatchValuesEqual(currentConfig[key as keyof Config], expected[key])
    ));
    if (conflicts.length > 0) {
        throw new Error(`配置字段已更新，请同步后重试：${conflicts.join(', ')}`);
    }
    return normalizeConfig({
        ...currentConfig,
        ...patch,
        count: currentConfig.count,
        videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
    });
}

export function getConfigHistorySnapshot(): ConfigHistoryState {
    return cloneConfigHistory(
        historyState || createBaselineConfigHistory(config, persistedConfigRevision),
    );
}

export function subscribeConfigHistory(listener: ConfigHistoryListener): () => void {
    historyListeners.add(listener);
    if (historyInitialized && historyState) listener(cloneConfigHistory(historyState));
    return () => historyListeners.delete(listener);
}

/**
 * 配置唯一写入口。调用方可以传入编辑中的快照，也可以省略参数保存运行时配置。
 * 写入前会归一化、去重，并串行淘汰旧快照，避免设置页和 popup 互相回灌。
 */
export interface SaveConfigOptions {
    recordHistory?: boolean;
    immediateHistory?: boolean;
}

export async function saveConfig(value: unknown = config, options: SaveConfigOptions = {}): Promise<void> {
    await configReady;

    // 普通设置、导入与恢复都无权回滚统计；计数只能经专用增量协议修改。
    const normalized = normalizeConfig({...normalizeConfig(value), count: config.count});
    const serialized = serializeConfig(normalized);
    if (serializeConfig(config) !== serialized) applyConfig(normalized);
    await persistNormalizedConfig(normalized, serialized);
    if (options.recordHistory) {
        if (options.immediateHistory) {
            await flushConfigHistory();
            await flushHistorySnapshot(toRestorableConfig(normalized));
        } else {
            scheduleHistorySnapshot(normalized);
        }
    }
}

/**
 * 从 popup/options 等短生命周期页面请求后台保存配置。
 * Firefox 可能在 popup 关闭时销毁页面上下文，不能依赖页面内的异步 storage.set 完成。
 */
type ConfigMessageResponse = { success?: boolean; error?: string; revision?: number } | undefined;
type ConfigMessageSender = (message: {
    type: typeof CONFIG_PERSIST_MESSAGE;
    mode?: ConfigPersistenceMode;
    config: Config;
    expected?: Config;
    clientId: string;
    sequence: number;
    baseRevision: number;
}) => Promise<ConfigMessageResponse>;

async function reconcileFailedConfigRequest(fallbackConfig?: Config): Promise<void> {
    let deferred = takeDeferredStoredConfigChange();
    let storedValue: unknown;
    try {
        storedValue = deferred.hasValue
            ? deferred.value
            : await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
        // storage.getItem 期间可能又收到更新，以最后一个 watch 快照为准。
        deferred = takeDeferredStoredConfigChange();
    } catch (error) {
        if (fallbackConfig && serializeConfig(config) !== serializeConfig(fallbackConfig)) {
            applyConfig(fallbackConfig);
        }
        console.warn('[FluentRead] 配置保存失败后的权威快照回读失败', error);
        return;
    } finally {
        activeRequestSerialized = '';
    }

    const latestValue = deferred.hasValue ? deferred.value : storedValue;
    if (parseStoredConfig(latestValue)) {
        handleStoredConfigChange(latestValue);
    } else if (fallbackConfig && serializeConfig(config) !== serializeConfig(fallbackConfig)) {
        applyConfig(fallbackConfig);
    }
}

interface ConfigMutationRequest {
    mode: ConfigPersistenceMode;
    normalized: Config;
    messageConfig: Config | Record<string, unknown>;
    messageExpected?: Record<string, unknown>;
    rollbackConfig?: Config;
}

async function requestConfigMutation(
    mutation: ConfigMutationRequest,
    sendMessage?: ConfigMessageSender,
): Promise<void> {
    const {mode, normalized, messageConfig, messageExpected, rollbackConfig} = mutation;
    const serialized = serializeConfig(normalized);
    const enqueuedBaseRevision = persistedConfigRevision;
    // 必须在第一个 await 前登记最新请求；否则即使 configReady 已 resolved，微任务
    // 让出期间到达的旧 storage 回声也会被误当外部更新并回滚本地编辑。
    latestRequestedSerialized = serialized;
    latestRequestedMode = mode;
    const predecessorRemoteSequence = sendMessage ? lastEnqueuedRemoteRequestSequence : 0;
    const sequence = ++requestSequence;
    if (sendMessage) lastEnqueuedRemoteRequestSequence = sequence;
    if (mode === 'patch' && serializeConfig(config) !== serialized) applyConfig(normalized);

    if (!sendMessage) {
        try {
            await configReady;
            if (configStorageWritesBlocked) {
                throw new Error('配置安全水合未完成，暂不保存；请重新加载扩展后重试');
            }
            await saveConfig(normalized, {recordHistory: true, immediateHistory: true});
        } catch (error) {
            if (mode === 'patch' && latestRequestedSerialized === serialized) {
                requestGeneration += 1;
                latestRequestedSerialized = '';
                latestRequestedMode = null;
                await reconcileFailedConfigRequest(rollbackConfig);
            }
            throw error;
        } finally {
            if (latestRequestedSerialized === serialized) {
                latestRequestedSerialized = '';
                latestRequestedMode = null;
            }
        }
        return;
    }

    const generation = requestGeneration;
    const request = requestQueue
        .catch(() => undefined)
        .then(async () => {
            await configReady;
            // 远程扩展页在凭据水合失败后只有公开配置，绝不能把空 token/ak/sk 当成
            // 用户修改发给后台并清除仍安全保存的 API Key。完整重载成功前统一拒绝保存。
            if (configStorageWritesBlocked) {
                throw new Error('配置安全水合未完成，暂不保存；请重新加载扩展后重试');
            }
            // 外部恢复/导入导致 revision 冲突后，不能继续发送已经排队的旧整份快照。
            if (mode === 'replace' && generation !== requestGeneration) {
                throw new Error('配置已更新，请根据最新配置重新修改');
            }

            activeRequestSerialized = serialized;
            // replace 必须绑定入队时看到的基线，不能在排队后借用外部页面推进的
            // persistedConfigRevision。唯一允许继承的是同一 client 队列中已经确认
            // 成功的 replace 直接前驱，这样连续整份快照仍可按 revision 1 -> 2 -> 3
            // 提交，而 patch 吸收的外部字段不会成为旧 replace 的授权基线。
            const canInheritPredecessorRevision = predecessorRemoteSequence > 0
                && lastCommittedRemoteRequestSequence === predecessorRemoteSequence
                && lastCommittedRemoteRequestGeneration === generation
                // patch 的提交 revision 可能已经吸收外部字段；旧整份 replace
                // 不能借用该 revision，否则会把这些外部字段回写成自己的旧快照。
                && lastCommittedRemoteRequestMode === 'replace';
            const baseRevision = canInheritPredecessorRevision
                ? Math.max(enqueuedBaseRevision, lastCommittedRemoteRequestRevision)
                : enqueuedBaseRevision;
            let response: ConfigMessageResponse;
            try {
                response = await sendMessage({
                    type: CONFIG_PERSIST_MESSAGE,
                    ...(mode === 'patch' ? {mode} : {}),
                    // replace 发送完整 Config；patch 只发送已过滤的已知字段。runtime
                    // wire schema 在后台按 mode 区分，这里的断言保持旧 sender 回调兼容。
                    config: messageConfig as Config,
                    ...(mode === 'patch' ? {expected: messageExpected as unknown as Config} : {}),
                    clientId: requestClientId,
                    sequence,
                    baseRevision,
                });
            } catch (error) {
                activeRequestSerialized = '';
                if (mode === 'patch' && latestRequestedSerialized === serialized) {
                    requestGeneration += 1;
                    latestRequestedSerialized = '';
                    latestRequestedMode = null;
                    await reconcileFailedConfigRequest(rollbackConfig);
                } else {
                    const deferred = takeDeferredStoredConfigChange();
                    if (deferred.hasValue) handleStoredConfigChange(deferred.value);
                }
                throw error;
            }

            if (response?.success === false) {
                requestGeneration += 1;
                if (latestRequestedSerialized === serialized) {
                    latestRequestedSerialized = '';
                    latestRequestedMode = null;
                }
                await reconcileFailedConfigRequest(mode === 'patch' ? rollbackConfig : undefined);
                throw new Error(response.error || '后台保存配置失败');
            }
            if (typeof response?.revision !== 'number'
                || !Number.isSafeInteger(response.revision)
                || response.revision < 0) {
                activeRequestSerialized = '';
                if (mode === 'patch' && latestRequestedSerialized === serialized) {
                    requestGeneration += 1;
                    latestRequestedSerialized = '';
                    latestRequestedMode = null;
                    await reconcileFailedConfigRequest(rollbackConfig);
                } else {
                    const deferred = takeDeferredStoredConfigChange();
                    if (deferred.hasValue) handleStoredConfigChange(deferred.value);
                }
                throw new Error('后台保存配置没有返回有效 revision');
            }

            let deferred = takeDeferredStoredConfigChange();
            let storedValue: unknown;
            if (deferred.hasValue) {
                storedValue = deferred.value;
            } else {
                try {
                    storedValue = await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
                } catch {
                    // 保存已经成功；读取暂时失败时至少同步本次用户快照与 revision，
                    // 后续 storage.watch 仍会补齐后台保留的 canonical 字段。
                    activeRequestSerialized = '';
                    persistedConfigRevision = Math.max(persistedConfigRevision, response.revision);
                    if (latestRequestedSerialized === serialized
                        && serializeConfig(config) !== serialized) applyConfig(normalized);
                    if (mode === 'replace' && generation !== requestGeneration) {
                        throw new Error('配置已由其他页面更新，请根据最新配置重新修改');
                    }
                    lastCommittedRemoteRequestSequence = sequence;
                    lastCommittedRemoteRequestRevision = response.revision;
                    lastCommittedRemoteRequestGeneration = generation;
                    lastCommittedRemoteRequestMode = mode;
                    return;
                }
                deferred = takeDeferredStoredConfigChange();
                if (deferred.hasValue) storedValue = deferred.value;
            }
            activeRequestSerialized = '';

            const storedRevision = getStoredConfigRevision(storedValue);
            if (storedRevision > response.revision) {
                handleStoredConfigChange(storedValue);
                throw new Error('配置已由其他页面更新，请根据最新配置重新修改');
            }
            if (storedRevision === response.revision) {
                handleStoredConfigChange(storedValue, {
                    confirmedRequestRevision: response.revision,
                    confirmedRequestSerialized: serialized,
                });
            } else {
                persistedConfigRevision = Math.max(persistedConfigRevision, response.revision);
                if (latestRequestedSerialized === serialized) {
                    const storedBase = parseStoredConfig(storedValue);
                    const storedBaseConfig = storedBase
                        ? normalizeConfig(mergeConfigCredentials(
                            storedBase,
                            extractConfigCredentials(config),
                        ))
                        : null;
                    const optimisticResult = mode === 'patch' && storedBaseConfig
                        ? prepareConfigPatchRequest(
                            messageConfig,
                            createConfigPatchExpectedValues(
                                messageConfig as unknown as Record<string, unknown>,
                                storedBaseConfig,
                            ),
                            storedBaseConfig,
                            trustedCredentialStorageContext,
                        )
                        : normalized;
                    if (serializeConfig(config) !== serializeConfig(optimisticResult)) {
                        applyConfig(optimisticResult);
                    }
                }
            }
            if (mode === 'replace' && generation !== requestGeneration) {
                throw new Error('配置已由其他页面更新，请根据最新配置重新修改');
            }
            lastCommittedRemoteRequestSequence = sequence;
            lastCommittedRemoteRequestRevision = response.revision;
            lastCommittedRemoteRequestGeneration = generation;
            lastCommittedRemoteRequestMode = mode;
        });
    requestQueue = request.then(() => undefined, () => undefined);

    try {
        await request;
    } catch (error) {
        if (mode === 'patch'
            && latestRequestedSerialized === serialized
            && serializeConfig(config) === serialized) {
            requestGeneration += 1;
            latestRequestedSerialized = '';
            latestRequestedMode = null;
            await reconcileFailedConfigRequest(rollbackConfig);
        }
        throw error;
    } finally {
        if (latestRequestedSerialized === serialized) {
            latestRequestedSerialized = '';
            latestRequestedMode = null;
        }
    }
}

/**
 * 等待当前配置消息队列排空。等待期间若又有请求接到队尾，会继续等待新的
 * queue 引用；调用完成之后才入队的请求不属于本次 barrier。
 */
export async function waitForConfigPersistenceQueue(): Promise<void> {
    let pendingQueue = requestQueue;
    while (true) {
        await pendingQueue;
        if (pendingQueue === requestQueue) return;
        pendingQueue = requestQueue;
    }
}

export async function requestConfigSave(value: unknown = config, sendMessage?: ConfigMessageSender): Promise<void> {
    const normalized = normalizeConfig(value);
    return requestConfigMutation({mode: 'replace', normalized, messageConfig: normalized}, sendMessage);
}

/**
 * 提交字段级配置补丁。调用端先乐观应用合法字段；后台在共享 mutation 队列内
 * 基于最新配置合并，因此无关字段不会被旧整份快照覆盖。失败时回读权威存储回滚。
 */
export async function requestConfigPatch(value: unknown, sendMessage?: ConfigMessageSender): Promise<void> {
    if (!initialized) await configReady;
    const previousConfig = normalizeConfig(config);
    const patch = createConfigPatch(value, previousConfig, trustedCredentialStorageContext);
    if (Object.keys(patch).length === 0) return;
    const expected = createConfigPatchExpectedValues(patch, previousConfig);
    const normalized = prepareConfigPatchRequest(
        patch,
        expected,
        previousConfig,
        trustedCredentialStorageContext,
    );
    return requestConfigMutation({
        mode: 'patch',
        normalized,
        messageConfig: patch,
        messageExpected: expected,
        rollbackConfig: previousConfig,
    }, sendMessage);
}

export async function applyConfigHistoryAction(action: ConfigHistoryAction, version?: number): Promise<ConfigHistoryState> {
    await configHistoryReady;
    await flushConfigHistory();

    const targetIndex = resolveConfigHistoryTargetIndex(historyState, action, version);

    if (targetIndex === historyState.cursor) return getConfigHistorySnapshot();
    const target = historyState.entries[targetIndex];
    const normalized = restoreRestorableConfig(target.config, config);
    await persistNormalizedConfig(normalized);
    if (serializeConfig(config) !== serializeConfig(normalized)) applyConfig(normalized);

    if (action === 'restore') {
        // 恢复不是把游标永久退回旧版本，而是把目标快照作为一次新的修改追加。
        // 这样恢复前的状态和原有 redo 条目都仍可查看，之后继续编辑也不会静默丢失它们。
        const historyWithLatestCursor = {
            ...historyState,
            cursor: historyState.entries.length - 1,
        };
        const restoredHistory = appendConfigHistorySnapshot(historyWithLatestCursor, normalized);
        await queueHistoryWrite(restoredHistory || historyWithLatestCursor);
        return getConfigHistorySnapshot();
    }

    await queueHistoryWrite({
        ...historyState,
        cursor: targetIndex,
    });
    return getConfigHistorySnapshot();
}

type ConfigHistoryMessageResponse = {success?: boolean; error?: string; history?: ConfigHistoryState} | undefined;
type ConfigHistoryMessageSender = (message: {
    type: typeof CONFIG_HISTORY_MESSAGE;
    action: ConfigHistoryAction;
    version?: number;
}) => Promise<ConfigHistoryMessageResponse>;

export async function requestConfigHistoryAction(
    action: ConfigHistoryAction,
    version?: number,
    sendMessage?: ConfigHistoryMessageSender,
): Promise<ConfigHistoryState> {
    if (!sendMessage) return applyConfigHistoryAction(action, version);

    let response: ConfigHistoryMessageResponse;
    try {
        response = await sendMessage({type: CONFIG_HISTORY_MESSAGE, action, version});
    } catch (error) {
        // 只有明确“没有后台接收端”时才允许本地兜底。后台已经返回的保存失败
        // 不能再执行一次，否则可能绕过共享 mutation 队列或造成重复恢复。
        if (!(error instanceof Error) || !error.message.includes('Receiving end')) throw error;
        return applyConfigHistoryAction(action, version);
    }
    if (response?.success === false) throw new Error(response.error || '配置历史操作失败');
    if (!response?.history) throw new Error('配置历史操作没有返回结果');
    return response.history;
}
