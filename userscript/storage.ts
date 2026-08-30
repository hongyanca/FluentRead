type StorageListener = (nextValue: unknown, previousValue?: unknown) => void;

const listeners = new Map<string, Set<StorageListener>>();
const memoryFallback = new Map<string, unknown>();
const observedValues = new Map<string, unknown>();
let refreshListenersInstalled = false;

function decodeStoredValue(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        // 2024 版 userscript 的值以普通字符串保存，需要保持原值以便迁移。
        return value;
    }
}

/**
 * GM 存储 API 在不同脚本管理器中可能同步或异步返回；这里统一归一为 Promise。
 * 内存回退仅服务于缺少 GM API 的测试或受限环境，不跨页面持久化。
 */
export async function getStoredValue<T>(key: string): Promise<T | null> {
    const getValue = globalThis.GM_getValue;
    if (typeof getValue === 'function') {
        return decodeStoredValue(await Promise.resolve(getValue<unknown>(key, null))) as T | null;
    }
    return (memoryFallback.get(key) ?? null) as T | null;
}

export async function setStoredValue<T>(key: string, value: T): Promise<void> {
    const previousValue = await getStoredValue<T>(key);
    const setValue = globalThis.GM_setValue;
    if (typeof setValue === 'function') {
        await Promise.resolve(setValue(key, JSON.stringify(value)));
    } else {
        memoryFallback.set(key, value);
    }
    observedValues.set(key, value);
    listeners.get(key)?.forEach((listener) => listener(value, previousValue));
}

export async function removeStoredValue(key: string): Promise<void> {
    const previousValue = await getStoredValue(key);
    const deleteValue = globalThis.GM_deleteValue;
    if (typeof deleteValue === 'function') {
        await Promise.resolve(deleteValue(key));
    } else {
        memoryFallback.delete(key);
    }
    observedValues.set(key, null);
    listeners.get(key)?.forEach((listener) => listener(null, previousValue));
}

/** 统一枚举 GM 键；计数等跨页面派生状态只读取自己的命名空间。 */
export async function listStoredKeys(): Promise<string[]> {
    const listValues = globalThis.GM_listValues;
    if (typeof listValues === 'function') {
        const keys = await Promise.resolve(listValues());
        return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
    }
    return [...new Set([...memoryFallback.keys(), ...observedValues.keys()])];
}

function comparable(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** 旧式 GM API 没有可靠的变更监听，因此页面重新获得焦点或可见时主动对比已订阅键。 */
async function refreshWatchedValues(): Promise<void> {
    await Promise.all([...listeners.keys()].map(async (key) => {
        const previousValue = observedValues.get(key);
        const nextValue = await getStoredValue(key);
        if (comparable(previousValue) === comparable(nextValue)) return;
        observedValues.set(key, nextValue);
        listeners.get(key)?.forEach((listener) => listener(nextValue, previousValue));
    }));
}

function installRefreshListeners(): void {
    if (refreshListenersInstalled || typeof window === 'undefined') return;
    refreshListenersInstalled = true;
    window.addEventListener('focus', () => void refreshWatchedValues());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void refreshWatchedValues();
    });
}

export const storage = {
    writeOwner: true,
    getItem<T>(key: string): Promise<T | null> {
        return getStoredValue<T>(key);
    },

    setItem<T>(key: string, value: T): Promise<void> {
        return setStoredValue(key, value);
    },

    removeItem(key: string): Promise<void> {
        return removeStoredValue(key);
    },

    watch<T>(key: string, callback: (nextValue: T | null, previousValue?: T | null) => void): () => void {
        const bucket = listeners.get(key) || new Set<StorageListener>();
        bucket.add(callback as StorageListener);
        listeners.set(key, bucket);
        installRefreshListeners();
        if (!observedValues.has(key)) {
            void getStoredValue(key).then((value) => observedValues.set(key, value));
        }
        return () => {
            bucket.delete(callback as StorageListener);
            if (bucket.size === 0) listeners.delete(key);
        };
    },
};

// 共享配置 store 在扩展构建中使用后台 IndexedDB 端口；userscript 保持 GM 私有
// 存储语义，并通过同名导出让 Vite alias 在模块边界完整替换扩展实现。
export const configStorage = storage;
