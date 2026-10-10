/**
 * @file src/features/selection-translation/pageZoom.ts
 * 文件职责：定义划词卡片读取标签页页面缩放比例的消息契约及纯数值校验。
 * 主要内容：请求与变更消息名称、缩放比例的有限正数规范化。
 * 模块边界：不访问 tabs、DOM 或配置；后台读取缩放，内容组件只消费校验后的比例。
 */

export const SELECTION_PAGE_ZOOM_REQUEST = 'fluentReadSelectionPageZoom' as const;
export const SELECTION_PAGE_ZOOM_CHANGED = 'fluentReadSelectionPageZoomChanged' as const;

export function normalizeSelectionPageZoom(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10 ? value : 1;
}
