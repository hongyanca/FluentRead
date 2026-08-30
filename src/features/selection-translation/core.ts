/**
 * @file src/features/selection-translation/core.ts
 * 文件职责：集中划词翻译的纯交互与内容算法，包括请求代次、词典回退、触发展示状态、选区过滤、上下文摘要、弹窗锚点和语音语言规范化。
 * 主要内容：定义 SelectionRequestTokenGate、Presentation 状态机、选区/视口类型，处理同语种判断、文本清理、敏感或可编辑区域排除、多矩形选择及边界内弹窗定位。
 * 模块边界：本模块不监听 document selection、不发消息、不渲染 Vue 或播放音频；组件负责连接 DOM，词典和 TTS 由 services/background 提供，函数保持确定性以供单元测试。
 */
export interface SelectionRect {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

export interface PopupSize {
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export interface PopupPosition {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
}

export interface SelectionContentRequest {
    text: string;
    targetLanguage: string;
    generation: number;
}

export interface SelectionAnswerCandidate extends SelectionContentRequest {
    answer: string;
}

/** 为每条异步通道维护独立代次，避免一种请求的完成结果误废弃另一种请求。 */
export class SelectionRequestTokenGate {
    private generation = 0;

    begin(): number {
        this.generation += 1;
        return this.generation;
    }

    invalidate(): void {
        this.generation += 1;
    }

    isCurrent(token: number): boolean {
        return token === this.generation;
    }
}

function normalizeSelectionRequestLanguage(value: string): string {
    return String(value || '').trim().replace(/_/g, '-').toLowerCase();
}

/** ECDICT 随包附带的辅助释义是简体中文，仅在目标语言兼容时参与回退。 */
export function canUseBundledDictionaryFallback(targetLanguage: string): boolean {
    return ['zh', 'zh-cn', 'zh-hans', 'zh-sg'].includes(normalizeSelectionRequestLanguage(targetLanguage));
}

export function resolveSelectionDictionaryFallback(targetLanguage: string, translatedDefinitions: readonly unknown[]): string {
    if (!canUseBundledDictionaryFallback(targetLanguage)) return '';
    return translatedDefinitions
        .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        .map(value => value.trim())
        .slice(0, 4)
        .join('；');
}

export function resolveSelectionVocabularyAnswer(
    current: SelectionContentRequest | null,
    translation: SelectionAnswerCandidate | null,
    dictionary: SelectionAnswerCandidate | null,
): string {
    if (!current) return '';
    const matches = (candidate: SelectionAnswerCandidate | null): candidate is SelectionAnswerCandidate => Boolean(
        candidate
        && candidate.generation === current.generation
        && candidate.text === current.text
        && normalizeSelectionRequestLanguage(candidate.targetLanguage) === normalizeSelectionRequestLanguage(current.targetLanguage)
        && candidate.answer.trim(),
    );
    if (matches(translation)) return translation.answer.trim();
    return matches(dictionary) ? dictionary.answer.trim() : '';
}

export interface SelectionPresentationState {
    showIndicator: boolean;
    showTooltip: boolean;
}

export type SelectionPresentationTrigger = 'direct' | 'icon' | 'dot' | 'shortcut';

/** 延迟配置变化仍以当前选区稳定时刻为起点，避免刷新配置后重新等待完整时长。 */
export function getSelectionPresentationDelayRemaining(
    delay: number,
    selectionSettledAt: number,
    now: number,
): number {
    const elapsed = Math.max(0, now - selectionSettledAt);
    return Math.max(0, delay - elapsed);
}

/** 与展示无关的配置刷新不能关闭用户已经明确打开的翻译浮层。 */
export function reconcileSelectionPresentation(
    current: SelectionPresentationState,
    trigger: SelectionPresentationTrigger,
    triggerChanged: boolean,
): SelectionPresentationState {
    if (!triggerChanged) return current;
    if (trigger === 'direct') return { showIndicator: false, showTooltip: true };
    if (trigger === 'shortcut') return { showIndicator: false, showTooltip: false };
    return { showIndicator: true, showTooltip: false };
}

const languageAliases: Record<string, string> = {
    cmn: 'zh',
    zho: 'zh',
    chi: 'zh',
    eng: 'en',
    jpn: 'ja',
    kor: 'ko',
    fra: 'fr',
    fre: 'fr',
    deu: 'de',
    ger: 'de',
    spa: 'es',
    rus: 'ru',
    ita: 'it',
    por: 'pt',
    ara: 'ar',
    hin: 'hi',
    tha: 'th',
    vie: 'vi',
    nld: 'nl',
    dut: 'nl',
    pol: 'pl',
    tur: 'tr',
};

/** 忽略地区与书写系统差异后比较检测语言和配置语言。 */
export function isSameLanguage(detectedLanguage: string | undefined, targetLanguage: string | undefined): boolean {
    const detected = String(detectedLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
    const target = String(targetLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
    if (!detected || !target || ['auto', 'detect', 'unknown', 'und'].includes(detected) || ['auto', 'detect', 'unknown', 'und'].includes(target)) return false;

    const detectedBase = languageAliases[detected] || detected.split('-')[0];
    const targetBase = languageAliases[target] || target.split('-')[0];
    return Boolean(detectedBase && targetBase && detectedBase === targetBase);
}

const DEFAULT_PADDING = 12;
const DEFAULT_GAP = 10;

/** 规范化浏览器选区文本，同时保留对阅读有意义的换行。 */
export function normalizeSelectionText(value: string): string {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
}

export function summarizeSelectionContext(
    containerText: string,
    selectedText: string,
    maxLength = 500,
    selectedIndex?: number,
): string {
    const normalized = String(containerText || '').replace(/\s+/gu, ' ').trim();
    const selected = String(selectedText || '').trim();
    if (!normalized || !selected || maxLength < 16) return '';
    if (normalized.length <= maxLength) return normalized;
    const normalizedLower = normalized.toLocaleLowerCase();
    const selectedLower = selected.toLocaleLowerCase();
    const firstIndex = normalizedLower.indexOf(selectedLower);
    if (firstIndex < 0) return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    let matchedIndex = firstIndex;
    if (typeof selectedIndex === 'number' && Number.isFinite(selectedIndex)) {
        const preferredIndex = Math.max(0, Math.min(normalized.length, selectedIndex));
        const leftIndex = normalizedLower.lastIndexOf(selectedLower, preferredIndex);
        const rightIndex = normalizedLower.indexOf(selectedLower, preferredIndex);
        if (leftIndex < 0) matchedIndex = rightIndex;
        else if (rightIndex < 0) matchedIndex = leftIndex;
        else matchedIndex = preferredIndex - leftIndex <= rightIndex - preferredIndex ? leftIndex : rightIndex;
    }
    const contentLength = Math.max(1, maxLength - 2);
    const selectedCenter = matchedIndex + selected.length / 2;
    const start = Math.max(0, Math.min(normalized.length - contentLength, Math.round(selectedCenter - contentLength / 2)));
    const end = Math.min(normalized.length, start + contentLength);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < normalized.length ? '…' : '';
    return `${prefix}${normalized.slice(start, end).trim()}${suffix}`.slice(0, maxLength);
}

const selectionExcludedTagNames = new Set([
    'audio', 'button', 'canvas', 'code', 'embed', 'iframe', 'img', 'input',
    'kbd', 'math', 'object', 'option', 'picture', 'pre', 'samp', 'select',
    'svg', 'template', 'textarea', 'var', 'video',
]);

const selectionExcludedRoles = new Set([
    'button', 'checkbox', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'radio', 'scrollbar', 'slider', 'spinbutton',
    'switch', 'tab', 'textbox',
]);

const selectionExcludedSelector = [
    '.fluent-read-bilingual-content',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '.notranslate',
    '[aria-hidden="true"]',
    '[data-fluent-read-ui]',
    '[data-notranslate="true"]',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="scrollbar"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[translate="no"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    ...Array.from(selectionExcludedTagNames, (tagName) => tagName),
].join(',');

export function isSelectionExcludedTagName(tagName: string): boolean {
    return selectionExcludedTagNames.has(tagName.trim().toLowerCase());
}

function isEditableSelectionElement(element: Element): boolean {
    if ((element as HTMLElement).isContentEditable) return true;

    let current: Element | null = element;
    while (current) {
        if (current.hasAttribute('contenteditable')) {
            return current.getAttribute('contenteditable')?.trim().toLowerCase() !== 'false';
        }
        current = current.parentElement;
    }
    return false;
}

function isSelectionExcludedElement(element: Element | null): boolean {
    if (!element) return false;
    if (isSelectionExcludedTagName(element.tagName)) return true;

    const role = element.getAttribute('role')?.trim().toLowerCase();
    if (role && selectionExcludedRoles.has(role)) return true;
    if (isEditableSelectionElement(element)) return true;
    return Boolean(element.closest(selectionExcludedSelector));
}

function elementFromSelectionNode(node: Node | null): Element | null {
    if (!node) return null;
    return node.nodeType === 1 ? node as Element : node.parentElement;
}

/**
 * 划词翻译只处理页面正文，不处理原子内容或交互控件。这里同时检查选区两端
 * 与克隆内容，避免纯图片选区或跨越特殊组件的选区留下失效触发器。
 */
export function shouldIgnoreSelection(range: Range): boolean {
    const boundaries = [
        elementFromSelectionNode(range.startContainer),
        elementFromSelectionNode(range.endContainer),
    ];
    if (boundaries.some(isSelectionExcludedElement)) return true;

    try {
        return Boolean(range.cloneContents().querySelector(selectionExcludedSelector));
    } catch {
        return false;
    }
}

/**
 * 选择最靠近选区焦点的视觉边缘；使用客户端矩形可以避免把入口放在多行选区中间。
 */
export function chooseSelectionRect(rects: SelectionRect[], isForward = true): SelectionRect | null {
    if (rects.length === 0) return null;
    return isForward ? rects[rects.length - 1] : rects[0];
}

/**
 * 以当前选中行作为弹层锚点并限制在视口内。计算保持为纯函数，使滚动和缩放行为
 * 无需挂载 Vue、也不依赖宿主页面 CSS 即可测试。
 */
export function calculateSelectionPopupPosition(
    anchor: SelectionRect,
    popup: PopupSize,
    viewport: ViewportSize,
    padding = DEFAULT_PADDING,
    gap = DEFAULT_GAP,
): PopupPosition {
    const maxLeft = Math.max(padding, viewport.width - popup.width - padding);
    const left = clamp(anchor.left, padding, maxLeft);
    const fitsAbove = anchor.top - popup.height - gap >= padding;
    const placement = fitsAbove ? 'top' : 'bottom';
    const rawTop = fitsAbove ? anchor.top - popup.height - gap : anchor.bottom + gap;
    const maxTop = Math.max(padding, viewport.height - popup.height - padding);

    return {
        left,
        top: clamp(rawTop, padding, maxTop),
        placement,
    };
}

export function normalizeSpeechLanguage(language: string | undefined, fallback = 'en-US'): string {
    const normalized = String(language ?? '').trim().replace(/_/g, '-');
    const lower = normalized.toLowerCase();
    if (!normalized || ['auto', 'detect', 'unknown', 'und'].includes(lower)) return fallback;

    const aliases: Record<string, string> = {
        'zh': 'zh-CN',
        'zh-hans': 'zh-CN',
        'zh-cn': 'zh-CN',
        'zh-hant': 'zh-TW',
        'zh-tw': 'zh-TW',
        'en': 'en-US',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES',
        'it': 'it-IT',
        'pt': 'pt-BR',
        'ru': 'ru-RU',
    };

    if (aliases[lower]) return aliases[lower];
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(normalized) ? normalized : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
