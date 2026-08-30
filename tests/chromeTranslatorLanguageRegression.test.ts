import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {from: 'auto', to: 'zh-Hans'},
    createRequestId: vi.fn(() => 'chrome-request-1'),
    send: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));

import defaultChromeTranslator, {
    createChromeTranslationRequestId,
    createChromeTranslator,
} from '@/src/providers/translation/chrome-translator';
import {buildChromeOffscreenTranslationData} from '@/src/providers/translation/chromeTranslatorRequest';

const chromeTranslator = createChromeTranslator({
    capabilities: {chromeTranslation: true},
    offscreenClient: {send: mocks.send},
    createRequestId: mocks.createRequestId,
});

describe('Chrome translator 请求级语言回归', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.config, {from: 'auto', to: 'zh-Hans'});
        mocks.createRequestId.mockReturnValue('chrome-request-1');
        mocks.send.mockImplementation(async (request: {requestId?: unknown}) => ({
            success: true,
            result: '翻译结果',
            requestId: request.requestId,
        }));
    });

    it('纯 payload builder 使用请求覆盖，空白覆盖才回退配置快照', () => {
        expect(buildChromeOffscreenTranslationData({
            origin: 'hello', sourceLanguage: ' en ', targetLanguage: ' ja ',
        }, {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'})).toEqual({
            text: 'hello', from: 'en', to: 'ja',
        });
        expect(buildChromeOffscreenTranslationData({
            origin: 'hello', sourceLanguage: ' ', targetLanguage: undefined,
        }, {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'})).toEqual({
            text: 'hello', from: 'auto', to: 'zh-Hans',
        });
        expect(() => buildChromeOffscreenTranslationData({origin: null}, {
            sourceLanguage: 'auto', targetLanguage: 'zh-Hans',
        })).toThrow('翻译文本不能为空');
        expect(() => buildChromeOffscreenTranslationData({origin: '   '}, {
            sourceLanguage: 'auto', targetLanguage: 'zh-Hans',
        })).toThrow('翻译文本不能为空');
    });

    it('真实 provider 发往 offscreen 的 data 与 broker 请求覆盖完全一致', async () => {
        await expect(chromeTranslator({
            origin: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        })).resolves.toBe('翻译结果');

        expect(mocks.send).toHaveBeenCalledWith({
            type: 'CHROME_TRANSLATE_OFFSCREEN',
            requestId: 'chrome-request-1',
            data: {text: 'hello', from: 'en', to: 'ja'},
        }, {
            signal: undefined,
            timeoutMs: 45_000,
            cancelMessage: {
                type: 'CANCEL_CHROME_TRANSLATE_OFFSCREEN',
                requestId: 'chrome-request-1',
            },
        });
    });

    it('未覆盖语言时仍使用当前配置，非法原文不会发消息', async () => {
        await expect(chromeTranslator({origin: 'hello'})).resolves.toBe('翻译结果');
        expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({
            data: {text: 'hello', from: 'auto', to: 'zh-Hans'},
        }), expect.any(Object));

        mocks.send.mockClear();
        await expect(chromeTranslator({origin: ''})).rejects.toThrow('翻译文本不能为空');
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('默认 unknown 构建保守拒绝 Chrome provider，且不会触碰 Offscreen', async () => {
        await expect(defaultChromeTranslator({origin: 'hello'}))
            .rejects.toThrow('当前浏览器不支持 Chrome 内置翻译');
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('AbortSignal 仅作为 client 控制参数传递，runtime payload 保持可克隆', async () => {
        const controller = new AbortController();
        let receivedOptions: {signal?: AbortSignal} | undefined;
        mocks.send.mockImplementationOnce((_request: unknown, options: {signal?: AbortSignal}) => {
            receivedOptions = options;
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {once: true});
            });
        });

        const pending = chromeTranslator({
            origin: 'hello',
            abortSignal: controller.signal,
            requestTimeoutMs: 1_234,
        });
        await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
        const [runtimePayload, options] = mocks.send.mock.calls[0] as unknown as [
            Record<string, unknown>,
            Record<string, unknown>,
        ];
        expect(runtimePayload).not.toHaveProperty('abortSignal');
        expect(runtimePayload).toEqual(expect.objectContaining({requestId: 'chrome-request-1'}));
        expect(options).toMatchObject({signal: controller.signal, timeoutMs: 1_234});
        expect(receivedOptions?.signal).toBe(controller.signal);

        controller.abort();
        await expect(pending).rejects.toThrow('Chrome Translation API 不可用：cancelled');
    });

    it('拒绝缺失或错配 requestId 的迟到响应', async () => {
        mocks.send.mockResolvedValueOnce({success: true, result: '旧结果', requestId: 'old-request'});
        await expect(chromeTranslator({origin: 'hello'})).rejects.toThrow('requestId 不匹配');

        mocks.send.mockResolvedValueOnce({success: false, error: '请求已取消', requestId: 'chrome-request-1'});
        await expect(chromeTranslator({origin: 'hello'})).rejects.toThrow('请求已取消');

        mocks.send.mockResolvedValueOnce({success: false, requestId: 'chrome-request-1'});
        await expect(chromeTranslator({origin: 'hello'})).rejects.toThrow('无效的翻译响应');

        mocks.send.mockRejectedValueOnce('string failure');
        await expect(chromeTranslator({origin: 'hello'})).rejects.toThrow('未知错误');
    });

    it('生产 requestId 使用浏览器安全随机 UUID', () => {
        const randomUUID = vi.fn(() => '00000000-0000-4000-8000-000000000001');
        vi.stubGlobal('crypto', {randomUUID});
        expect(createChromeTranslationRequestId()).toBe('00000000-0000-4000-8000-000000000001');
        expect(randomUUID).toHaveBeenCalledOnce();
    });
});
