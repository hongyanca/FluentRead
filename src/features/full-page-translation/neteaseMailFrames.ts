/**
 * @file src/features/full-page-translation/neteaseMailFrames.ts
 * 文件职责：限定网易免费邮箱阅读页与其正文子文档的消息边界。
 * 主要内容：识别 163/126/yeah 的 js6 阅读路由、同源正文 frame 和独立消息类型。
 * 模块边界：只校验 URL 和消息形状；不读取邮件内容、登录参数或页面 DOM。
 */
import {parseQQMailFrameRequest} from './qqMailFrames';
import type {PageTranslationInvocation} from './public';

export const NETEASE_MAIL_FRAME_REQUEST_MESSAGE_TYPE = 'neteaseMailFrameRequest' as const;
export const NETEASE_MAIL_FRAME_COMMAND_MESSAGE_TYPE = 'neteaseMailFrameCommand' as const;
export const NETEASE_MAIL_FRAME_CHANGED_MESSAGE_TYPE = 'neteaseMailFrameChanged' as const;
export const NETEASE_MAIL_FRAME_REFRESH_MESSAGE_TYPE = 'neteaseMailFrameRefresh' as const;

const MAIL_HOST = /^(?:[a-z0-9-]+\.)?mail\.(?:163\.com|126\.com|yeah\.net)$/u;

function parseTop(value: unknown): URL | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && MAIL_HOST.test(url.hostname) && url.username === ''
            && url.password === '' && url.port === '' && url.pathname === '/js6/main.jsp' ? url : null;
    } catch { return null; }
}

export function isNeteaseMailTopUrl(value: unknown): value is string {
    return parseTop(value) !== null;
}

export function isNeteaseMailReadUrl(value: unknown): value is string {
    const url = parseTop(value);
    return Boolean(url && /^#module=read\.ReadModule(?:%7c|\||$)/iu.test(url.hash));
}

/** about:blank/srcdoc 只在其匹配的邮箱父页面内授权；普通同源子文档也须同站。 */
export function isNeteaseMailChildUrl(value: unknown, topValue: unknown): boolean {
    const top = parseTop(topValue);
    if (!top || typeof value !== 'string') return false;
    if (value === 'about:blank' || value === 'about:srcdoc') return true;
    try {
        const child = new URL(value);
        return child.origin === top.origin && child.username === '' && child.password === ''
            && child.href !== top.href;
    } catch { return false; }
}

export interface NeteaseMailFrameRequest {
    type: typeof NETEASE_MAIL_FRAME_REQUEST_MESSAGE_TYPE;
    action: 'state' | 'toggle';
    invocation?: PageTranslationInvocation;
}

export function parseNeteaseMailFrameRequest(value: unknown): NeteaseMailFrameRequest | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value as {type?: unknown}).type !== NETEASE_MAIL_FRAME_REQUEST_MESSAGE_TYPE) return null;
    const parsed = parseQQMailFrameRequest({...value, type: 'qqMailFrameRequest'});
    return parsed ? {...parsed, type: NETEASE_MAIL_FRAME_REQUEST_MESSAGE_TYPE} : null;
}

export function parseNeteaseMailFrameChanged(value: unknown): boolean {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === 1
        && (value as {type?: unknown}).type === NETEASE_MAIL_FRAME_CHANGED_MESSAGE_TYPE);
}
