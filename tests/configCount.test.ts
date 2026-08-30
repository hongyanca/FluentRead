import {afterEach, describe, expect, it, vi} from 'vitest';

import {createConfigCountIncrementHandler} from '@/src/app/background/handlers/configCount';
import {
    CONFIG_COUNT_INCREMENT_MAX,
    CONFIG_COUNT_INCREMENT_MESSAGE,
    createConfigCountOperationId,
    createConfigCountPersistenceQueue,
    parseConfigCountIncrement,
    parseConfigCountOperationId,
} from '@/src/services/config/count';

describe('配置计数增量协议', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('只接受有界的正安全整数', () => {
        expect(parseConfigCountIncrement(1)).toBe(1);
        expect(parseConfigCountIncrement(CONFIG_COUNT_INCREMENT_MAX)).toBe(CONFIG_COUNT_INCREMENT_MAX);
        for (const value of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, CONFIG_COUNT_INCREMENT_MAX + 1]) {
            expect(parseConfigCountIncrement(value)).toBeNull();
        }
    });

    it('只接受有界且可安全传输的幂等操作标识', () => {
        expect(parseConfigCountOperationId('count-client_1:batch.2')).toBe('count-client_1:batch.2');
        for (const value of [undefined, null, '', 'short', '含中文', 'contains space', 'x'.repeat(129)]) {
            expect(parseConfigCountOperationId(value)).toBeNull();
        }
    });

    it('在有无 randomUUID 的环境都能生成唯一且可传输的操作标识', () => {
        const randomUUID = vi.fn(() => '00000000-0000-4000-8000-000000000001');
        vi.stubGlobal('crypto', {randomUUID});
        const modernId = createConfigCountOperationId();
        expect(parseConfigCountOperationId(modernId)).toBe(modernId);
        expect(randomUUID).toHaveBeenCalledOnce();

        vi.stubGlobal('crypto', {});
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const legacyId = createConfigCountOperationId();
        expect(parseConfigCountOperationId(legacyId)).toBe(legacyId);
        expect(legacyId).not.toBe(modernId);
    });

    it('handler 只把验证后的增量交给后台原子更新', async () => {
        const increment = vi.fn(async (delta: number) => 40 + delta);
        const handler = createConfigCountIncrementHandler(increment);

        await expect(handler.handle({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 2,
            operationId: 'count-client-1',
        }, {})).resolves.toEqual({success: true, count: 42});
        await expect(handler.handle({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 0,
            operationId: 'count-client-2',
        }, {})).resolves.toEqual({success: false, error: '无效的翻译计数增量'});
        await expect(handler.handle({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 1,
            operationId: 'bad id',
        }, {})).resolves.toEqual({success: false, error: '无效的翻译计数操作标识'});
        expect(increment).toHaveBeenCalledOnce();
        expect(increment).toHaveBeenCalledWith(2, 'count-client-1');
    });

    it('失败批次复用 operationId 重试，成功后不会重复记账', async () => {
        vi.useFakeTimers();
        const persist = vi.fn()
            .mockRejectedValueOnce(new Error('runtime disconnected'))
            .mockResolvedValueOnce(undefined);
        const onError = vi.fn();
        const queue = createConfigCountPersistenceQueue({
            delayMs: 100,
            retryDelayMs: 200,
            maxAutomaticRetries: 2,
            persist,
            onError,
            createOperationId: () => 'count-retry-batch-1',
        });

        queue.record(2);
        queue.record(3);
        await vi.advanceTimersByTimeAsync(100);
        expect(persist).toHaveBeenCalledWith(5, 'count-retry-batch-1');
        expect(onError).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(200);
        expect(persist).toHaveBeenCalledTimes(2);
        expect(persist).toHaveBeenLastCalledWith(5, 'count-retry-batch-1');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('达到自动重试上限后仍保留批次，生命周期 flush 可以恢复', async () => {
        vi.useFakeTimers();
        const persist = vi.fn()
            .mockRejectedValueOnce(new Error('storage unavailable'))
            .mockResolvedValueOnce(undefined);
        const queue = createConfigCountPersistenceQueue({
            delayMs: 100,
            retryDelayMs: 200,
            maxAutomaticRetries: 0,
            persist,
            createOperationId: () => 'count-flush-batch-1',
        });

        queue.record(4);
        await vi.advanceTimersByTimeAsync(100);
        expect(vi.getTimerCount()).toBe(0);

        await queue.flush();
        expect(persist).toHaveBeenCalledTimes(2);
        expect(persist).toHaveBeenLastCalledWith(4, 'count-flush-batch-1');
    });

    it('flush 会同步清除延迟任务、切分上限批次并使用默认 operationId', async () => {
        vi.useFakeTimers();
        const persist = vi.fn().mockResolvedValue(undefined);
        const queue = createConfigCountPersistenceQueue({
            delayMs: -1,
            retryDelayMs: 0,
            maxAutomaticRetries: -2.8,
            persist,
        });

        queue.record();
        queue.record(2);
        queue.record(CONFIG_COUNT_INCREMENT_MAX);
        expect(() => queue.record(0)).toThrow('无效的翻译计数增量');
        await queue.flush();

        expect(persist.mock.calls.map(([delta]) => delta)).toEqual([3, CONFIG_COUNT_INCREMENT_MAX]);
        const operationIds = persist.mock.calls.map(([, operationId]) => operationId);
        expect(operationIds.every((id) => parseConfigCountOperationId(id) === id)).toBe(true);
        expect(new Set(operationIds).size).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('并发 flush 复用飞行任务，成功后继续提交期间新增的批次', async () => {
        vi.useFakeTimers();
        let resolveFirst!: () => void;
        const firstPersistence = new Promise<void>((resolve) => { resolveFirst = resolve; });
        const persist = vi.fn()
            .mockImplementationOnce(() => firstPersistence)
            .mockResolvedValue(undefined);
        const queue = createConfigCountPersistenceQueue({
            delayMs: 100,
            retryDelayMs: 200,
            maxAutomaticRetries: 1,
            persist,
            createOperationId: (() => {
                let sequence = 0;
                return () => `count-concurrent-${++sequence}`;
            })(),
        });

        queue.record(1);
        const firstFlush = queue.flush();
        const secondFlush = queue.flush();
        queue.record(2);
        expect(persist).toHaveBeenCalledTimes(1);
        resolveFirst();
        await Promise.all([firstFlush, secondFlush]);

        expect(persist.mock.calls.map(([delta]) => delta)).toEqual([1, 2]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('同步抛错按失败处理，flush 最多重试当前失败批次一次后返回', async () => {
        vi.useFakeTimers();
        const error = new Error('synchronous storage failure');
        const persist = vi.fn(() => { throw error; });
        const onError = vi.fn();
        const queue = createConfigCountPersistenceQueue({
            delayMs: 100,
            retryDelayMs: 200,
            maxAutomaticRetries: 0,
            persist: persist as unknown as (delta: number, operationId: string) => Promise<unknown>,
            onError,
            createOperationId: () => 'count-sync-failure-1',
        });

        queue.record(1);
        await queue.flush();

        expect(persist).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenLastCalledWith(error);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('飞行批次失败时保留期间新增计数，并从同一 operationId 恢复', async () => {
        vi.useFakeTimers();
        let rejectFirst!: (error: Error) => void;
        const firstPersistence = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        const persist = vi.fn()
            .mockImplementationOnce(() => firstPersistence)
            .mockResolvedValue(undefined);
        let sequence = 0;
        const queue = createConfigCountPersistenceQueue({
            delayMs: 100,
            retryDelayMs: 200,
            maxAutomaticRetries: 0,
            persist,
            createOperationId: () => `count-flight-failure-${++sequence}`,
        });

        queue.record(4);
        const flush = queue.flush();
        queue.record(3);
        rejectFirst(new Error('first write failed'));
        await flush;

        expect(persist.mock.calls.map(([delta]) => delta)).toEqual([4, 4, 3]);
        expect(persist.mock.calls[1]?.[1]).toBe(persist.mock.calls[0]?.[1]);
        expect(persist.mock.calls[2]?.[1]).not.toBe(persist.mock.calls[0]?.[1]);
    });

    it('达到上限后的新活动会重新唤醒失败批次，指数退避封顶后也能成功', async () => {
        vi.useFakeTimers();
        const persistAfterActivity = vi.fn()
            .mockRejectedValueOnce(new Error('temporarily unavailable'))
            .mockResolvedValue(undefined);
        const activityQueue = createConfigCountPersistenceQueue({
            delayMs: 10,
            retryDelayMs: 20,
            maxAutomaticRetries: 0,
            persist: persistAfterActivity,
            createOperationId: () => 'count-activity-retry-1',
        });
        activityQueue.record(2);
        await vi.advanceTimersByTimeAsync(10);
        activityQueue.record(1);
        await vi.runAllTimersAsync();
        expect(persistAfterActivity.mock.calls.map(([delta]) => delta)).toEqual([2, 2, 1]);

        const persistWithBackoff = vi.fn()
            .mockRejectedValueOnce(new Error('retry-1'))
            .mockRejectedValueOnce(new Error('retry-2'))
            .mockRejectedValueOnce(new Error('retry-3'))
            .mockRejectedValueOnce(new Error('retry-4'))
            .mockRejectedValueOnce(new Error('retry-5'))
            .mockRejectedValueOnce(new Error('retry-6'))
            .mockRejectedValueOnce(new Error('retry-7'))
            .mockResolvedValue(undefined);
        const backoffQueue = createConfigCountPersistenceQueue({
            delayMs: 1,
            retryDelayMs: 1,
            maxAutomaticRetries: 7,
            persist: persistWithBackoff,
            createOperationId: () => 'count-backoff-retry-1',
        });
        backoffQueue.record(1);
        await vi.runAllTimersAsync();
        expect(persistWithBackoff).toHaveBeenCalledTimes(8);
    });
});
