/**
 * @file src/features/writing-assistant/reference.ts
 * 文件职责：管理写作正文的阅读对照译文，使对照始终对应当前正文、语言与会话。
 * 主要内容：冻结请求快照，取消过期流，缓存最近五份完整译文；关闭、编辑或重新起草时隐藏过期对照，失败可独立重试。
 * 模块边界：不读取 Vue、浏览器或配置，不修改回复正文，也不复制或插入译文；流式通信由调用方注入。
 */
import type {WritingProgress, WritingResponse} from './types';

export interface WritingReferenceSnapshot {
    session: number; source: string; sourceLanguage: string; language: string; owner: number; active: boolean;
}
export interface WritingReferenceState {
    status: 'idle' | 'loading' | 'success' | 'error' | 'same-language' | 'too-long'; text: string;
}
export function createWritingReference(deps: {
    stream(source: string, language: string, handlers: {progress(value: WritingProgress): void; result(value: WritingResponse): void}): () => void;
    changed(state: WritingReferenceState): void;
}) {
    let current: WritingReferenceSnapshot | undefined;
    let generation = 0; let cancel: (() => void) | undefined; let disposed = false; let key = '';
    const cache = new Map<string, string>();
    const publish = (status: WritingReferenceState['status'], text = '') => deps.changed({status, text});
    function stop() { generation++; cancel?.(); cancel = undefined; }
    function update(snapshot: WritingReferenceSnapshot, retry = false) {
        if (disposed) return;
        const nextKey = JSON.stringify([snapshot.session, snapshot.source, snapshot.sourceLanguage, snapshot.language, snapshot.owner, snapshot.active]);
        if (!retry && nextKey === key) return;
        stop(); key = nextKey;
        if (current?.session !== snapshot.session || current.owner !== snapshot.owner) cache.clear();
        current = {...snapshot};
        if (!snapshot.active || !snapshot.source.trim() || !snapshot.language) { publish('idle'); return; }
        if (snapshot.sourceLanguage === snapshot.language) { publish('same-language'); return; }
        if (snapshot.source.length > 12000) { publish('too-long'); return; }
        const cacheKey = JSON.stringify([snapshot.source, snapshot.language]);
        const cached = cache.get(cacheKey);
        if (cached !== undefined) { publish('success', cached); return; }
        const owner = generation;
        publish('loading');
        let settled = false;
        try {
            const release = deps.stream(snapshot.source, snapshot.language, {
                progress(value) { if (owner === generation && !settled && value.kind === 'text') publish('loading', value.text); },
                result(value) {
                    if (owner !== generation || settled) return;
                    settled = true; cancel = undefined;
                    if (!value.success || !value.text.trim()) { publish('error'); return; }
                    cache.set(cacheKey, value.text);
                    if (cache.size > 5) cache.delete(cache.keys().next().value!);
                    publish('success', value.text);
                },
            });
            if (settled || owner !== generation) release(); else cancel = release;
        } catch { if (owner === generation) { settled = true; publish('error'); } }
    }
    return {
        update,
        retry() { if (current) update(current, true); },
        dispose() { disposed = true; stop(); cache.clear(); },
    };
}
