/**
 * @file src/features/selection-translation/protocol.ts
 * 文件职责：定义划词 TTS 跨 content、background 与 Offscreen 的稳定路由协议，以 tabId 和 clientRequestId 精确标识一次播放所有权。
 * 主要内容：包含播放请求与 ended/stopped/error 状态类型、各字段严格解析、路由相等与消息匹配函数，以及基于 crypto 的客户端请求编号生成。
 * 模块边界：协议模块不发送消息、不维护当前播放状态也不合成音频；内容控制器和后台 handler 分别消费这些纯契约，随机源可注入以保持可测试性。
 */
/**
 * 划词 TTS 跨 content、MV3 background 和 offscreen 的稳定路由身份。
 * `clientRequestId` 由 content 在每次远程播放前生成，不依赖可随时重启的 Service Worker 内存。
 */
export interface SelectionTtsRoute {
    readonly tabId: number;
    readonly clientRequestId: string;
}

export interface SelectionTtsPlaybackRequest extends SelectionTtsRoute {
    readonly audioBase64?: string;
    readonly contentType?: string;
    readonly sourceUrl?: string;
}

export type SelectionTtsPlaybackState = 'ended' | 'stopped' | 'error';

const PLAYBACK_STATES = new Set<SelectionTtsPlaybackState>(['ended', 'stopped', 'error']);

export function parseSelectionTtsTabId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError('TTS tabId 必须是非负安全整数');
    }
    return value;
}

export function parseSelectionTtsClientRequestId(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('TTS clientRequestId 必须是非空字符串');
    const normalized = value.trim();
    if (!normalized || normalized.length > 128) {
        throw new TypeError('TTS clientRequestId 必须是非空字符串');
    }
    return normalized;
}

export function parseSelectionTtsRoute(value: unknown): SelectionTtsRoute {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('TTS 路由必须是对象');
    }
    const record = value as Record<string, unknown>;
    return {
        tabId: parseSelectionTtsTabId(record.tabId),
        clientRequestId: parseSelectionTtsClientRequestId(record.clientRequestId),
    };
}

export function parseSelectionTtsPlaybackState(value: unknown): SelectionTtsPlaybackState {
    if (typeof value !== 'string' || !PLAYBACK_STATES.has(value as SelectionTtsPlaybackState)) {
        throw new TypeError('TTS state 无效');
    }
    return value as SelectionTtsPlaybackState;
}

export function sameSelectionTtsRoute(left: SelectionTtsRoute, right: SelectionTtsRoute): boolean {
    return left.tabId === right.tabId && left.clientRequestId === right.clientRequestId;
}

export function matchesSelectionTtsClientRequest(
    candidate: unknown,
    activeClientRequestId: string | null,
    pendingClientRequestId: string | null,
): candidate is string {
    return typeof candidate === 'string'
        && (candidate === activeClientRequestId || candidate === pendingClientRequestId);
}

type SelectionTtsRandomSource = Pick<Crypto, 'getRandomValues'> & {
    readonly randomUUID?: () => string;
};

/** 使用浏览器 CSPRNG 生成不会随组件或 worker 重建复用的请求 ID。 */
export function createSelectionTtsClientRequestId(
    randomSource: SelectionTtsRandomSource = globalThis.crypto,
): string {
    if (typeof randomSource.randomUUID === 'function') {
        return parseSelectionTtsClientRequestId(randomSource.randomUUID());
    }

    // randomUUID 只在 secure context 中保证暴露；HTTP 页的 content script
    // 仍可使用 getRandomValues 生成等价的 RFC 4122 v4 身份。
    const bytes = randomSource.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
