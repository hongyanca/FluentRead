/**
 * @file src/features/image-translation/services/rendering.ts
 * 文件职责：根据 OCR 文本框周围的 ImageData 像素估算局部背景色，并为译文选择具有足够对比度的黑色或白色前景。
 * 主要内容：导出 getImageTextBackgroundColor 与 getImageTextColor，采样文本框周边像素、过滤透明值、计算平均 RGB 和亮度，返回 CSS 颜色字符串。
 * 模块边界：这是无 DOM 副作用的颜色辅助模块，不负责 OCR、蒙版修补或 Canvas 绘制；offscreenRuntime 提供图像数据和 OcrLine，并消费计算结果完成最终渲染。
 */
import type { OcrLine } from '@/src/shared/image/types';

/** 从 OCR 框四周采样最常见的量化颜色，供修复后的译文重绘使用。 */
export function getImageTextBackgroundColor(
    pixels: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    bbox: OcrLine['bbox'],
): string {
    const x0 = Math.max(0, Math.floor(bbox.x0));
    const y0 = Math.max(0, Math.floor(bbox.y0));
    const x1 = Math.min(imageWidth, Math.ceil(bbox.x1));
    const y1 = Math.min(imageHeight, Math.ceil(bbox.y1));
    const colors = new Map<string, number>();
    const sample = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return;
        const offset = (y * imageWidth + x) * 4;
        const red = Math.min(255, Math.round(pixels[offset] / 16) * 16);
        const green = Math.min(255, Math.round(pixels[offset + 1] / 16) * 16);
        const blue = Math.min(255, Math.round(pixels[offset + 2] / 16) * 16);
        const key = `${red},${green},${blue}`;
        colors.set(key, (colors.get(key) || 0) + 1);
    };
    for (let y = y0 - 4; y <= y1 + 3; y += 1) {
        for (let x = x0 - 4; x <= x1 + 3; x += 1) {
            if (x < x0 || x >= x1 || y < y0 || y >= y1) sample(x, y);
        }
    }
    let best = '255,255,255';
    let bestCount = 0;
    colors.forEach((count, color) => {
        if (count > bestCount) {
            best = color;
            bestCount = count;
        }
    });
    return `rgb(${best})`;
}

/** 按 WCAG 风格亮度阈值选择深色或浅色译文字色。 */
export function getImageTextColor(backgroundColor: string): string {
    const channels = backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return luminance > 150 ? '#111827' : '#ffffff';
}
