/**
 * @file src/features/area-translation/core.ts
 * 文件职责：提供圈选翻译不依赖浏览器 API 的键盘与几何算法，把用户拖拽的 CSS 视口区域安全规范化并映射到截图实际像素坐标。
 * 主要内容：定义 AreaPoint、AreaRect、AreaTranslationSelection 与 ImageCropRect，包含非有限值处理、视口裁剪、最小可用尺寸判断和缩放取整逻辑。
 * 模块边界：该模块保持纯函数与纯类型，不读取 DOM、配置或图片内容；触发快捷键的归一化与匹配归 core/config/areaTranslation，事件监听属于 UI，captureVisibleTab 属于后台，裁剪后的 OCR 和绘制由 image-translation 的 Offscreen 服务承担。
 */
export interface AreaPoint {
    x: number;
    y: number;
}

export interface AreaRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface AreaTranslationSelection extends AreaRect {
    viewportWidth: number;
    viewportHeight: number;
}

export interface ImageCropRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** 将拖拽起点和终点规范化为不超出视口的矩形。 */
export function normalizeAreaRect(start: AreaPoint, end: AreaPoint, viewport: { width: number; height: number }): AreaRect {
    const viewportWidth = Math.max(1, finiteOrZero(viewport.width));
    const viewportHeight = Math.max(1, finiteOrZero(viewport.height));
    const startX = finiteOrZero(start.x);
    const startY = finiteOrZero(start.y);
    const endX = finiteOrZero(end.x);
    const endY = finiteOrZero(end.y);
    const left = clamp(Math.min(startX, endX), 0, viewportWidth);
    const top = clamp(Math.min(startY, endY), 0, viewportHeight);
    const right = clamp(Math.max(startX, endX), 0, viewportWidth);
    const bottom = clamp(Math.max(startY, endY), 0, viewportHeight);

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

export function isUsableAreaRect(rect: AreaRect, minimumSize = 12): boolean {
    return Number.isFinite(rect.left)
        && Number.isFinite(rect.top)
        && Number.isFinite(rect.width)
        && Number.isFinite(rect.height)
        && rect.width >= minimumSize
        && rect.height >= minimumSize;
}

/** 将 CSS 视口坐标映射到 captureVisibleTab 返回的像素坐标。 */
export function areaRectToImageCrop(
    selection: AreaTranslationSelection,
    imageWidth: number,
    imageHeight: number,
): ImageCropRect {
    const sourceWidth = Math.max(1, Math.floor(imageWidth));
    const sourceHeight = Math.max(1, Math.floor(imageHeight));
    const viewportWidth = Math.max(1, finiteOrZero(selection.viewportWidth));
    const viewportHeight = Math.max(1, finiteOrZero(selection.viewportHeight));
    const scaleX = sourceWidth / viewportWidth;
    const scaleY = sourceHeight / viewportHeight;
    const left = clamp(Math.floor(selection.left * scaleX), 0, sourceWidth - 1);
    const top = clamp(Math.floor(selection.top * scaleY), 0, sourceHeight - 1);
    const right = clamp(Math.ceil((selection.left + selection.width) * scaleX), left + 1, sourceWidth);
    const bottom = clamp(Math.ceil((selection.top + selection.height) * scaleY), top + 1, sourceHeight);

    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}
