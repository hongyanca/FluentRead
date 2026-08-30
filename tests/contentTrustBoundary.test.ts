import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('host-page trust boundary', () => {
  it('does not expose page-dispatchable configuration or full-page controls', () => {
    const content = [
      source('entrypoints/content.ts'),
      source('src/app/content/runtime.ts'),
      source('src/app/content/hotkeyRuntime.ts'),
      source('src/app/content/messageRuntime.ts'),
      source('src/features/hover-translation/content/index.ts'),
      source('src/features/input-translation/content/index.ts'),
    ].join('\n');
    const floatingBall = source('src/features/floating-ball/ui/FloatingBall.vue');

    expect(existsSync(resolve(process.cwd(), 'entrypoints/utils/newApi.ts'))).toBe(false);
    expect(content).not.toContain('fluent:prefill');
    expect(content).not.toContain('fluentread-toggle-translation');
    expect(floatingBall).not.toContain('fluentread-toggle-translation');
    expect(content).toContain('toggleFloatingBallTranslation()');
  });

  it('rejects synthetic input before network and screenshot side effects', () => {
    const content = [
      source('entrypoints/content.ts'),
      source('src/app/content/runtime.ts'),
      source('src/app/content/hotkeyRuntime.ts'),
      source('src/app/content/messageRuntime.ts'),
      source('src/features/hover-translation/content/index.ts'),
      source('src/features/input-translation/content/index.ts'),
    ].join('\n');
    const area = source('src/features/area-translation/ui/AreaTranslator.vue');
    const selection = source('src/features/selection-translation/ui/SelectionTranslator.vue');
    const image = source('src/features/image-translation/content/runtime.ts');
    const video = source('src/features/video-subtitle/content/runtime.ts');

    expect(content.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(10);
    expect(area.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(6);
    expect(selection).toContain('TRUSTED_SELECTION_INTERACTION_GRACE_MS');
    expect(image.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(video.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps privileged controls and translated bitmaps out of page-visible shadow roots', () => {
    expect(source('src/features/floating-ball/content/runtime.ts')).toContain("mode: 'closed'");
    expect(source('src/features/selection-translation/content/runtime.ts')).toContain("mode: 'closed'");
    expect(source('src/features/input-translation/content/index.ts')).toContain("mode: 'closed'");
    expect(source('src/features/area-translation/content/runtime.ts')).toContain("mode: 'closed'");
    expect(source('src/features/image-translation/content/runtime.ts')).toContain("attachShadow({ mode: 'closed' })");
  });
});
