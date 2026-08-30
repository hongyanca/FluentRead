/**
 * @file src/shared/geometry/touch.ts
 *
 * 文件职责：计算触摸点集合的几何中心，为图片缩放、手势或区域交互提供稳定坐标。
 * 主要内容：getCenterPoint 接受只读 clientX/clientY 点集合，只在 touches.length 精确等于 requiredTouches 且非零时求平均坐标；数量不符或零触点返回 undefined，避免 NaN 传播。 可核对的公开符号包括 getCenterPoint。
 * 模块边界：本文件属于 shared 小型公共层，仅提供无状态或低语义耦合的类型与工具；不读取 FluentRead 配置、不调用 provider、不注册入口或持有 feature 生命周期，使用者需自行处理业务政策。
 */

/** 仅在触摸点数量精确匹配时计算中心点。 */
export function getCenterPoint(
    touches: Pick<TouchList, 'length' | 'item'> & {[index: number]: Pick<Touch, 'clientX' | 'clientY'>},
    requiredTouches: number,
): {x: number; y: number} | undefined {
    if (touches.length !== requiredTouches || touches.length === 0) return undefined;

    let centerX = 0;
    let centerY = 0;
    for (let index = 0; index < touches.length; index += 1) {
        centerX += touches[index].clientX;
        centerY += touches[index].clientY;
    }

    return {
        x: centerX / touches.length,
        y: centerY / touches.length,
    };
}
