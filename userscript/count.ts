/**
 * @file userscript/count.ts
 * 文件职责：为 userscript 提供跨网页标签不丢增量的翻译计数存储，并把共享配置中的 count 降为可重建投影。
 * 主要内容：迁移旧计数基数、为每个顶层文档创建独立单调副本、串行写入副本并聚合全部有效计数。
 * 模块边界：本文件只访问专用 GM 键，不读取网页 URL、正文或凭据；扩展版本仍使用后台配置 mutation coordinator。
 */
import {
    parseConfigCountIncrement,
    parseConfigCountOperationId,
} from '@/src/services/config/count';
import {getStoredValue, listStoredKeys, setStoredValue} from './storage';

export const USERSCRIPT_COUNT_BASE_PREFIX = 'fluentread:count:v1:base:';
export const USERSCRIPT_COUNT_REPLICA_PREFIX = 'fluentread:count:v1:replica:';
const USERSCRIPT_COUNT_RECENT_OPERATION_LIMIT = 256;

interface CountBaseRecord {
    version: 1;
    value: number;
}

interface CountOperationRecord {
    id: string;
    delta: number;
}

interface CountReplicaRecord {
    version: 1;
    value: number;
    recentOperations: CountOperationRecord[];
}

export interface UserscriptCountStoragePort {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    list(): Promise<string[]>;
}

export interface UserscriptCountCoordinator {
    initialize(legacyCount: unknown): Promise<number>;
    increment(delta: unknown, operationId: unknown): Promise<number>;
    getTotal(): Promise<number>;
}

export interface UserscriptCountCoordinatorOptions {
    storage?: UserscriptCountStoragePort;
    createId?(): string;
}

const defaultStorage: UserscriptCountStoragePort = {
    get: (key) => getStoredValue(key),
    set: (key, value) => setStoredValue(key, value),
    list: () => listStoredKeys(),
};

function createRandomId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function parseNonNegativeSafeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseBaseRecord(value: unknown): CountBaseRecord | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<CountBaseRecord>;
    const count = parseNonNegativeSafeInteger(candidate.value);
    return candidate.version === 1 && count !== null ? {version: 1, value: count} : null;
}

function parseReplicaRecord(value: unknown): CountReplicaRecord | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<CountReplicaRecord>;
    const count = parseNonNegativeSafeInteger(candidate.value);
    if (candidate.version !== 1 || count === null || !Array.isArray(candidate.recentOperations)) return null;

    const recentOperations: CountOperationRecord[] = [];
    for (const operation of candidate.recentOperations.slice(-USERSCRIPT_COUNT_RECENT_OPERATION_LIMIT)) {
        if (!operation || typeof operation !== 'object') continue;
        const id = parseConfigCountOperationId((operation as Partial<CountOperationRecord>).id);
        const delta = parseConfigCountIncrement((operation as Partial<CountOperationRecord>).delta);
        if (id && delta !== null) recentOperations.push({id, delta});
    }
    return {version: 1, value: count, recentOperations};
}

function addSafeCount(total: number, value: number): number {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new RangeError('userscript 翻译计数超过安全整数范围');
    return next;
}

/**
 * 每个协调器只写自己的副本键，因此不同标签不会发生“同时读取 N，再都写 N+1”的覆盖。
 * 旧 count 以唯一候选键迁移；首次并发启动时取候选最大值，避免把同一旧值重复相加。
 */
export function createUserscriptCountCoordinator(
    options: UserscriptCountCoordinatorOptions = {},
): UserscriptCountCoordinator {
    const storage = options.storage ?? defaultStorage;
    const createId = options.createId ?? createRandomId;
    let legacyCount = 0;
    let baseCandidateKey: string | undefined;
    let baseInitialized = false;
    let replicaKey: string | undefined;
    let cachedTotal: number | null = null;
    let writeQueue: Promise<void> = Promise.resolve();

    const getCountKeys = async () => {
        const keys = await storage.list();
        return [...new Set(keys.filter((key) => (
            key.startsWith(USERSCRIPT_COUNT_BASE_PREFIX)
            || key.startsWith(USERSCRIPT_COUNT_REPLICA_PREFIX)
        )))];
    };

    const ensureBase = async (): Promise<void> => {
        if (baseInitialized) return;
        const keys = await getCountKeys();
        const baseKeys = keys.filter((key) => key.startsWith(USERSCRIPT_COUNT_BASE_PREFIX));
        const bases = await Promise.all(baseKeys.map((key) => storage.get(key)));
        if (bases.some((value) => parseBaseRecord(value) !== null)) {
            baseInitialized = true;
            return;
        }

        baseCandidateKey ??= `${USERSCRIPT_COUNT_BASE_PREFIX}${createId()}`;
        await storage.set(baseCandidateKey, {version: 1, value: legacyCount} satisfies CountBaseRecord);
        baseInitialized = true;
    };

    const getTotal = async (): Promise<number> => {
        await ensureBase();
        const keys = await getCountKeys();
        let base = 0;
        let hasBase = false;
        let replicas = 0;
        await Promise.all(keys.map(async (key) => {
            const value = await storage.get(key);
            if (key.startsWith(USERSCRIPT_COUNT_BASE_PREFIX)) {
                const record = parseBaseRecord(value);
                if (record) {
                    hasBase = true;
                    base = Math.max(base, record.value);
                }
                return;
            }
            const record = parseReplicaRecord(value);
            if (record) replicas = addSafeCount(replicas, record.value);
        }));
        if (!hasBase) {
            // 用户在脚本运行期间清空 GM 数据时，废弃进程内标记并重新建立迁移基数。
            baseInitialized = false;
            await ensureBase();
            return getTotal();
        }
        cachedTotal = addSafeCount(base, replicas);
        return cachedTotal;
    };

    const runIncrement = async (delta: number, operationId: string): Promise<number> => {
        await ensureBase();
        replicaKey ??= `${USERSCRIPT_COUNT_REPLICA_PREFIX}${createId()}`;
        const current = parseReplicaRecord(await storage.get(replicaKey)) ?? {
            version: 1,
            value: 0,
            recentOperations: [],
        } satisfies CountReplicaRecord;
        const completed = current.recentOperations.find((operation) => operation.id === operationId);
        if (completed) {
            if (completed.delta !== delta) throw new Error('userscript 翻译计数操作标识与增量不一致');
            return getTotal();
        }

        // 热路径使用启动/可见性同步得到的总数，不枚举全部历史副本；没有缓存时才执行完整聚合。
        const knownTotal = cachedTotal ?? await getTotal();
        const nextTotal = addSafeCount(knownTotal, delta);

        const next: CountReplicaRecord = {
            version: 1,
            value: addSafeCount(current.value, delta),
            recentOperations: [...current.recentOperations, {id: operationId, delta}]
                .slice(-USERSCRIPT_COUNT_RECENT_OPERATION_LIMIT),
        };
        // 写入绝对单调值；若脚本管理器在提交后才报告失败，同 operationId 重试会从存储中去重。
        await storage.set(replicaKey, next);
        cachedTotal = nextTotal;
        return nextTotal;
    };

    return {
        async initialize(value) {
            legacyCount = parseNonNegativeSafeInteger(value) ?? 0;
            return getTotal();
        },
        increment(deltaValue, operationIdValue) {
            const delta = parseConfigCountIncrement(deltaValue);
            if (delta === null) return Promise.reject(new TypeError('无效的翻译计数增量'));
            const operationId = parseConfigCountOperationId(operationIdValue);
            if (operationId === null) return Promise.reject(new TypeError('无效的翻译计数操作标识'));

            const operation = writeQueue.then(
                () => runIncrement(delta, operationId),
                () => runIncrement(delta, operationId),
            );
            writeQueue = operation.then(() => undefined, () => undefined);
            return operation;
        },
        getTotal,
    };
}

const userscriptCountCoordinator = createUserscriptCountCoordinator();

export function initializeUserscriptCount(legacyCount: unknown): Promise<number> {
    return userscriptCountCoordinator.initialize(legacyCount);
}

export function incrementUserscriptConfigCount(delta: unknown, operationId: unknown): Promise<number> {
    return userscriptCountCoordinator.increment(delta, operationId);
}

export function getUserscriptConfigCount(): Promise<number> {
    return userscriptCountCoordinator.getTotal();
}
