import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    clearManagedTranslationCache,
    estimateTranslationCacheCapacity,
    getTranslationCacheStats,
} from '@/src/services/translation/cacheManagement';

const {sendMessage} = vi.hoisted(() => ({sendMessage: vi.fn()}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage}}}));

beforeEach(() => {
    sendMessage.mockReset();
    vi.useFakeTimers();
});

afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});

describe('翻译缓存管理客户端', () => {
    const stats = {bytes: 1234, entries: 4, maxBytes: 5 * 1024 * 1024, maxEntries: 2000};

    it('仅通过后台消息读取统计，并返回独立的统计快照', async () => {
        sendMessage.mockResolvedValue({success: true, stats: {...stats, secret: 'ignored'}});
        await expect(getTranslationCacheStats()).resolves.toEqual(stats);
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith({type: 'getTranslationCacheStats'});
    });

    it('接受明确的空缓存和正数上限，不把暂时超额伪装为空缓存', async () => {
        sendMessage.mockResolvedValue({success: true, stats: {...stats, bytes: 0, entries: 0}});
        await expect(getTranslationCacheStats()).resolves.toMatchObject({bytes: 0, entries: 0});
        sendMessage.mockResolvedValue({success: true, stats: {...stats, bytes: stats.maxBytes + 1}});
        await expect(getTranslationCacheStats()).resolves.toMatchObject({bytes: stats.maxBytes + 1});
    });

    it.each([
        undefined, null, false, 0, 'success', {},
        {success: false, error: 'storage unavailable'},
        {success: 'true'},
    ])('拒绝未明确成功的响应，不返回虚假的零用量 %#', async response => {
        sendMessage.mockResolvedValue(response);
        await expect(getTranslationCacheStats()).rejects.toThrow('缓存管理请求失败');
        await expect(clearManagedTranslationCache()).rejects.toThrow('缓存管理请求失败');
    });

    it.each([
        undefined, null, 1, 'stats', [], {},
        {...stats, bytes: -1}, {...stats, entries: -1},
        {...stats, bytes: NaN}, {...stats, bytes: Infinity},
        {...stats, bytes: Number.MAX_SAFE_INTEGER + 1},
        {...stats, entries: 0.5}, {...stats, entries: '4'},
        {...stats, maxBytes: 0}, {...stats, maxEntries: 0},
        {...stats, maxBytes: -1}, {...stats, maxEntries: 0.5},
    ])('拒绝缺失、负数、字符串和不安全的统计响应 %#', async invalidStats => {
        sendMessage.mockResolvedValue({success: true, stats: invalidStats});
        await expect(getTranslationCacheStats()).rejects.toThrow('缓存统计响应无效');
    });

    it('复用清空协议，只有后台确认成功才报告完成', async () => {
        let complete!: (value: unknown) => void;
        sendMessage.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
        let settled = false;
        const pending = clearManagedTranslationCache().then(() => { settled = true; });
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith({type: 'clearTranslationCache'});
        await Promise.resolve();
        expect(settled).toBe(false);
        complete({success: true});
        await pending;
        expect(settled).toBe(true);
    });

    it('后台拒绝后释放超时器，下一次可以重试', async () => {
        sendMessage.mockRejectedValueOnce(new Error('background unavailable'));
        await expect(getTranslationCacheStats()).rejects.toThrow('background unavailable');
        sendMessage.mockResolvedValueOnce({success: true, stats});
        await expect(getTranslationCacheStats()).resolves.toEqual(stats);
    });

    it('同步发送失败仍释放超时器', async () => {
        sendMessage.mockImplementationOnce(() => { throw new Error('sync failure'); });
        await expect(clearManagedTranslationCache()).rejects.toThrow('sync failure');
    });

    it('消息不返回时超时可重试，迟到响应不会覆盖下一次快照', async () => {
        let complete!: (value: unknown) => void;
        sendMessage.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const pending = getTranslationCacheStats();
        const timeout = expect(pending).rejects.toThrow('缓存管理请求超时');
        await vi.advanceTimersByTimeAsync(15_000);
        await timeout;
        sendMessage.mockResolvedValueOnce({success: true, stats: {...stats, entries: 5}});
        await expect(getTranslationCacheStats()).resolves.toMatchObject({entries: 5});
        complete({success: true, stats});
        await Promise.resolve();
    });
});

describe('缓存容量与页面数量估算', () => {
    const limits = {maxBytes: 5 * 1024 * 1024, maxEntries: 2000};

    it('空缓存按每条 1 KiB 与每页 50 条估算，默认受条数上限约束', () => {
        expect(estimateTranslationCacheCapacity(null, limits)).toEqual({entries: 2000, pages: 40, basedOnUsage: false});
        expect(estimateTranslationCacheCapacity({...limits, bytes: 0, entries: 0}, limits)).toEqual({entries: 2000, pages: 40, basedOnUsage: false});
    });

    it('已有结果按平均大小估算，容量较紧时由字节数限制', () => {
        expect(estimateTranslationCacheCapacity({...limits, bytes: 10 * 1024, entries: 2}, limits))
            .toEqual({entries: 1024, pages: 20.48, basedOnUsage: true});
    });

    it('调小后的有效上限优先于旧快照上限，并对不足一条的容量下取整', () => {
        expect(estimateTranslationCacheCapacity({...limits, bytes: 2048, entries: 2}, {maxBytes: 3000, maxEntries: 50}))
            .toEqual({entries: 2, pages: 0.04, basedOnUsage: true});
        expect(estimateTranslationCacheCapacity({...limits, bytes: 2048, entries: 1}, {maxBytes: 1024, maxEntries: 50}))
            .toEqual({entries: 0, pages: 0, basedOnUsage: true});
    });

    it('无可用平均大小时明确回到假设，避免除零或无限估算', () => {
        expect(estimateTranslationCacheCapacity({...limits, bytes: 0, entries: 1}, limits).basedOnUsage).toBe(false);
        expect(estimateTranslationCacheCapacity({...limits, bytes: 1024, entries: 0}, limits).basedOnUsage).toBe(false);
    });
});
