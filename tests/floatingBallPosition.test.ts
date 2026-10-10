import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {resolveFloatingBallCenterY, toFloatingBallVerticalPosition} from '@/src/features/floating-ball/position';

describe('悬浮球位置恢复', () => {
  it('旧配置默认居中，并在重新读取配置时保留拖动后的纵向比例', () => {
    expect(new Config().floatingBallVerticalPosition).toBeNull();
    expect(normalizeConfig({floatingBallPosition: 'right'}).floatingBallVerticalPosition).toBeNull();
    const saved = normalizeConfig({floatingBallPosition: 'left', floatingBallVerticalPosition: 0.8});
    expect(normalizeConfig(structuredClone(saved))).toMatchObject({
      floatingBallPosition: 'left', floatingBallVerticalPosition: 0.8,
    });
  });

  it('拒绝无效配置并把超出范围的比例限制在视口内', () => {
    for (const value of [undefined, '0.7', Number.NaN, Infinity, -Infinity]) {
      expect(normalizeConfig({floatingBallVerticalPosition: value}).floatingBallVerticalPosition).toBeNull();
    }
    expect(normalizeConfig({floatingBallVerticalPosition: -0.2}).floatingBallVerticalPosition).toBe(0);
    expect(normalizeConfig({floatingBallVerticalPosition: 1.2}).floatingBallVerticalPosition).toBe(1);
  });

  it('按视口比例恢复高度，并在窗口缩小或工具按钮展开时保持完整容器可见', () => {
    expect(toFloatingBallVerticalPosition(640, 800)).toBe(0.8);
    expect(resolveFloatingBallCenterY(0.8, 800, 128)).toBe(640);
    expect(resolveFloatingBallCenterY(0.8, 300, 128)).toBe(236);
    expect(resolveFloatingBallCenterY(0, 300, 128)).toBe(64);
    expect(resolveFloatingBallCenterY(null, 300, 48)).toBe(150);
    expect(resolveFloatingBallCenterY(1, 80, 128)).toBe(40);
    expect(toFloatingBallVerticalPosition(900, 800)).toBe(1);
    expect(toFloatingBallVerticalPosition(Number.NaN, 800)).toBe(0.5);
  });
});
