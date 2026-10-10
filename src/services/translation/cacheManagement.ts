/**
 * @file src/services/translation/cacheManagement.ts
 * 文件职责：提供设置页管理翻译缓存的消息客户端，只读取后台统计快照或请求清空缓存。
 * 主要内容：限制消息等待时间、检查明确的成功响应和非负安全整数统计，保留失败给界面重试，并按已有平均大小或明确假设估算可容纳结果与页面数量。
 * 模块边界：本模块不访问 IndexedDB、不调整淘汰策略也不写配置；后台拥有缓存数据，配置上限仍通过配置服务保存。
 */
import browser from 'webextension-polyfill';

export interface TranslationCacheStats {
    bytes: number;
    entries: number;
    maxBytes: number;
    maxEntries: number;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** 页数只是按每页 50 条结果折算；缓存不是页面快照，空缓存按每条 1 KiB 作参考。 */
export function estimateTranslationCacheCapacity(
    stats: TranslationCacheStats | null,
    limits: Pick<TranslationCacheStats, 'maxBytes' | 'maxEntries'>,
): {entries: number; pages: number; basedOnUsage: boolean} {
    const basedOnUsage = Boolean(stats && stats.entries > 0 && stats.bytes > 0);
    const averageBytes = basedOnUsage ? stats!.bytes / stats!.entries : 1024;
    const entries = Math.min(limits.maxEntries, Math.floor(limits.maxBytes / averageBytes));
    return {entries, pages: entries / 50, basedOnUsage};
}

async function sendCacheRequest(type: 'getTranslationCacheStats' | 'clearTranslationCache'): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('缓存管理请求超时')), REQUEST_TIMEOUT_MS);
    });
    try {
        return await Promise.race([browser.runtime.sendMessage({type}), timeout]);
    } finally {
        clearTimeout(timer!);
    }
}

function requireSuccess(response: unknown): Record<string, unknown> {
    if (!response || typeof response !== 'object' || (response as {success?: unknown}).success !== true) {
        throw new Error('缓存管理请求失败');
    }
    return response as Record<string, unknown>;
}

/** 读取已成功获取的后台快照；未知状态与存储错误不能伪装成空缓存。 */
export async function getTranslationCacheStats(): Promise<TranslationCacheStats> {
    const {stats} = requireSuccess(await sendCacheRequest('getTranslationCacheStats'));
    if (!stats || typeof stats !== 'object') throw new Error('缓存统计响应无效');
    const {bytes, entries, maxBytes, maxEntries} = stats as TranslationCacheStats;
    if (![bytes, entries, maxBytes, maxEntries].every(value => Number.isSafeInteger(value) && value >= 0)
        || maxBytes === 0 || maxEntries === 0) {
        throw new Error('缓存统计响应无效');
    }
    return {bytes, entries, maxBytes, maxEntries};
}

/** 只在后台实际清空完成后成功返回，界面随后重新读取统计。 */
export async function clearManagedTranslationCache(): Promise<void> {
    requireSuccess(await sendCacheRequest('clearTranslationCache'));
}
