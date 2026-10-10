/**
 * @file src/features/full-page-translation/content/eagerTranslation.ts
 * 文件职责：按用户设定的字符预算，让全文会话在页面开头的一段内容上跳过视口门禁，不等待滚动即可排队翻译。
 * 主要内容：统计候选宿主或内联 run 的字符量，在会话首次请求时冻结预算并按发现顺序扣减，跳过同一原文候选的重复扣减，预算耗尽后交还给视口驱动的常规调度。
 * 模块边界：本文件只做预算判定，不发起翻译请求、不操作 IntersectionObserver、不持有会话生命周期；预算随会话对象被回收，调度仍由 full-page runtime 拥有。
 */
import type {TranslationCandidate} from '@/src/core/translation/public';
import {normalizeEagerTranslationCharacters} from '@/src/core/config/pageTranslation';
import {config} from '@/src/services/config/store';

/** 会话对象作为独立账本的弱引用标识；队列中是否存在候选不能代表已消费预算。 */
export interface EagerTranslationBudgetSession {
    pending: Map<Node, TranslationCandidate>;
    scheduled: Map<Node, TranslationCandidate>;
}

const sessionBudgets = new WeakMap<EagerTranslationBudgetSession, number>();
const consumedCandidates = new WeakMap<EagerTranslationBudgetSession, WeakMap<Node, string>>();

/** 候选在页面中的字符量；内联 run 只统计自己持有的节点。 */
export function candidateTextLength(candidate: TranslationCandidate): number {
    const nodes = candidate.nodes;
    if (nodes && nodes.length > 0) {
        return nodes.reduce((total, node) => total + (node.textContent?.length ?? 0), 0);
    }
    return candidate.element.textContent?.length ?? 0;
}

function candidateBudgetSource(candidate: TranslationCandidate): string {
    const text = candidate.nodes && candidate.nodes.length > 0
        ? candidate.nodes.map((node) => node.textContent ?? '').join('')
        : candidate.element.textContent ?? '';
    return [candidate.kind, candidate.reason, candidate.adapterId ?? '', candidate.scope ?? '', text].join('\u0000');
}

/** 会话遇到第一个候选时冻结预算，之后的设置改动留给下一次全文翻译。 */
export function getEagerTranslationBudget(session: EagerTranslationBudgetSession): number {
    const budget = sessionBudgets.get(session);
    if (budget !== undefined) return budget;
    const initial = normalizeEagerTranslationCharacters(config.eagerTranslationCharacters);
    sessionBudgets.set(session, initial);
    return initial;
}

/**
 * 页面开头的内容不必等待滚动。预算按发现顺序扣减，用尽后后续候选继续走
 * 视口门禁，因此长页面不会因为这一项而整页发出请求。
 */
export function consumeEagerTranslationBudget(
    session: EagerTranslationBudgetSession,
    key: Node,
    candidate: TranslationCandidate,
): boolean {
    const budget = getEagerTranslationBudget(session);
    const consumed = consumedCandidates.get(session);
    // 默认零预算时，未曾获准的离屏候选直接交给视口门禁，避免读取/拼接整段原文。
    if (budget <= 0 && !consumed?.has(key)) return false;
    const source = candidateBudgetSource(candidate);
    // scheduled/pending 只表示队列所有权，不能证明预算已经消费；首次登记常在
    // scheduled.set() 之后才到这里。只有同一 key 且原文来源未变化才跳过重复扣减。
    if (consumed?.get(key) === source) return true;
    if (budget <= 0) return false;
    const ledger = consumed ?? new WeakMap<Node, string>();
    if (!consumed) consumedCandidates.set(session, ledger);
    sessionBudgets.set(session, Math.max(0, budget - candidateTextLength(candidate)));
    ledger.set(key, source);
    return true;
}
