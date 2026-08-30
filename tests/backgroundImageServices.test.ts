import {afterEach, describe, expect, it, vi} from 'vitest';

import {createImageOcrLanguageRepository} from '@/src/features/image-translation/background/ocrLanguageRepository';
import {
    fetchRemoteImageForOcr,
    REMOTE_IMAGE_TIMEOUT_MS,
    type RemoteImageResponse,
} from '@/src/features/image-translation/background/remoteImageFetcher';
import {IMAGE_OCR_LANGUAGE_STATE_KEY} from '@/src/features/image-translation/ocrLanguages';
import {MAX_REMOTE_IMAGE_BYTES} from '@/src/features/image-translation/services/remoteImage';

function response(options: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    contentLength?: string | null;
    bytes?: number[];
    url?: string;
    body?: ReadableStream<Uint8Array> | null;
    arrayBuffer?: () => Promise<ArrayBuffer>;
} = {}): RemoteImageResponse {
    const headers = new Map<string, string>();
    if (options.contentType !== null) headers.set('content-type', options.contentType ?? 'image/png');
    if (options.contentLength !== null) headers.set('content-length', options.contentLength ?? '2');
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        url: options.url,
        headers: {get: (name) => headers.get(name) ?? null},
        body: options.body,
        arrayBuffer: options.arrayBuffer ?? (async () => new Uint8Array(options.bytes ?? [1, 2]).buffer),
    };
}

describe('图片后台服务', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('OCR 语言仓库归一化读取并合并持久化下载状态', async () => {
        const get = vi.fn(async () => ({
            [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'bad', 'eng'],
        }));
        const set = vi.fn(async () => undefined);
        const repository = createImageOcrLanguageRepository({get, set});

        await expect(repository.getDownloaded()).resolves.toEqual(['eng']);
        await expect(repository.markDownloaded(['chi_sim', 'eng'])).resolves.toEqual(['eng', 'chi_sim']);
        expect(get).toHaveBeenCalledWith(IMAGE_OCR_LANGUAGE_STATE_KEY);
        expect(set).toHaveBeenCalledWith({
            [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'chi_sim'],
        });
    });

    it('OCR 语言仓库串行合并并发下载结果，避免后写覆盖先写', async () => {
        let downloaded: unknown = [];
        let releaseFirstWrite!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let allowFirstWrite!: () => void;
        const firstWriteGate = new Promise<void>((resolve) => {
            allowFirstWrite = resolve;
        });
        let writeCount = 0;
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: downloaded,
            })),
            set: vi.fn(async (values: Record<string, unknown>) => {
                writeCount += 1;
                if (writeCount === 1) {
                    releaseFirstWrite();
                    await firstWriteGate;
                }
                downloaded = values[IMAGE_OCR_LANGUAGE_STATE_KEY];
            }),
        };
        const repository = createImageOcrLanguageRepository(storage);

        const english = repository.markDownloaded(['eng']);
        await firstWriteStarted;
        const chinese = repository.markDownloaded(['chi_sim']);
        await Promise.resolve();
        expect(storage.get).toHaveBeenCalledOnce();

        allowFirstWrite();
        await expect(english).resolves.toEqual(['eng']);
        await expect(chinese).resolves.toEqual(['eng', 'chi_sim']);
        expect(downloaded).toEqual(['eng', 'chi_sim']);
        expect(storage.get).toHaveBeenCalledTimes(2);
    });

    it('OCR 语言仓库在一次持久化失败后仍会继续后续合并', async () => {
        let downloaded: unknown = ['eng'];
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: downloaded,
            })),
            set: vi.fn()
                .mockRejectedValueOnce(new Error('write failed'))
                .mockImplementationOnce(async (values: Record<string, unknown>) => {
                    downloaded = values[IMAGE_OCR_LANGUAGE_STATE_KEY];
                }),
        };
        const repository = createImageOcrLanguageRepository(storage);

        await expect(repository.markDownloaded(['chi_sim'])).rejects.toThrow('write failed');
        await expect(repository.markDownloaded(['jpn'])).resolves.toEqual(['eng', 'jpn']);
        expect(downloaded).toEqual(['eng', 'jpn']);
    });

    it('OCR 语言仓库允许已安装组合并报告缺失语言包中文名', async () => {
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng'],
            })),
            set: vi.fn(async () => undefined),
        };
        const repository = createImageOcrLanguageRepository(storage);

        await expect(repository.assertDownloaded('en')).resolves.toBeUndefined();
        await expect(repository.assertDownloaded('zh-Hans')).rejects.toThrow(
            '图片文字识别需要先下载简体中文语言包，请前往设置 > 图片翻译下载',
        );
        storage.get.mockResolvedValueOnce({});
        await expect(repository.assertDownloaded('auto')).rejects.toThrow('简体中文、English');
    });

    it('远程图片读取省略凭据、拒绝重定向并转换为 data URL', async () => {
        const request = vi.fn(async () => response({contentLength: null, bytes: [0, 255]}));
        await expect(fetchRemoteImageForOcr('https://example.com/a.png', request))
            .resolves.toBe('data:image/png;base64,AP8=');
        expect(request).toHaveBeenCalledWith(
            'https://example.com/a.png',
            {
                credentials: 'omit',
                redirect: 'error',
                signal: expect.any(AbortSignal),
            },
        );
    });

    it('浏览器报告重定向错误时不会自行发起第二次请求', async () => {
        const request = vi.fn(async () => {
            throw new TypeError('Failed to fetch because redirect mode is error');
        });

        await expect(fetchRemoteImageForOcr('https://example.com/redirect', request))
            .rejects.toThrow('redirect mode is error');
        expect(request).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledWith(
            'https://example.com/redirect',
            expect.objectContaining({redirect: 'error'}),
        );
    });

    it.each([
        'https://user:pass@example.com/a.png',
        'http://localhost/a.png',
        'http://assets.localhost/a.png',
        'http://127.0.0.1/a.png',
        'http://10.0.0.1/a.png',
        'http://169.254.1.1/a.png',
        'http://172.16.0.1/a.png',
        'http://192.168.1.1/a.png',
        'http://[::1]/a.png',
        'http://[fe80::1]/a.png',
        'http://[fc00::1]/a.png',
    ])('初始 URL 越过公网边界时在 request 前拒绝：%s', async (url) => {
        const request = vi.fn(async () => response());
        await expect(fetchRemoteImageForOcr(url, request)).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    });

    it('远程图片读取拒绝 HTTP 失败、声明过大和非图片响应', async () => {
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({ok: false, status: 403}),
        )).rejects.toThrow('图片服务器返回 403');
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentLength: String(MAX_REMOTE_IMAGE_BYTES + 1)}),
        )).rejects.toThrow('图片文件过大');
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentType: null}),
        )).rejects.toThrow('远程地址不是图片');
    });

    it('Content-Type 明确非图片时在读取 body 前拒绝', async () => {
        const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
        const getReader = vi.fn();
        const cancel = vi.fn(async () => undefined);
        const body = {getReader, cancel} as unknown as ReadableStream<Uint8Array>;

        await expect(fetchRemoteImageForOcr(
            'https://example.com/not-image',
            async () => response({contentType: 'text/html; charset=utf-8', body, arrayBuffer}),
        )).rejects.toThrow('远程地址不是图片');
        expect(getReader).not.toHaveBeenCalled();
        expect(arrayBuffer).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('fetch 悬挂时在 15 秒总 deadline 中止底层 signal', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        let resolveLate!: (value: RemoteImageResponse) => void;
        const lateCancel = vi.fn(async () => undefined);
        const lateBody = {
            getReader: vi.fn(),
            cancel: lateCancel,
        } as unknown as ReadableStream<Uint8Array>;
        const request = vi.fn((_url: string, init: {signal: AbortSignal}) => {
            signal = init.signal;
            return new Promise<RemoteImageResponse>(resolve => {
                resolveLate = resolve;
            });
        });

        const result = fetchRemoteImageForOcr('https://example.com/a.png', request);
        const rejection = expect(result).rejects.toThrow('远程图片读取超时');
        await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(signal?.aborted).toBe(true);

        resolveLate(response({body: lateBody}));
        await Promise.resolve();
        expect(lateCancel).toHaveBeenCalledOnce();
    });

    it('响应体读取悬挂时中止 fetch 并取消 reader', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        const reader = {
            read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        const body = {
            getReader: () => reader,
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStream<Uint8Array>;
        const request = vi.fn(async (_url: string, init: {signal: AbortSignal}) => {
            signal = init.signal;
            return response({contentLength: null, body});
        });

        const result = fetchRemoteImageForOcr('https://example.com/a.png', request);
        const rejection = expect(result).rejects.toThrow('远程图片读取超时');
        await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS);
        await rejection;
        expect(signal?.aborted).toBe(true);
        expect(reader.cancel).toHaveBeenCalledOnce();
    });

    it('流式 body 达到 MAX+1 时立即取消 reader，且不调用 arrayBuffer fallback', async () => {
        const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({done: false, value: new Uint8Array(MAX_REMOTE_IMAGE_BYTES + 1)})
                .mockResolvedValueOnce({done: true, value: undefined}),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(() => {
                throw new Error('pending read');
            }),
        };
        const body = {
            getReader: () => reader,
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStream<Uint8Array>;

        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentLength: null, body, arrayBuffer}),
        )).rejects.toThrow('图片文件过大');
        expect(reader.cancel).toHaveBeenCalledOnce();
        expect(reader.read).toHaveBeenCalledOnce();
        expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('流式 body 忽略空 chunk 并按顺序合并有效字节', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({done: false, value: new Uint8Array()})
                .mockResolvedValueOnce({done: false, value: new Uint8Array([0])})
                .mockResolvedValueOnce({done: false, value: new Uint8Array([255])})
                .mockResolvedValueOnce({done: true, value: undefined}),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        const body = {
            getReader: () => reader,
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStream<Uint8Array>;

        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentLength: null, body}),
        )).resolves.toBe('data:image/png;base64,AP8=');
        expect(reader.cancel).not.toHaveBeenCalled();
        expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it('无 reader 的 fallback 在读取后校验实际大小', async () => {
        const arrayBuffer = vi.fn(async () => new ArrayBuffer(MAX_REMOTE_IMAGE_BYTES + 1));
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentLength: null, body: null, arrayBuffer}),
        )).rejects.toThrow('图片文件过大');
        expect(arrayBuffer).toHaveBeenCalledOnce();
    });

    it('对注入响应的最终 URL 保持纵深校验，拒绝 HTTPS 降级和私网目标', async () => {
        const arrayBuffer = vi.fn(async () => new Uint8Array([1]).buffer);
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({url: 'http://cdn.example.com/a.png', arrayBuffer}),
        )).rejects.toThrow('HTTPS 降级');
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({url: 'https://127.0.0.1/a.png', arrayBuffer}),
        )).rejects.toThrow('本地或私有网络');
        expect(arrayBuffer).not.toHaveBeenCalled();

        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({url: 'https://cdn.example.net/a.png', bytes: [3]}),
        )).resolves.toBe('data:image/png;base64,Aw==');
    });
});
