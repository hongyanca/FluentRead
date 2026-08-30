/**
 * @file src/features/image-translation/background/remoteImageFetcher.ts
 * 文件职责：在后台网络权限边界中安全读取网页图片，为受 CORS 限制的内容脚本把允许的远程图片转换成可供 OCR 使用的 data URL。
 * 主要内容：定义 RemoteImageResponse 与可注入请求函数，先规范化 URL，再执行带响应体大小限制的请求，校验 image/* Content-Type 并调用 imageBufferToDataUrl。
 * 模块边界：该文件不接受任意协议、不解析图片像素也不显示结果；URL 与字节转换规则归 services/remoteImage，HTTP 实现由调用方注入，内容页仅经消息客户端访问。
 */
import {
    imageBufferToDataUrl,
    MAX_REMOTE_IMAGE_BYTES,
    normalizeRemoteImageMimeType,
    normalizeRemoteImageUrl,
    validateRemoteImageResponseUrl,
} from '@/src/features/image-translation/services/remoteImage';

export const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

export interface RemoteImageResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly url?: string;
    readonly headers: {
        get(name: string): string | null;
    };
    readonly body?: ReadableStream<Uint8Array> | null;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type RemoteImageRequest = (
    url: string,
    init: {credentials: 'omit'; redirect: 'error'; signal: AbortSignal},
) => Promise<RemoteImageResponse>;

function discardResponseBody(response: RemoteImageResponse, reason: unknown): void {
    if (response.body) void response.body.cancel(reason).catch(() => undefined);
}

async function readResponseBuffer(
    response: RemoteImageResponse,
    abortPromise: Promise<never>,
): Promise<ArrayBuffer> {
    if (!response.body) return Promise.race([response.arrayBuffer(), abortPromise]);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
        while (true) {
            const {done, value} = await Promise.race([reader.read(), abortPromise]);
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            byteLength += value.byteLength;
            if (byteLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片文件过大');
            chunks.push(value);
        }
    } catch (error) {
        void reader.cancel(error).catch(() => undefined);
        throw error;
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // 取消中的 reader 可能仍有未完成 read；底层 fetch signal 已负责终止传输。
        }
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes.buffer;
}

/** 读取远程图片；拒绝重定向，并对 URL、响应状态、MIME 与大小逐层验证。 */
export async function fetchRemoteImageForOcr(
    source: string,
    request: RemoteImageRequest,
): Promise<string> {
    const url = normalizeRemoteImageUrl(source);
    const controller = new AbortController();
    const timeoutError = new Error('远程图片读取超时');
    let onAbort!: () => void;
    const abortPromise = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(timeoutError);
        controller.signal.addEventListener('abort', onAbort, {once: true});
    });
    const timer = setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);

    try {
        const responseWork = request(url, {
            credentials: 'omit',
            // Fetch 的 manual 模式只返回不可检查 Location 的 opaqueredirect；使用 error
            // 才能保证浏览器不会在校验目标前向第二个地址发出请求。
            redirect: 'error',
            signal: controller.signal,
        });
        void responseWork.then((lateResponse) => {
            if (controller.signal.aborted) discardResponseBody(lateResponse, timeoutError);
        }, () => undefined);
        const response = await Promise.race([responseWork, abortPromise]);
        try {
            validateRemoteImageResponseUrl(url, response.url);
        } catch (error) {
            discardResponseBody(response, error);
            throw error;
        }
        if (!response.ok) {
            const error = new Error(`图片服务器返回 ${response.status}`);
            discardResponseBody(response, error);
            throw error;
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_REMOTE_IMAGE_BYTES) {
            const error = new Error('图片文件过大');
            discardResponseBody(response, error);
            throw error;
        }

        let mimeType: string;
        try {
            mimeType = normalizeRemoteImageMimeType(response.headers.get('content-type') || '');
        } catch (error) {
            discardResponseBody(response, error);
            throw error;
        }
        const buffer = await readResponseBuffer(response, abortPromise);
        return imageBufferToDataUrl(buffer, mimeType);
    } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
    }
}
