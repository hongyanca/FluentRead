/**
 * @file src/core/translation/layout.ts
 *
 * 文件职责：判定页面元素的语义块、内联关系和可重组边界，为候选引擎选择合理翻译粒度并保护页面布局。
 * 主要内容：识别 heading、block、inline、结构标签、嵌入式 aside 和 reparent 边界，限制直接子节点探测数量，并提供候选目标及内联 run 相关的布局函数。 可核对的公开符号包括 isSemanticHeadingElement、getElementDisplay、isBlockBoundary、isStructuralContainer、hasStructuralAncestor、isTranslationControlElement、hasDirectReadableText、hasReadableBlockChild。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

import {
    getComposedParent,
    isDocumentSurface,
    isProtectedTextElement,
    maxComposedAncestorDepth,
} from './dom';
import {
    hasMeaningfulTranslationTextInNodes,
} from './text';
import type {TranslationTextProtectionCache} from './text';

// 这些上限把同步布局分类限制为有界工作；超限时按保守边界处理，避免大型页面阻塞主线程。
const maxDirectRunNodes = 2048;
const maxBlockChildrenToProbe = 128;

const semanticBlockTags = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
    'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

// 即使站点样式把这些元素设为 inline 或 display:contents，它们仍是语义内容单元。
// 将其移入合成内联 run wrapper 会破坏直接子选择器，甚至重挂整块文档区域
// （MDN 就以 display:contents 渲染 <main>）。通用 <div> 仍按实际布局判断，
// 因为透明 div wrapper 很常见；其余语义块均作为安全的重挂边界。
const semanticReparentBoundaryTags = new Set(
    [...semanticBlockTags].filter((tag) => tag !== 'div'),
);

const inlineTags = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'em', 'font', 'i', 'img',
    'mark', 'q', 'ruby', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u',
    'wbr',
]);

const inlineDisplays = new Set([
    'inline', 'inline-block', 'inline-flex', 'inline-grid', 'ruby', 'ruby-base',
    'ruby-base-container', 'ruby-text', 'ruby-text-container',
]);

const structuralTags = new Set(['aside', 'footer', 'header', 'nav']);
const semanticHeadingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const embeddedAsideClassTokens = new Set([
    'admonition', 'callout', 'caution', 'important', 'note', 'notice', 'tip', 'warning',
]);

/**
 * 标题是作者明确提供的内容地标。页面可能把标题放在语义 `<header>`，甚至导航外壳中，
 * 因此结构祖先不能屏蔽标题本身；硬守卫与站点裁剪决策仍具有更高优先级。
 */
export function isSemanticHeadingElement(element: Element): boolean {
    return semanticHeadingTags.has(element.tagName.toLowerCase());
}

export function getElementDisplay(element: Element): string {
    try {
        const view = element.ownerDocument?.defaultView;
        return view?.getComputedStyle(element).display.trim().toLowerCase() ?? '';
    } catch {
        return '';
    }
}

export function isBlockBoundary(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    if (semanticReparentBoundaryTags.has(tag)) return true;
    const display = getElementDisplay(element);
    if (display) {
        if (display === 'none') return false;
        // 透明布局 div 仍是 DOM 所有权边界；即使自身不生成盒子，把它移到合成 span 下
        // 也会改变 grid/flex 的直接子节点和 CSS 选择器结果。
        if (display === 'contents') return tag === 'div';
        if (inlineDisplays.has(display) || display.startsWith('inline')) return false;
        return true;
    }
    if (inlineTags.has(tag)) return false;
    return semanticBlockTags.has(tag);
}

function hasComposedAncestor(
    element: Element,
    predicate: (ancestor: Element) => boolean,
): boolean {
    let current: Element | null = getComposedParent(element);
    let depth = 0;
    while (current && !isDocumentSurface(current)) {
        depth += 1;
        // 祖先过深而无法安全分类时，不授予内容上下文例外；发现流程使用相同的硬深度上限。
        if (depth > maxComposedAncestorDepth) return false;
        if (predicate(current)) return true;
        current = getComposedParent(current);
    }
    return false;
}

function hasArticleAncestor(element: Element): boolean {
    return hasComposedAncestor(element, (ancestor) =>
        ancestor.tagName.toLowerCase() === 'article' ||
        ancestor.getAttribute('role')?.trim().toLowerCase() === 'article');
}

function hasMainAncestor(element: Element): boolean {
    return hasComposedAncestor(element, (ancestor) =>
        ancestor.tagName.toLowerCase() === 'main' ||
        ancestor.getAttribute('role')?.trim().toLowerCase() === 'main');
}

function isEmbeddedContentAside(element: Element): boolean {
    if (hasArticleAncestor(element)) return true;
    if (!hasMainAncestor(element)) return false;
    if (element.getAttribute('role')?.trim().toLowerCase() === 'note') return true;
    return Array.from(element.classList).some((token) =>
        embeddedAsideClassTokens.has(token.toLowerCase()));
}

export function isStructuralContainer(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    if (!structuralTags.has(tag)) return false;
    // 导航即使挂在文章内容内，仍属于页面框架控件。
    if (tag === 'nav') return true;
    // article 拥有其相关 aside；文档引擎也会在没有 article 的 <main> 下输出 note/callout
    // aside（例如 Swift DocC 的 <aside class="note">）。通用 main 级 aside 仍视为结构区域，
    // 因为其中常包含相关工具等页面框架。header/footer 同样保持为框架区域：文章 header
    // 经常混合可读 H1、元数据和编辑工具，H1 例外会单独分类。
    if (tag === 'aside' && isEmbeddedContentAside(element)) return false;
    return true;
}

export function hasStructuralAncestor(element: Element): boolean {
    let current: Element | null = getComposedParent(element);
    let depth = 0;
    while (current && !isDocumentSurface(current)) {
        depth += 1;
        // 对恶意超深子树保守按结构区域处理；全文发现也会通过同一硬深度守卫裁剪它。
        if (depth > maxComposedAncestorDepth) return true;
        if (isStructuralContainer(current)) return true;
        current = getComposedParent(current);
    }
    return false;
}

export function isTranslationControlElement(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return true;
    const role = element.getAttribute('role')?.toLowerCase();
    return role === 'button' || role === 'menuitem';
}

export function hasDirectReadableText(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    protectionCache?: TranslationTextProtectionCache,
): boolean {
    if (element.childNodes.length > maxDirectRunNodes) return false;
    const inlineNodes = Array.from(element.childNodes).filter((child) =>
        child.nodeType === 3 || (child.nodeType === 1 && !isBlockBoundary(child as Element)));
    return hasMeaningfulTranslationTextInNodes(inlineNodes, shouldStayOriginal, protectionCache);
}

export function hasReadableBlockChild(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    protectionCache?: TranslationTextProtectionCache,
): boolean {
    if (element.children.length > maxBlockChildrenToProbe) return true;
    return Array.from(element.children).some((child) => {
        if (!isBlockBoundary(child)) return false;
        return hasMeaningfulTranslationTextInNodes([child], shouldStayOriginal, protectionCache);
    });
}

/**
 * 只切分混合块的直接内联内容。块级子节点作为屏障并保留自己的候选；受保护的内联节点
 * 以原子源结构留在 run 中，但其文本不会进入翻译请求。
 */
export function getDirectInlineRuns(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    skipStructuralAncestorCheck = false,
    isAdditionalBarrier?: (element: Element) => boolean,
    protectionCache?: TranslationTextProtectionCache,
): ChildNode[][] {
    if (isDocumentSurface(element) || isStructuralContainer(element) ||
        (!skipStructuralAncestorCheck && hasStructuralAncestor(element))) return [];
    if (shouldStayOriginal?.(element) || isProtectedTextElement(element) || !isBlockBoundary(element)) return [];
    if (element.childNodes.length > maxDirectRunNodes) return [];
    if (!hasDirectReadableText(element, shouldStayOriginal, protectionCache)) return [];
    const hasBlockBarrier = hasReadableBlockChild(element, shouldStayOriginal, protectionCache);
    const hasAdditionalBarrier = !hasBlockBarrier && isAdditionalBarrier &&
        Array.from(element.children).some((child) => isAdditionalBarrier(child));
    if (!hasBlockBarrier && !hasAdditionalBarrier) return [];

    const runs: ChildNode[][] = [];
    let current: ChildNode[] = [];
    const flush = () => {
        if (current.length > 0 &&
            hasMeaningfulTranslationTextInNodes(current, shouldStayOriginal, protectionCache)) {
            runs.push(current);
        }
        current = [];
    };

    for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1 &&
            (isBlockBoundary(child as Element) || isAdditionalBarrier?.(child as Element))) {
            flush();
            continue;
        }
        current.push(child);
    }
    flush();
    return runs;
}

export interface GenericClassification {
    kind: 'content' | 'control';
    reason: string;
}

/**
 * 页面发现与悬浮共用的纯本地候选分类；刻意将边界分类与渲染布局分离。
 */
export function classifyGenericCandidate(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    skipStructuralAncestorCheck = false,
    protectionCache?: TranslationTextProtectionCache,
): GenericClassification | null {
    const semanticHeading = isSemanticHeadingElement(element);
    if (isDocumentSurface(element) || isStructuralContainer(element) ||
        (!skipStructuralAncestorCheck && hasStructuralAncestor(element) && !semanticHeading)) {
        return null;
    }
    if (shouldStayOriginal?.(element) || isProtectedTextElement(element)) return null;

    if (isTranslationControlElement(element)) {
        if (!hasMeaningfulTranslationTextInNodes([element], shouldStayOriginal, protectionCache)) return null;
        return {kind: 'control', reason: 'generic-control'};
    }

    if (!isBlockBoundary(element)) return null;
    if (!hasMeaningfulTranslationTextInNodes([element], shouldStayOriginal, protectionCache)) return null;
    // 含可读块级子节点的容器是结构边界，不是回退目标。若悬浮时选中它，实际命中位于
    // header/aside 子节点时可能误翻译整个应用外壳。
    if (hasReadableBlockChild(element, shouldStayOriginal, protectionCache)) return null;
    return {kind: 'content', reason: 'generic-readable-block'};
}
