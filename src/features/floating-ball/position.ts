/**
 * @file src/features/floating-ball/position.ts
 * 文件职责：在不同视口高度和悬浮球尺寸之间换算可持久化的纵向位置。
 * 主要内容：将拖动结束时的中心点转为视口比例，并在恢复位置时限制完整悬浮球容器留在可见区域。
 * 模块边界：只处理有限的几何数值，不读取 DOM、配置或浏览器存储；组件负责测量，运行时负责保存。
 */

export function toFloatingBallVerticalPosition(centerY: number, viewportHeight: number): number {
  if (!Number.isFinite(centerY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0.5;
  return Math.max(0, Math.min(1, centerY / viewportHeight));
}

export function resolveFloatingBallCenterY(
  position: number | null,
  viewportHeight: number,
  containerHeight: number,
): number {
  const viewport = Math.max(0, viewportHeight);
  const halfHeight = Math.min(viewport / 2, Math.max(0, containerHeight) / 2);
  const target = (position ?? 0.5) * viewport;
  return Math.max(halfHeight, Math.min(viewport - halfHeight, target));
}
