/**
 * @file src/features/image-translation/services/remoteImage.ts
 * 文件职责：定义远程图片抓取的纯安全规则，把候选 URL 限制为允许的 HTTP(S) 地址，并将受限字节响应编码为 OCR 可消费的 data URL。
 * 主要内容：包含 16 MiB 最大响应常量、URL/重定向的公网边界校验、图片 MIME 解析，以及 ArrayBuffer 到 data URL 的受限转换。
 * 模块边界：本文件不发起网络请求、不跟随重定向也不读取页面 DOM；后台 remoteImageFetcher 负责受控 fetch 和响应上限，内容页只能通过扩展消息获得结果。
 */
export const MAX_REMOTE_IMAGE_BYTES = 16 * 1024 * 1024;

const PRIVATE_REMOTE_IMAGE_ERROR = '不允许访问本地或私有网络图片';

function parseIpv4(hostname: string): number[] | null {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return null;
    // URL 构造器已把合法 IPv4 规范化为四段十进制，并拒绝越界段。
    return hostname.split('.').map(Number);
}

function isPrivateIpv4(parts: number[]): boolean {
    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
}

function parseIpv6(hostname: string): number[] | null {
    const value = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (!value.includes(':')) return null;
    // URL 已校验 IPv6 语法并把嵌入式 IPv4 转为十六进制；这里只展开一次 :: 压缩。
    const halves = value.split('::');
    const left = halves[0].split(':').filter(Boolean);
    const right = (halves[1] ?? '').split(':').filter(Boolean);
    const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return groups.map(group => Number.parseInt(group, 16));
}

function isPrivateIpv6(parts: number[]): boolean {
    const embeddedIpv4 = parts.slice(0, 5).every(part => part === 0)
        && (parts[5] === 0 || parts[5] === 0xffff)
        ? [parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff]
        : null;
    return parts.every(part => part === 0)
        || (parts.slice(0, 7).every(part => part === 0) && parts[7] === 1)
        || (parts[0] & 0xfe00) === 0xfc00
        || (parts[0] & 0xffc0) === 0xfe80
        || (embeddedIpv4 !== null && isPrivateIpv4(embeddedIpv4));
}

function assertPublicRemoteImageHost(url: URL): void {
    const hostname = url.hostname.replace(/\.$/u, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error(PRIVATE_REMOTE_IMAGE_ERROR);
    }
    const ipv4 = parseIpv4(hostname);
    if (ipv4 && isPrivateIpv4(ipv4)) throw new Error(PRIVATE_REMOTE_IMAGE_ERROR);
    const ipv6 = parseIpv6(hostname);
    if (ipv6 && isPrivateIpv6(ipv6)) throw new Error(PRIVATE_REMOTE_IMAGE_ERROR);
}

export function normalizeRemoteImageUrl(source: string): string {
    let url: URL;
    try {
        url = new URL(source);
    } catch {
        throw new Error('图片地址无效');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('只支持网页图片地址');
    }
    if (url.username || url.password) throw new Error('图片地址不能包含凭据');
    assertPublicRemoteImageHost(url);

    return url.href;
}

/** 校验 fetch 跟随重定向后的最终地址，并禁止 HTTPS 降级到 HTTP。 */
export function validateRemoteImageResponseUrl(initialUrl: string, responseUrl?: string): string {
    const normalizedInitial = normalizeRemoteImageUrl(initialUrl);
    const normalizedFinal = normalizeRemoteImageUrl(responseUrl || normalizedInitial);
    if (new URL(normalizedInitial).protocol === 'https:' && new URL(normalizedFinal).protocol !== 'https:') {
        throw new Error('图片重定向不能从 HTTPS 降级到 HTTP');
    }
    return normalizedFinal;
}

export function normalizeRemoteImageMimeType(contentType: string): string {
    const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (!mimeType?.startsWith('image/')) throw new Error('远程地址不是图片');
    return mimeType;
}

export function imageBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
    if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('图片文件过大');
    }

    const mimeType = normalizeRemoteImageMimeType(contentType);

    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return `data:${mimeType};base64,${btoa(binary)}`;
}
