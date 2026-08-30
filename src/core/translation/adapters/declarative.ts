/**
 * @file src/core/translation/adapters/declarative.ts
 *
 * 文件职责：把站点选择器规则编译为类型化 TranslationSiteAdapter，供多个站点以声明方式调整候选发现而不复制遍历算法。
 * 主要内容：定义 host、target、skip 与 prune 规则结构，缓存组合选择器，安全处理无效 selector，并由 createDeclarativeAdapter 生成匹配 URL 和节点决策的适配器。 可核对的公开符号包括 SelectorList、DeclarativeSelectorRule、DeclarativeTargetRule、DeclarativeHostRule、DeclarativeSiteAdapterDefinition、createDeclarativeAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {safeClosest, safeMatches} from '../dom';
import type {
    AdapterContext,
    AdapterDecision,
    TranslationCandidateKind,
    TranslationSiteAdapter,
} from '../types';

export type SelectorList = string | readonly string[];

export interface DeclarativeSelectorRule {
    selector: SelectorList;
    reason: string;
}

export interface DeclarativeTargetRule extends DeclarativeSelectorRule {
    /** 匹配后代节点时，是否解析到规则声明的语义容器。 */
    match?: 'self' | 'closest';
    candidateKind?: TranslationCandidateKind;
    atomic?: boolean;
}

export interface DeclarativeHostRule {
    hostname: string;
    includeSubdomains?: boolean;
}

export interface DeclarativeSiteAdapterDefinition {
    id: string;
    priority?: number;
    hosts: readonly (string | DeclarativeHostRule)[];
    pathnames?: readonly RegExp[];
    targets?: readonly DeclarativeTargetRule[];
    prune?: readonly DeclarativeSelectorRule[];
    keepOriginal?: readonly DeclarativeSelectorRule[];
    mutationExclude?: readonly DeclarativeSelectorRule[];
}

function selectors(value: SelectorList): readonly string[] {
    return typeof value === 'string' ? [value] : value;
}

const combinedSelectorsByDocument = new WeakMap<Document, Map<string, string | null>>();

function combinedSelector(element: Element, value: SelectorList): string | null {
    const document = element.ownerDocument;
    if (!document) return null;
    const items = selectors(value);
    const cacheKey = items.join('\u0000');
    let documentCache = combinedSelectorsByDocument.get(document);
    if (!documentCache) {
        documentCache = new Map();
        combinedSelectorsByDocument.set(document, documentCache);
    }
    if (documentCache.has(cacheKey)) return documentCache.get(cacheKey) ?? null;

    const probe = document.createElement('div');
    const valid = items.filter((item) => {
        try {
            probe.matches(item);
            return true;
        } catch {
            return false;
        }
    });
    const combined = valid.length > 0 ? valid.join(',') : null;
    documentCache.set(cacheKey, combined);
    return combined;
}

function matchesSelector(element: Element, selector: SelectorList): boolean {
    const combined = combinedSelector(element, selector);
    return combined ? safeMatches(element, combined) : false;
}

function closestSelector(element: Element, selector: SelectorList): Element | null {
    const combined = combinedSelector(element, selector);
    return combined ? safeClosest(element, combined) : null;
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/\.$/u, '');
}

function matchesHost(url: URL, rule: string | DeclarativeHostRule): boolean {
    const hostname = normalizeHostname(url.hostname);
    const expected = normalizeHostname(typeof rule === 'string' ? rule : rule.hostname);
    if (!expected || hostname === expected) return hostname === expected;
    return typeof rule !== 'string' && rule.includeSubdomains === true && hostname.endsWith(`.${expected}`);
}

function matchesPathname(pathname: string, patterns: readonly RegExp[] | undefined): boolean {
    if (!patterns?.length) return true;
    return patterns.some((pattern) => {
        try {
            // 每次克隆正则，避免 global/sticky 表达式的 lastIndex 产生可观察变化。
            return new RegExp(pattern.source, pattern.flags).test(pathname);
        } catch {
            return false;
        }
    });
}

/**
 * 由无副作用的选择器数据构建站点适配器。所有选择器操作均按失败即拒绝处理，
 * 过期或不受支持的站点选择器不能中断候选发现。
 */
export function createDeclarativeAdapter(
    definition: DeclarativeSiteAdapterDefinition,
): TranslationSiteAdapter {
    const pruneRules = definition.prune ?? [];
    const targetRules = definition.targets ?? [];
    const originalRules = definition.keepOriginal ?? [];
    const mutationRules = definition.mutationExclude ?? [];

    return {
        id: definition.id,
        priority: definition.priority,
        matches(url: URL): boolean {
            return definition.hosts.some((host) => matchesHost(url, host)) &&
                matchesPathname(url.pathname, definition.pathnames);
        },
        decide(element: Element, _context: AdapterContext): AdapterDecision {
            for (const rule of pruneRules) {
                if (closestSelector(element, rule.selector)) {
                    return {kind: 'prune-subtree', reason: rule.reason};
                }
            }

            for (const rule of targetRules) {
                const target = rule.match === 'closest'
                    ? closestSelector(element, rule.selector)
                    : matchesSelector(element, rule.selector) ? element : null;
                if (!target) continue;
                return {
                    kind: 'force-target',
                    reason: rule.reason,
                    target,
                    candidateKind: rule.candidateKind ?? 'content',
                    atomic: rule.atomic,
                };
            }

            return {kind: 'pass'};
        },
        shouldStayOriginal(element: Element, _context: AdapterContext): boolean {
            return originalRules.some((rule) => Boolean(closestSelector(element, rule.selector)));
        },
        shouldIgnoreMutation(element: Element, _context: AdapterContext): boolean {
            return mutationRules.some((rule) => Boolean(closestSelector(element, rule.selector)));
        },
    };
}
