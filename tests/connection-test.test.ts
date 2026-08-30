import {afterEach, describe, expect, it, vi} from 'vitest';

const {adapter} = vi.hoisted(() => ({
    adapter: vi.fn(),
}));

vi.mock('@/src/providers/translation/registry', () => ({
    translationProviderRegistry: {
        demo: adapter,
    },
}));

import {
    CONNECTION_TEST_ORIGIN,
    CONNECTION_TEST_TIMEOUT_MS,
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
import {formatServiceError, getServiceErrorMessage} from '@/src/services/translation/serviceErrors';
import {services} from '@/src/core/config/catalog';
import {reportTranslationModelUsage} from '@/src/services/translation/requestSnapshot';

describe('翻译服务连接测试', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('调用真实适配器并禁用翻译缓存', async () => {
        adapter.mockResolvedValue('测试译文');

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual(expect.objectContaining({
            durationMs: expect.any(Number),
        }));
        expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
            origin: CONNECTION_TEST_ORIGIN,
            serviceOverride: 'demo',
            useCache: false,
            abortSignal: expect.any(AbortSignal),
        }));
    });

    it('拒绝空响应，避免把仅 HTTP 成功误报为连接正常', async () => {
        adapter.mockResolvedValue('   ');

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
    });

    it('拒绝非字符串响应与未知适配器', async () => {
        adapter.mockResolvedValue(['unexpected batch']);

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
        await expect(runTranslationServiceConnectionTest('missing')).rejects.toThrow('未找到翻译服务适配器: missing');
    });

    it('系统时钟回拨时将耗时钳制为零', async () => {
        adapter.mockResolvedValue('测试译文');
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(90);

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual({durationMs: 0});
    });

    it('30 秒后中止 legacy adapter signal，统一返回超时且忽略迟到结果', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        let resolveLate!: (value: string) => void;
        adapter.mockImplementation((message: {abortSignal?: AbortSignal}) => {
            signal = message.abortSignal;
            return new Promise<string>((resolve) => {
                resolveLate = resolve;
            });
        });

        const request = runTranslationServiceConnectionTest('demo');
        const rejection = expect(request).rejects.toThrow('翻译请求超时');
        await vi.advanceTimersByTimeAsync(CONNECTION_TEST_TIMEOUT_MS - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(signal?.aborted).toBe(true);

        resolveLate('迟到译文');
        await Promise.resolve();
        expect(adapter).toHaveBeenCalledOnce();
    });

    it('非超时 adapter 错误保持原始原因', async () => {
        const failure = new Error('provider failed');
        adapter.mockRejectedValue(failure);

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe(failure);
    });

    it('把真实连接测试尝试旁路记录为 connection-test，且不等待统计写入', async () => {
        const recordModelUsage = vi.fn(() => new Promise<void>(() => undefined));
        adapter.mockImplementation(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {
                actualModel: 'demo-model',
                startedAt: 10,
                durationMs: -5,
                usageAvailability: 'reported',
                inputTokens: 4,
                outputTokens: 2,
                totalTokens: 6,
            });
            reportTranslationModelUsage(message, {
                startedAt: Number.NaN,
                durationMs: Number.NaN,
                usageAvailability: 'unreported',
            });
            return '测试译文';
        });

        await expect(runTranslationServiceConnectionTest('demo', {
            configuredModel: '  demo-config  ',
            recordModelUsage,
        }))
            .resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
        expect(recordModelUsage).toHaveBeenCalledWith([
            expect.objectContaining({
                serviceId: 'demo',
                configuredModel: 'demo-config',
                actualModel: 'demo-model',
                startedAt: 10,
                durationMs: 0,
                purpose: 'connection-test',
                outcome: 'success',
                totalTokens: 6,
            }),
            expect.objectContaining({
                startedAt: expect.any(Number),
                durationMs: 0,
                outcome: 'success',
                usageAvailability: 'unreported',
            }),
        ]);
    });

    it('连接测试预检失败不造请求，结构化 timeout 会校准 transport cancelled', async () => {
        const recordModelUsage = vi.fn(async () => undefined);
        adapter.mockRejectedValueOnce(new Error('local validation failed'));
        await expect(runTranslationServiceConnectionTest('demo', {recordModelUsage}))
            .rejects.toThrow('local validation failed');
        expect(recordModelUsage).not.toHaveBeenCalled();

        const timeoutError = Object.assign(new Error('provider timeout'), {kind: 'timeout'});
        adapter.mockImplementationOnce(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {
                outcome: 'cancelled',
                usageAvailability: 'unreported',
            });
            throw timeoutError;
        });
        await expect(runTranslationServiceConnectionTest('demo', {recordModelUsage}))
            .rejects.toBe(timeoutError);
        expect(recordModelUsage).toHaveBeenNthCalledWith(1, [
            expect.objectContaining({
                purpose: 'connection-test',
                outcome: 'timeout',
            }),
        ]);

        const httpTimeout = new Error('adapter omitted structured timeout');
        adapter.mockImplementationOnce(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {
                outcome: 'error',
                statusCode: 408,
                usageAvailability: 'unreported',
            });
            throw httpTimeout;
        });
        await expect(runTranslationServiceConnectionTest('demo', {recordModelUsage}))
            .rejects.toBe(httpTimeout);
        expect(recordModelUsage).toHaveBeenNthCalledWith(2, [
            expect.objectContaining({
                purpose: 'connection-test',
                statusCode: 408,
                outcome: 'timeout',
            }),
        ]);
    });

    it('区分取消与不同结构化超时，并处理非对象错误', async () => {
        const abortError = new Error('caller cancelled');
        abortError.name = 'AbortError';
        adapter.mockRejectedValueOnce(abortError);
        await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe(abortError);

        for (const timeoutError of [
            Object.assign(new Error('named timeout'), {name: 'TimeoutError'}),
            Object.assign(new Error('http timeout'), {statusCode: 408}),
        ]) {
            adapter.mockRejectedValueOnce(timeoutError);
            await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe(timeoutError);
        }

        adapter.mockRejectedValueOnce('plain failure');
        await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe('plain failure');
    });

    it('统计写入的异步或同步失败都只告警，不改变连接测试结果', async () => {
        const asyncFailure = new Error('async usage failure');
        const syncFailure = new Error('sync usage failure');
        const warn = vi.fn();
        adapter.mockImplementation(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {usageAvailability: 'unreported'});
            return '测试译文';
        });

        await expect(runTranslationServiceConnectionTest('demo', {
            recordModelUsage: vi.fn(async () => { throw asyncFailure; }),
            warn,
        })).resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
        await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
            '[FluentRead] connection test usage write failed:',
            asyncFailure,
        ));

        await expect(runTranslationServiceConnectionTest('demo', {
            recordModelUsage: vi.fn(() => { throw syncFailure; }),
            warn,
        })).resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
        expect(warn).toHaveBeenCalledWith(
            '[FluentRead] connection test usage write failed:',
            syncFailure,
        );
    });

    it('复用统一服务错误格式化器', () => {
        expect(formatConnectionTestError('demo', new Error('plain failure'))).toBe('plain failure');
    });

    it('将 MiniMax 2049 错误转换为 Key、区域和计费类型提示', () => {
        const message = formatServiceError(
            services.minimax,
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('Token Plan Key');
        expect(message).toContain('api.minimaxi.com');
        expect(message).toContain('api.minimax.io');
        expect(message).toContain('不能互换');
    });

    it('将 MiMo 鉴权错误转换为 Key 前缀和集群提示', () => {
        const message = formatServiceError(
            services.mimo,
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('sk-');
        expect(message).toContain('tp-');
        expect(message).toContain('中国、新加坡或欧洲集群');
    });

    it('统一读取 Error 与非 Error 的消息', () => {
        expect(getServiceErrorMessage(new Error('from-error'))).toBe('from-error');
        expect(getServiceErrorMessage(503)).toBe('503');
    });

    it('网络错误增加可识别前缀，其他错误保持供应商原文', () => {
        expect(formatServiceError('demo', new Error('Failed to fetch endpoint')))
            .toBe('网络连接失败：Failed to fetch endpoint');
        expect(formatServiceError('demo', new Error('provider rejected request')))
            .toBe('provider rejected request');
    });

    it('空错误使用稳定兜底，并且鉴权提示只对匹配服务生效', () => {
        expect(formatServiceError('demo', '   ')).toBe('未知错误');
        expect(formatServiceError('demo', '401 Unauthorized')).toBe('401 Unauthorized');
    });
});
