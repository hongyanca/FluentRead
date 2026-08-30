import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function cssRule(file: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = file.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u'));
  expect(match, `缺少样式规则：${selector}`).not.toBeNull();
  return match?.[1] ?? '';
}

function numericDeclaration(rule: string, property: string): number {
  const match = rule.match(new RegExp(`${property}:\\s*([0-9.]+)`, 'u'));
  expect(match, `缺少样式属性：${property}`).not.toBeNull();
  return Number(match?.[1]);
}

describe('低干扰悬浮 UI', () => {
  it('全文翻译切换不再自动展开菜单或弹出快捷键提示', () => {
    const floatingBall = source('src/features/floating-ball/ui/FloatingBall.vue');
    const toggleTranslation = floatingBall.match(/function toggleTranslation\([^)]*\) \{([\s\S]*?)\n\}/u)?.[1] ?? '';
    const handleDocumentKeydown = floatingBall.match(/function handleDocumentKeydown\([^)]*\) \{([\s\S]*?)\n\}/u)?.[1] ?? '';

    expect(toggleTranslation).toContain('props.onTranslationToggle(!isTranslating.value)');
    expect(toggleTranslation).not.toContain('isExpanded.value = true');
    expect(toggleTranslation).toContain('isExpanded.value = false');
    expect(toggleTranslation).toContain('event.detail > 0');
    expect(toggleTranslation).toContain('?.blur()');
    expect(toggleTranslation).not.toContain('isTranslating.value =');
    expect(floatingBall).not.toContain('showShortcutTooltip');
    expect(floatingBall).toContain('defineExpose({ toggleTranslation, setTranslationState })');
    expect(handleDocumentKeydown).toContain("querySelector<HTMLElement>(':focus')?.blur()");
    expect(handleDocumentKeydown).toContain('isExpanded.value = false');
  });

  it('收起态保持半透明，交互态恢复清晰，并把勾选标记留在可见侧', () => {
    const floatingBall = source('src/features/floating-ball/ui/FloatingBall.vue');
    const rightCollapsed = cssRule(
      floatingBall,
      '.fr-floating-ball:not(.floating-ball-expanded):not(.dragging)[data-position="right"] .floating-ball-main',
    );
    const leftCollapsed = cssRule(
      floatingBall,
      '.fr-floating-ball:not(.floating-ball-expanded):not(.dragging)[data-position="left"] .floating-ball-main',
    );
    const expanded = cssRule(
      floatingBall,
      '.fr-floating-ball.floating-ball-expanded .floating-ball-item',
    );

    expect(numericDeclaration(rightCollapsed, 'opacity')).toBeGreaterThanOrEqual(0.4);
    expect(numericDeclaration(rightCollapsed, 'opacity')).toBeLessThanOrEqual(0.6);
    expect(numericDeclaration(leftCollapsed, 'opacity')).toBe(numericDeclaration(rightCollapsed, 'opacity'));
    expect(numericDeclaration(expanded, 'opacity')).toBe(1);
    expect(numericDeclaration(cssRule(floatingBall, '.dragging .floating-ball-main'), 'opacity')).toBe(1);
    expect(cssRule(
      floatingBall,
      '.fr-floating-ball[data-position="right"] .floating-ball-main .check-mark',
    )).toContain('left: -1px');
    expect(cssRule(
      floatingBall,
      '.fr-floating-ball[data-position="left"] .floating-ball-main .check-mark',
    )).toContain('right: -1px');
  });

  it('进度面板使用半透明背景，并由活动请求而非离屏候选决定显隐', () => {
    const panel = source('src/features/full-page-translation/ui/TranslationProgressPanel.vue');
    const panelRule = cssRule(panel, '.fr-translation-progress');
    const backgroundAlpha = Number(panelRule.match(/background:\s*rgba\([^;]+,\s*([0-9.]+)\)/u)?.[1]);

    expect(backgroundAlpha).toBeGreaterThanOrEqual(0.7);
    expect(backgroundAlpha).toBeLessThan(0.9);
    expect(panel).toContain('hasActiveFullPageTranslationWork(progress.value)');
    expect(panel).not.toContain('progress.value.remaining > 0');
    expect(panel).toContain("class=\"fr-progress-compact-check\"");
    expect(panel).toContain('shouldShowCompactFullPageTranslationStatus(');
    expect(panel).toContain("'全文翻译已开启'");
  });
});
