/**
 * @file src/features/full-page-translation/qqMailFrames.ts
 * 文件职责：定义旧版 QQ 邮箱 frame relay 使用的 URL 守卫、消息协议和包含页面识别范围的调用参数白名单。
 * 主要内容：严格区分 mail.qq.com 的 legacy frame_html 顶层与 readmail 子 frame，拒绝凭证、未知字段和伪造 frame 来源。
 * 模块边界：本文件只执行纯值校验，不访问浏览器 API、不读取 sid、不发送消息；后台转发由 background/qqMailFrameHandlers 负责。
 */
import type {PageTranslationInvocation} from './public';

export const QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE = 'qqMailFrameRequest' as const;
export const QQ_MAIL_FRAME_COMMAND_MESSAGE_TYPE = 'qqMailFrameCommand' as const;
export const QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE = 'qqMailFrameChanged' as const;
export const QQ_MAIL_FRAME_REFRESH_MESSAGE_TYPE = 'qqMailFrameRefresh' as const;

export type QQMailFrameAction = 'state' | 'toggle';

export interface QQMailFrameRequestMessage {
    type: typeof QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE;
    action: QQMailFrameAction;
    invocation?: PageTranslationInvocation;
}

export interface QQMailFrameCommandMessage {
    type: typeof QQ_MAIL_FRAME_COMMAND_MESSAGE_TYPE;
    action: QQMailFrameAction;
    invocation?: PageTranslationInvocation;
}

export interface QQMailFrameChangedMessage {
    type: typeof QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE;
}

export interface QQMailFrameRefreshMessage {
    type: typeof QQ_MAIL_FRAME_REFRESH_MESSAGE_TYPE;
}

export type QQMailFrameRequestOrChangedMessage = QQMailFrameRequestMessage | QQMailFrameChangedMessage;

const LEGACY_TOP_PATH = '/cgi-bin/frame_html';
const LEGACY_READ_PATH = '/cgi-bin/readmail';
const invocationKeys = new Set(['service', 'model', 'targetLanguage', 'displayMode', 'profileId', 'fullPageMode', 'glossaryIds', 'scope']);
const requestKeys = new Set(['type', 'action', 'invocation']);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHTTPSMailURL(value: unknown, pathname: string): URL | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.origin === 'https://mail.qq.com' && url.username === '' && url.password === '' && url.pathname === pathname
            ? url
            : null;
    } catch {
        return null;
    }
}

export function isQqMailLegacyTopUrl(value: unknown): value is string {
    return parseHTTPSMailURL(value, LEGACY_TOP_PATH) !== null;
}

export function isQqMailReadmailUrl(value: unknown): value is string {
    return parseHTTPSMailURL(value, LEGACY_READ_PATH) !== null;
}

function parseInvocation(value: unknown): PageTranslationInvocation | undefined {
    if (value === undefined) return undefined;
    if (!isObject(value)) throw new TypeError('QQ 邮箱 frame invocation 无效');
    for (const key of Object.keys(value)) {
        if (!invocationKeys.has(key)) throw new TypeError('QQ 邮箱 frame invocation 字段无效');
        if (key === 'glossaryIds') {
            if (value[key] !== null && (!Array.isArray(value[key]) || value[key].length > 100
                || !Array.from(value[key]).every(id => typeof id === 'string' && id.length <= 128))) {
                throw new TypeError('QQ 邮箱 frame glossaryIds 无效');
            }
            continue;
        }
        if (typeof value[key] !== 'string') throw new TypeError('QQ 邮箱 frame invocation 字段必须是字符串');
    }
    if (value.displayMode !== undefined && value.displayMode !== 'bilingual' && value.displayMode !== 'single') {
        throw new TypeError('QQ 邮箱 frame displayMode 无效');
    }
    if (value.fullPageMode !== undefined && value.fullPageMode !== 'viewport' && value.fullPageMode !== 'all') {
        throw new TypeError('QQ 邮箱 frame fullPageMode 无效');
    }
    if (value.scope !== undefined && value.scope !== 'content' && value.scope !== 'all') {
        throw new TypeError('QQ 邮箱 frame scope 无效');
    }
    return value as PageTranslationInvocation;
}

export function parseQQMailFrameRequest(value: unknown): QQMailFrameRequestMessage | null {
    if (!isObject(value) || value.type !== QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE) return null;
    if (Object.keys(value).some((key) => !requestKeys.has(key))) return null;
    if (value.action !== 'state' && value.action !== 'toggle') return null;
    if (value.action === 'state' && Object.prototype.hasOwnProperty.call(value, 'invocation')) return null;
    try {
        const invocation = parseInvocation(value.invocation);
        return invocation === undefined
            ? {type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: value.action}
            : {type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: value.action, invocation};
    } catch {
        return null;
    }
}

export function parseQQMailFrameChanged(value: unknown): QQMailFrameChangedMessage | null {
    if (!isObject(value) || value.type !== QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE) return null;
    return Object.keys(value).length === 1 ? {type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE} : null;
}

export function makeQQMailFrameCommand(
    action: QQMailFrameAction,
    invocation?: PageTranslationInvocation,
): QQMailFrameCommandMessage {
    return invocation === undefined
        ? {type: QQ_MAIL_FRAME_COMMAND_MESSAGE_TYPE, action}
        : {type: QQ_MAIL_FRAME_COMMAND_MESSAGE_TYPE, action, invocation};
}
