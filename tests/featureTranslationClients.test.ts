import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    captureVisibleAreaInExtension,
    translateCapturedAreaInExtension,
} from '@/src/features/area-translation/services/client';
import {
    fetchImageInExtension,
    translateImageInExtension,
} from '@/src/features/image-translation/services/client';

const {sendMessage} = vi.hoisted(() => ({sendMessage: vi.fn()}));

vi.mock('webextension-polyfill', () => ({
    default: {runtime: {sendMessage}},
}));

beforeEach(() => {
    sendMessage.mockReset();
    vi.stubGlobal('browser', {runtime: {sendMessage}});
});

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('圈选翻译内容脚本客户端', () => {
    it('通过后台读取当前可见页面，并保留协议消息', async () => {
        sendMessage.mockResolvedValue({success: true, image: 'data:image/png;base64,area'});

        await expect(captureVisibleAreaInExtension()).resolves.toBe('data:image/png;base64,area');
        expect(sendMessage).toHaveBeenCalledWith({type: 'fluentReadAreaCapture'});
    });

    it.each([
        [{success: false, error: '截图权限不足'}, '截图权限不足'],
        [undefined, '无法读取当前页面区域'],
        [{success: true}, '无法读取当前页面区域'],
    ])('拒绝无效截图响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(captureVisibleAreaInExtension()).rejects.toThrow(message);
    });

    it('发送完整选区上下文并验证独立原文译文结果', async () => {
        const lines = [{text: '你好', bbox: {x0: 0, y0: 0, x1: 10, y1: 8}, backgroundColor: '#fff'}];
        sendMessage.mockResolvedValue({success: true, image: 'translated', lines, sourceText: 'Hello', translatedText: '你好', service: 'google', serviceName: '谷歌翻译', model: '', mode: 'standard', warnings: ['standard-quality'], recognitionMethod: 'ocr', recognitionFallback: 'unknown'});
        const selection = {left: 1, top: 2, width: 30, height: 20, viewportWidth: 800, viewportHeight: 600};

        await expect(translateCapturedAreaInExtension('capture', selection, 'en', 'Article', {
            requestId: 'area-1', timeoutMs: 5_000,
        })).resolves.toEqual({
            image: 'translated',
            lines, sourceText: 'Hello', translatedText: '你好', service: 'google', serviceName: '谷歌翻译', model: '', mode: 'standard', warnings: ['standard-quality'], recognitionMethod: 'ocr', recognitionFallback: 'unknown',
        });
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'fluentReadAreaTranslateCapture',
            image: 'capture',
            selection,
            sourceLanguage: 'en',
            title: 'Article',
            requestId: 'area-1',
            timeoutMs: 5_000,
        });
    });

    it('AI校正文独立返回，原始OCR原文保持可核对', async () => {
        const result = {image: 'crop', lines: [], service: 'openai', serviceName: 'OpenAI', model: 'gpt-4o', sourceText: 'He11o', correctedText: 'Hello', translatedText: '你好', mode: 'ai', warnings: ['ai-text-only']};
        sendMessage.mockResolvedValue({success: true, ...result});
        await expect(translateCapturedAreaInExtension('capture', {left: 0, top: 0, width: 20, height: 20, viewportWidth: 100, viewportHeight: 100}, 'en', '')).resolves.toEqual(result);
    });

    it.each([
        {image: 1}, {image: ''}, {sourceText: null}, {translatedText: null}, {translatedText: ' '},
        {service: null}, {service: ' '}, {serviceName: null}, {serviceName: ''}, {model: null}, {mode: 'vision'}, {warnings: null}, {warnings: ['unknown']}, {correctedText: 1},
    ])('圈选结果各字段必须符合独立文本协议 %#', async invalid => {
        sendMessage.mockResolvedValue({success: true, image: 'crop', lines: [], sourceText: 'Hello', translatedText: '你好', service: 'google', serviceName: '谷歌翻译', model: '', mode: 'standard', warnings: [], ...invalid});
        await expect(translateCapturedAreaInExtension('capture', {left: 0, top: 0, width: 20, height: 20, viewportWidth: 100, viewportHeight: 100}, 'en', '')).rejects.toThrow('圈选翻译服务不可用');
    });

    it('取消圈选翻译时发送 area cancel，并忽略后台迟到结果', async () => {
        let resolveOperation!: (value: unknown) => void;
        sendMessage
            .mockImplementationOnce(() => new Promise(resolve => { resolveOperation = resolve; }))
            .mockResolvedValueOnce({success: true, cancelled: true});
        const controller = new AbortController();
        const pending = translateCapturedAreaInExtension('capture', {
            left: 0, top: 0, width: 20, height: 20, viewportWidth: 100, viewportHeight: 100,
        }, 'en', 'Article', {
            requestId: 'area-pending', signal: controller.signal, timeoutMs: 5_000,
        });
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());

        controller.abort();

        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).toHaveBeenNthCalledWith(2, {
            type: 'fluentReadAreaCancel',
            requestId: 'area-pending',
        });
        resolveOperation({success: true, image: 'late', lines: []});
    });

    it.each([
        [{success: false, error: 'OCR 失败'}, 'OCR 失败'],
        [undefined, '圈选翻译服务不可用'],
        [{success: true, image: 'translated', lines: null}, '圈选翻译服务不可用'],
        [{success: true, lines: []}, '圈选翻译服务不可用'],
    ])('拒绝无效圈选翻译响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(translateCapturedAreaInExtension('capture', {
            left: 0,
            top: 0,
            width: 10,
            height: 10,
            viewportWidth: 100,
            viewportHeight: 100,
        }, 'auto', '')).rejects.toThrow(message);
    });
});

describe('图片翻译内容脚本客户端', () => {
    it('未指定 requestId 时使用跨页面安全随机 UUID', async () => {
        sendMessage.mockResolvedValue({success: true, image: 'data:image/png;base64,AA=='});

        await fetchImageInExtension('https://example.test/a.png');
        await fetchImageInExtension('https://example.test/b.png');
        const requestIds = sendMessage.mock.calls.map(([message]) => message.requestId as string);

        expect(requestIds).toHaveLength(2);
        expect(new Set(requestIds).size).toBe(2);
        requestIds.forEach(requestId => expect(requestId).toMatch(
            /^image-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
        ));
    });

    it('安全随机 API 不可用时使用进程随机 nonce，而不是跨页面 Date+计数器', async () => {
        const originalCrypto = globalThis.crypto;
        try {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                value: {getRandomValues: () => { throw new Error('random unavailable'); }},
            });
            vi.resetModules();
            const fallbackClient = await import('@/src/features/image-translation/services/client');
            sendMessage.mockResolvedValue({success: true, image: 'data:image/png;base64,AA=='});

            await fallbackClient.fetchImageInExtension('https://example.test/a.png');

            expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
                requestId: expect.stringMatching(/^image-[a-z0-9-]+-1$/u),
            }));
        } finally {
            Object.defineProperty(globalThis, 'crypto', {configurable: true, value: originalCrypto});
            vi.resetModules();
        }
    });

    it('预取消信号不会发送业务请求，超时会发送同 requestId 的取消消息', async () => {
        const preCancelled = new AbortController();
        preCancelled.abort();
        await expect(fetchImageInExtension('https://example.test/a.png', {
            requestId: 'pre-cancelled',
            signal: preCancelled.signal,
        })).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).not.toHaveBeenCalled();

        sendMessage
            .mockImplementationOnce(() => new Promise(() => undefined))
            .mockResolvedValueOnce({success: true, cancelled: true});
        const timedOut = translateImageInExtension('image', 'en', 'Page', {
            requestId: 'translate-timeout',
            timeoutMs: 1,
        });

        await expect(timedOut).rejects.toMatchObject({name: 'TimeoutError'});
        expect(sendMessage).toHaveBeenNthCalledWith(2, {
            type: 'fluentReadImageCancel',
            requestId: 'translate-timeout',
        });
    });

    it('跨域图片读取通过后台消息转发到 Offscreen，并校验 data URL', async () => {
        sendMessage.mockResolvedValueOnce({success: true, image: 'data:image/png;base64,remote'});

        await expect(fetchImageInExtension('https://pbs.twimg.com/media/demo.png', {
            requestId: 'fetch-1', timeoutMs: 15_000,
        })).resolves.toBe('data:image/png;base64,remote');
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'fluentReadImageFetch',
            url: 'https://pbs.twimg.com/media/demo.png',
            requestId: 'fetch-1',
            timeoutMs: 15_000,
        });

        sendMessage.mockResolvedValueOnce({success: true, image: 'not-data'});
        await expect(fetchImageInExtension('https://pbs.twimg.com/media/demo.png')).rejects.toThrow('远程图片读取失败');
    });


    it('返回完整图片翻译结果并保留页面上下文', async () => {
        // Freeze only the external monotonic clock for this exact entry budget assertion.
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const lines = [{text: '你好', bbox: {x0: 1, y0: 2, x1: 3, y1: 4}, backgroundColor: '#fff'}];
        sendMessage.mockResolvedValue({success: true, image: 'translated', lines});

        await expect(translateImageInExtension('image', 'en', 'Page', {
            requestId: 'translate-1', timeoutMs: 5_000,
        })).resolves.toEqual({image: 'translated', lines});
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'fluentReadImageTranslate',
            image: 'image',
            sourceLanguage: 'en',
            title: 'Page',
            requestId: 'translate-1',
            timeoutMs: 5_000,
        });
    });

    it('页面取消图片翻译时发送同 requestId 的取消消息并立即拒绝', async () => {
        let resolveOperation!: (value: unknown) => void;
        sendMessage
            .mockImplementationOnce(() => new Promise(resolve => { resolveOperation = resolve; }))
            .mockResolvedValueOnce({success: true, cancelled: true});
        const controller = new AbortController();
        const pending = translateImageInExtension('image', 'en', 'Page', {
            requestId: 'translate-pending',
            signal: controller.signal,
            timeoutMs: 5_000,
        });
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());

        controller.abort();

        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).toHaveBeenNthCalledWith(2, {
            type: 'fluentReadImageCancel',
            requestId: 'translate-pending',
        });
        resolveOperation({success: true, image: 'late', lines: []});
    });

    it('把非有限 timeoutMs 归一化为图片操作默认预算', async () => {
        // Freeze only the external monotonic clock for this exact entry budget assertion.
        vi.spyOn(performance, 'now').mockReturnValue(0);
        sendMessage.mockResolvedValue({success: true, image: 'translated', lines: []});

        await expect(translateImageInExtension('image', 'en', 'Page', {
            requestId: 'translate-nan', timeoutMs: Number.NaN,
        })).resolves.toEqual({image: 'translated', lines: []});
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            requestId: 'translate-nan',
            timeoutMs: 180_000,
        }));
    });

    it.each([
        [{success: false, error: '翻译失败'}, '翻译失败'],
        [undefined, '图片翻译服务不可用'],
        [{success: true, image: 'translated'}, '图片翻译服务不可用'],
        [{success: true, lines: []}, '图片翻译服务不可用'],
    ])('拒绝无效图片翻译响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(translateImageInExtension('image', 'auto', '')).rejects.toThrow(message);
    });

});
