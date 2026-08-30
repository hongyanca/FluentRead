/**
 * @file src/core/translation/dom.ts
 *
 * 文件职责：封装翻译候选发现使用的 composed tree 遍历与不可覆盖安全守卫，识别扩展 DOM、脚本、表单及禁止翻译区域。
 * 主要内容：提供 Shadow DOM 父级与祖先遍历、硬裁剪标签、受保护文本元素、隐藏/可编辑/no-translate 判断，并限制祖先深度以避免异常页面结构拖垮扫描。 可核对的公开符号包括 maxComposedAncestorDepth、getComposedParent、isDocumentSurface、isExtensionElement、isExtensionElementSelf、isHardPruneTag、isProtectedTextElement、hasNoTranslateMarker。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

const extensionSelector = [
    '#fluent-read-floating-ball-container',
    '#fluent-read-selection-translator-container',
    '#fluent-read-translation-status-container',
    '[data-fluent-read-ui]',
    '.fluent-read-video-ui',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '.fluent-read-bilingual-content',
    '[data-fr-translation-segment="true"]',
    '[data-fr-translation-owned="true"]',
].join(',');

const hardPruneTags = new Set([
    'head', 'script', 'style', 'noscript', 'iframe', 'input', 'textarea',
    'select', 'option', 'math', 'svg', 'canvas', 'audio', 'video', 'object',
    'template', 'xmp',
]);

const protectedTextTags = new Set([
    ...hardPruneTags,
    'pre', 'code', 'kbd', 'samp', 'var',
]);

/**
 * 宿主页可能构造恶意的超深节点树。依赖祖先的安全检查同步执行，因此单次查询必须
 * 设置上限；超过上限时保守裁剪，避免让渲染线程阻塞数百毫秒。
 */
export const maxComposedAncestorDepth = 512;

export function getComposedParent(element: Element): Element | null {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.() as {host?: Element};
    return root?.host?.nodeType === 1 ? root.host : null;
}

export function* composedAncestors(element: Element): Generator<Element> {
    let current: Element | null = element;
    while (current) {
        yield current;
        current = getComposedParent(current);
    }
}

export function isDocumentSurface(element: Element): boolean {
    const owner = element.ownerDocument;
    return element === owner?.documentElement || element === owner?.body;
}

export function isExtensionElement(element: Element): boolean {
    return Boolean(element.matches(extensionSelector) || element.closest(extensionSelector));
}

export function isExtensionElementSelf(element: Element): boolean {
    return element.matches(extensionSelector);
}

export function isHardPruneTag(element: Element): boolean {
    return hardPruneTags.has(element.tagName.toLowerCase());
}

export function isProtectedTextElement(element: Element): boolean {
    return protectedTextTags.has(element.tagName.toLowerCase());
}

export function hasNoTranslateMarker(element: Element): boolean {
    return element.classList.contains('notranslate') ||
        element.getAttribute('translate')?.toLowerCase() === 'no' ||
        element.getAttribute('data-notranslate') === 'true';
}

export function hasHiddenMarker(element: Element): boolean {
    const htmlElement = element as HTMLElement;
    if (htmlElement.hidden || htmlElement.inert || element.hasAttribute('inert')) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (element.classList.contains('sr-only') || element.classList.contains('visually-hidden')) return true;

    try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
        if (!style) return false;
        return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    } catch {
        return false;
    }
}

function hasContentEditableMarker(element: Element): boolean {
    const attribute = element.getAttribute('contenteditable');
    return (attribute !== null && attribute.toLowerCase() !== 'false') ||
        (element as HTMLElement).isContentEditable;
}

/**
 * MathJax v2/v3 与 KaTeX 会把公式渲染为普通 span/div，而不是原生 MathML。
 * 这些生成树必须作为宿主页拥有的原子内容保留：翻译或物化内部 span 后，恢复操作
 * 可能删除可见公式，只留下隐藏的 TeX 源脚本。
 */
export function isMathRendererElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'mjx-container' ||
        element.classList.contains('MathJax_Display') ||
        element.classList.contains('MathJax') ||
        element.classList.contains('MathJax_Preview') ||
        element.classList.contains('katex');
}

/**
 * 后代文本守卫刻意保持局部生效。受保护的内联子节点不能进入服务请求，
 * 但不应因此拒绝包含它的可读段落。
 */
export function isProtectedDescendantElement(
    element: Element,
    ignoreExtensionSelf = false,
): boolean {
    return (!ignoreExtensionSelf && isExtensionElementSelf(element)) ||
        isProtectedTextElement(element) ||
        isMathRendererElement(element) ||
        hasNoTranslateMarker(element) ||
        hasContentEditableMarker(element) ||
        hasHiddenMarker(element);
}

export interface HardGuardResult {
    prune: boolean;
    reason?: string;
}

export function evaluateElementHardGuard(element: Element): HardGuardResult {
    if (isExtensionElementSelf(element)) return {prune: true, reason: 'fluentread-owned'};
    if (isHardPruneTag(element)) return {prune: true, reason: `protected-tag:${element.tagName.toLowerCase()}`};
    if (isMathRendererElement(element)) return {prune: true, reason: 'math-renderer'};
    if (hasNoTranslateMarker(element)) return {prune: true, reason: 'inherited-no-translate'};
    if (hasContentEditableMarker(element)) return {prune: true, reason: 'contenteditable'};
    if (hasHiddenMarker(element)) return {prune: true, reason: 'hidden'};
    return {prune: false};
}

/**
 * 初次发现、悬浮解析、DOM 变更和开放 Shadow DOM 共用同一组硬守卫；
 * 站点适配器不能覆盖这些安全边界。
 */
export function evaluateHardGuard(element: Element): HardGuardResult {
    let depth = 0;
    for (const current of composedAncestors(element)) {
        depth += 1;
        if (depth > maxComposedAncestorDepth) {
            return {prune: true, reason: 'ancestor-depth-limit'};
        }
        const guard = evaluateElementHardGuard(current);
        if (guard.prune) return guard;
    }
    return {prune: false};
}

function collectImmediateOpenShadowRoots(root: Node): ShadowRoot[] {
    const result: ShadowRoot[] = [];
    const collect = (element: Element) => {
        if (element.shadowRoot) result.push(element.shadowRoot);
    };

    if (root.nodeType === 1) collect(root as Element);
    const document = root.ownerDocument ?? (root.nodeType === 9 ? root as Document : globalThis.document);
    if (!document?.createTreeWalker) return result;
    const walker = document.createTreeWalker(root, 1);
    let current = walker.nextNode();
    while (current) {
        if (current.nodeType === 1) collect(current as Element);
        current = walker.nextNode();
    }
    return result;
}

export function getOpenShadowRoots(root: Node): ShadowRoot[] {
    // 逐层发现嵌套的开放 Shadow Root；closed root 不可见，也不应尝试穿透。
    const result: ShadowRoot[] = [];
    const seen = new Set<ShadowRoot>();
    const pending: Node[] = [root];
    for (let index = 0; index < pending.length; index += 1) {
        const pendingRoot = pending[index]!;
        for (const shadowRoot of collectImmediateOpenShadowRoots(pendingRoot)) {
            if (seen.has(shadowRoot)) continue;
            seen.add(shadowRoot);
            result.push(shadowRoot);
            pending.push(shadowRoot);
        }
    }
    return result;
}

export function safeMatches(element: Element, selector: string): boolean {
    try {
        return element.matches(selector);
    } catch {
        return false;
    }
}

export function safeClosest(element: Element, selector: string): Element | null {
    try {
        return element.closest(selector);
    } catch {
        return null;
    }
}

export function findElementsAtPoint(root: Document | ShadowRoot, x: number, y: number): Element[] {
    const pointRoot = root as Document & {elementsFromPoint?: (x: number, y: number) => Element[]};
    if (typeof pointRoot.elementsFromPoint === 'function') return pointRoot.elementsFromPoint(x, y);
    const singlePointRoot = root as Document & {elementFromPoint?: (x: number, y: number) => Element | null};
    if (typeof singlePointRoot.elementFromPoint !== 'function') return [];
    const element = singlePointRoot.elementFromPoint(x, y);
    return element ? [element] : [];
}

export function findNodeAtPoint(root: Document | ShadowRoot, x: number, y: number): Node | null {
    const document = root.nodeType === 9 ? root as Document : root.ownerDocument;
    try {
        const caretPosition = document?.caretPositionFromPoint?.(x, y);
        if (caretPosition?.offsetNode && root.contains(caretPosition.offsetNode)) return caretPosition.offsetNode;
    } catch {
        // Firefox 风格的光标命中 API 是可选能力，也可能拒绝 Shadow Root。
    }
    try {
        const range = document?.caretRangeFromPoint?.(x, y);
        if (range?.startContainer && root.contains(range.startContainer)) return range.startContainer;
    } catch {
        // Chromium 风格的光标命中 API 同样是可选能力。
    }
    return null;
}
