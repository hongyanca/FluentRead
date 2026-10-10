/**
 * @file src/features/reading-assistant/background.ts
 * 文件职责：为阅读卡请求建立按标签页、frame 和 document 隔离的后台取消及并发边界。
 * 主要内容：校验消息、处理先取消后启动、替换同页旧请求、限制并发，并在关闭页面、停用配置或超时后丢弃迟到结果。
 * 模块边界：不读取浏览器或密钥，不选择模型也不执行工具；配置就绪、站点资格和实际 Harness 调用均由应用组合根注入。
 */
import {HARNESS_ACTIONS} from '@/src/core/config/harness';
import type {ReadingProgress, ReadingRequest, ReadingResponse} from './types';

export interface ReadingSender {
    id?: string;
    url?: string;
    tab?: {id?: number; url?: string; incognito?: boolean};
    frameId?: number;
    documentId?: string;
}
export interface ReadingHandlerDependencies {
    extensionId: string;
    ready: Promise<unknown>;
    eligibility(sender: ReadingSender): string | undefined;
    run(request: ReadingRequest, signal: AbortSignal, onProgress?: (progress: ReadingProgress) => void, sender?: ReadingSender): Promise<ReadingResponse>;
}
interface ActiveReading {requestId: string; sender: ReadingSender; controller: AbortController}
const CANCELLED: ReadingResponse = {success: false, error: '已停止理解', cancelled: true};
const INVALID: ReadingResponse = {success: false, error: '无效的阅读请求'};
const LIMIT = 4;
const HISTORY_LIMIT = 128;
const REQUEST_TIMEOUT = 60_000;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function ownerOf(sender: ReadingSender): string {
    return JSON.stringify([sender.tab!.id, sender.frameId ?? 0, sender.documentId ?? sender.url ?? '']);
}

/** 即使被注入的请求不响应 AbortSignal，也按时释放 UI 和后台请求所有权。 */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('cancelled'));
        signal.addEventListener('abort', onAbort, {once: true});
        if (signal.aborted) onAbort();
    });
    try { return await Promise.race([work, cancelled]); }
    finally { signal.removeEventListener('abort', onAbort); }
}

/** 只允许扩展自身的内容脚本调用；同一个 requestId 在不同 document 中互不影响。 */
export function createReadingAssistantHandler(deps: ReadingHandlerDependencies) {
    const active = new Map<string, ActiveReading>();
    const seen = new Set<string>();
    let disposed = false;
    const remember = (key: string) => {
        seen.add(key);
        if (seen.size > HISTORY_LIMIT) seen.delete(seen.values().next().value!);
    };
    const cancelWhere = (predicate: (sender: ReadingSender) => boolean) => {
        for (const entry of active.values()) if (predicate(entry.sender)) entry.controller.abort();
    };
    return {
        cancelAll() { cancelWhere(() => true); },
        cancelTab(tabId: number) { cancelWhere(sender => sender.tab!.id === tabId); },
        cancelDisallowed() { cancelWhere(sender => Boolean(deps.eligibility(sender))); },
        dispose() { disposed = true; cancelWhere(() => true); active.clear(); seen.clear(); },
        async handle(message: unknown, sender: ReadingSender, onProgress?: (progress: ReadingProgress) => void): Promise<ReadingResponse> {
            if (disposed || sender.id !== deps.extensionId || !Number.isSafeInteger(sender.tab?.id)
                || sender.tab!.id! < 0 || !isRecord(message) || message.type !== 'fluentReadHarness'
                || typeof message.requestId !== 'string' || !/^[\w.:-]{1,128}$/u.test(message.requestId)) return INVALID;
            const owner = ownerOf(sender);
            const key = `${owner}:${message.requestId}`;
            if (message.action === 'cancel') {
                remember(key);
                const entry = active.get(owner);
                if (entry?.requestId === message.requestId) entry.controller.abort();
                return CANCELLED;
            }
            if (message.action !== 'run' || !isRecord(message.selection) || typeof message.selection.text !== 'string'
                || !HARNESS_ACTIONS.some(action => action.id === message.intent)
                || (message.studyMode !== undefined && message.studyMode !== 'understand' && message.studyMode !== 'use' && message.studyMode !== 'sentence')
                || (message.sessionId !== undefined && (typeof message.sessionId !== 'string' || !/^[\w.:-]{1,128}$/u.test(message.sessionId)))
                || (message.anchorTurnId !== undefined && (typeof message.anchorTurnId !== 'string' || !/^[\w.:-]{1,128}$/u.test(message.anchorTurnId)))) return INVALID;
            if (seen.has(key)) return CANCELLED;
            const previous = active.get(owner);
            if (previous?.requestId === message.requestId) return {success: false, error: '这个请求正在处理中'};
            previous?.controller.abort();
            if (!previous && active.size >= LIMIT) return {success: false, error: '正在处理其他阅读请求，请稍后再试'};
            const controller = new AbortController();
            active.set(owner, {requestId: message.requestId, sender, controller});
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
            const cleanup = () => {
                clearTimeout(timer);
                if (active.get(owner)?.controller === controller) active.delete(owner);
                remember(key);
            };
            try {
                await abortable(deps.ready, controller.signal);
                if (controller.signal.aborted) { cleanup(); return CANCELLED; }
                const blocked = deps.eligibility(sender);
                if (blocked) { cleanup(); return {success: false, error: blocked}; }
                const publish = onProgress ? (progress: ReadingProgress) => {
                    if (controller.signal.aborted || active.get(owner)?.controller !== controller) return;
                    if (deps.eligibility(sender)) { controller.abort(); return; }
                    onProgress(progress);
                } : undefined;
                const response = await abortable(deps.run(message as unknown as ReadingRequest, controller.signal, publish, sender), controller.signal);
                if (controller.signal.aborted || active.get(owner)?.controller !== controller) { cleanup(); return CANCELLED; }
                const nowBlocked = deps.eligibility(sender);
                const result: ReadingResponse = nowBlocked ? {success: false, error: nowBlocked} : response;
                cleanup();
                return result;
            } catch {
                const result: ReadingResponse = controller.signal.aborted ? CANCELLED : {success: false, error: '理解请求未完成，请重试'};
                cleanup();
                return result;
            }
        },
    };
}
