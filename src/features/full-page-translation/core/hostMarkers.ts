/**
 * @file src/features/full-page-translation/core/hostMarkers.ts
 * 文件职责：统一全文翻译写在宿主元素上的生命周期标记，保证插件只使用 data 属性标记宿主，并安全清理历史版本遗留的 class 标记。
 * 主要内容：导出失败标记属性名、写入与清除失败标记的函数，以及只在确实由插件写入时才移除空 class 属性的历史标记清理函数。
 * 模块边界：本文件只做宿主标记的属性读写，不创建译文节点、不查询候选、不发起翻译，也不感知会话状态；译文产物的所有权判定仍由 state 与 data-fr-translation-owned 负责。
 */

/**
 * 宿主失败标记。
 *
 * 历史版本把 `fluent-read-failure` 写进宿主 class，导致依赖 `:not([class])`
 * 之类选择器的站点在翻译后改变原文字号与字体（issue #170）。标记改用
 * FluentRead 专属 data 属性，宿主 class 属性保持原样。
 */
export const TRANSLATION_FAILED_ATTRIBUTE = 'data-fr-translation-failed';

/** 历史版本写在宿主 class 上的标记，只用于清理旧 DOM，不再新增。 */
const LEGACY_HOST_MARKER_CLASSES = ['fluent-read-bilingual', 'fluent-read-failure'] as const;

/** 标记宿主本次翻译失败，供失败提示与重试流程识别。 */
export function markTranslationFailedHost(node: HTMLElement): void {
    node.setAttribute(TRANSLATION_FAILED_ATTRIBUTE, 'true');
}

/** 清除失败标记，并顺带清掉历史版本可能残留的 class 标记。 */
export function clearTranslationFailedHost(node: HTMLElement): void {
    node.removeAttribute(TRANSLATION_FAILED_ATTRIBUTE);
    clearLegacyHostMarkerClasses(node);
}

/**
 * 移除历史 class 标记。
 *
 * 宿主原本没有 class 属性时不能凭空写入，宿主原本就带空 class 属性时也不能
 * 删除：两种情况都会改变站点 `[class]` 选择器的匹配结果。只有插件标记被移除
 * 后 class 变空，才把属性一起删掉，让宿主回到未翻译时的匹配状态。
 */
export function clearLegacyHostMarkerClasses(node: HTMLElement): void {
    if (!node.getAttribute('class')) return;
    node.classList.remove(...LEGACY_HOST_MARKER_CLASSES);
    if (node.getAttribute('class') === '') node.removeAttribute('class');
}
