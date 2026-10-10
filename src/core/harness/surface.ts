/**
 * @file src/core/harness/surface.ts
 * 文件职责：移植 DeepSeek Harness 的会话事件投影规则，为短阅读会话提供只追加的模型消息视图。
 * 主要内容：保留上游三类消息事件与 surface marker、空助手消息跳过规则，校验连续序号，并在写入和快照边界复制数据以保护原始事件。
 * 模块边界：源自 dsh-v0.1.3-alpha.1 的 session/surface.ts；仅适配追加子集，不包含替换历史、磁盘持久化、Cordis 或浏览器 API，来源见 docs/guide/deepseek-harness.md。
 */
export type HarnessSurfaceType = 'user/message' | 'assistant/message' | 'tool/result';
export interface HarnessMessage {role: 'user' | 'assistant' | 'tool'; content: unknown}
export interface HarnessEvent {
    seq: number;
    type: HarnessSurfaceType | 'turn/start' | 'step/start' | 'step/end' | 'assistant/attempt';
    data: unknown;
    surfaceOp?: 'append';
}

const SURFACE_EVENT_TYPES = new Set<string>(['user/message', 'assistant/message', 'tool/result']);

export function isSurfaceEligibleType(type: string): boolean { return SURFACE_EVENT_TYPES.has(type); }

export function isSurfaceEvent(event: HarnessEvent): boolean {
    return SURFACE_EVENT_TYPES.has(event.type) && event.surfaceOp !== undefined;
}

export function deriveEventMessage(event: HarnessEvent): HarnessMessage | null {
    if (event.type === 'user/message') {
        return event.data as HarnessMessage;
    }
    if (event.type === 'assistant/message') {
        const message = (event.data as {message?: HarnessMessage}).message;
        return !message || !Array.isArray(message.content) || message.content.length === 0 ? null : message;
    }
    if (event.type === 'tool/result') {
        return (event.data as {message?: HarnessMessage}).message ?? null;
    }
    return null;
}

export function foldSurface(events: readonly HarnessEvent[]): HarnessEvent[] {
    const surface: HarnessEvent[] = [];
    events.forEach((event, index) => {
        if (event.seq !== index) throw new Error(`session event seq ${event.seq} is not contiguous; expected ${index}`);
        if (event.surfaceOp !== undefined && !isSurfaceEligibleType(event.type)) {
            throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`);
        }
        if (isSurfaceEligibleType(event.type) && event.surfaceOp === undefined) {
            throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`);
        }
        if (isSurfaceEvent(event)) surface.push(event);
    });
    return surface;
}

export function deriveMessages(events: readonly HarnessEvent[]): HarnessMessage[] {
    return foldSurface(events).flatMap(event => {
        const message = deriveEventMessage(event);
        return message === null ? [] : [message];
    });
}

export class HarnessLedger {
    private readonly events: HarnessEvent[] = [];

    append(type: HarnessEvent['type'], data: unknown, surfaceOp?: 'append'): HarnessEvent {
        const event: HarnessEvent = Object.freeze({
            seq: this.events.length,
            type,
            data: structuredClone(data),
            ...surfaceOp === undefined ? {} : {surfaceOp},
        });
        this.events.push(event);
        return structuredClone(event);
    }

    appendUser(message: HarnessMessage): HarnessEvent { return this.append('user/message', message, 'append'); }
    appendAssistant(message: HarnessMessage): HarnessEvent { return this.append('assistant/message', {message}, 'append'); }
    appendToolResult(message: HarnessMessage): HarnessEvent { return this.append('tool/result', {message}, 'append'); }
    eventsSnapshot(): HarnessEvent[] { return structuredClone(this.events); }
    messagesSnapshot(): HarnessMessage[] { return structuredClone(deriveMessages(this.events)); }
    get length(): number { return this.events.length; }
}
