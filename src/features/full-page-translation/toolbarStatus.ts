/**
 * @file src/features/full-page-translation/toolbarStatus.ts
 * 文件职责：定义工具栏的翻译结果状态，区分会话开启与当前可见任务成功。
 * 主要内容：归一化跨版本状态，并从活动工作和真实节点阶段推导等待、成功、失败或空闲。
 * 模块边界：不访问 DOM、浏览器或配置；调用方只传入本次会话拥有的节点阶段。
 */
export type TranslationToolbarStatus = 'idle' | 'translating' | 'translated' | 'error';

export function normalizeTranslationToolbarStatus(value: unknown): TranslationToolbarStatus {
    return value === 'translating' || value === 'translated' || value === 'error' ? value : 'idle';
}

/** 离屏候选尚未进入请求不阻碍当前内容完成；没有成功结果时绝不显示成功勾。 */
export function resolveTranslationToolbarStatus(
    busy: boolean,
    phases: Iterable<string>,
): TranslationToolbarStatus {
    if (busy) return 'translating';
    let translated = false, failed = false;
    for (const phase of phases) {
        if (phase === 'loading') return 'translating';
        if (phase === 'error') failed = true;
        if (phase === 'translated') translated = true;
    }
    return failed ? 'error' : translated ? 'translated' : 'idle';
}

/** 保留同 key 新旧候选的所有权：旧请求不能扣掉新候选的待处理数量。 */
export function countFullPageTranslationWork(
    inFlight: ReadonlyMap<unknown, unknown>, scheduled: ReadonlyMap<unknown, unknown>, pending: number,
): {running: number; queued: number; offscreen: number} {
    let runningScheduled = 0;
    for (const [key, candidate] of inFlight) {
        if (scheduled.get(key) === candidate) runningScheduled += 1;
    }
    const remaining = Math.max(0, scheduled.size - runningScheduled);
    const queued = Math.min(pending, remaining);
    return {running: inFlight.size, queued, offscreen: Math.max(0, remaining - queued)};
}
