import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/features/vocabulary/ui/VocabularyBook.vue'), 'utf8');

function extractBlock(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('VocabularyBook component lifecycle wiring', () => {
  it('opens the merged translation settings when selection translation is disabled', () => {
    expect(source).toContain("emit('navigate', 'settings-translation')");
    expect(source).not.toContain("emit('navigate', 'settings-shortcuts')");
  });

  it('keeps learning and domain actions in the wordbook while routing full restore to one page', () => {
    expect(source).toContain("emit('navigate', 'settings-data')");
    expect(source).toContain('>备份与恢复</button>');
    expect(source).toContain('>从备份恢复</button>');
    expect(source).toContain('>导出到 Anki</button>');
    expect(source).toContain('>清空单词本</button>');
    expect(source).toContain("confirmButtonText: '不包含'");
    expect(source).not.toContain('独立备份与迁移');
    expect(source).not.toContain('分别管理');
    expect(source).not.toContain('class="data-panel"');
    expect(source).not.toContain('导出 FluentRead JSON');
  });

  it('registers async listeners and initial load only after configReady is still active', () => {
    const mountedBlock = extractBlock('onMounted(async () => {', 'onBeforeUnmount(() => {');
    const guardedInitialization = extractBlock(
      'await lifecycle.runAfterReady(configReady, async () => {',
      '});\n});\n\nonBeforeUnmount',
    );

    expect(mountedBlock).not.toContain('await configReady;');
    expect(guardedInitialization).toContain('unsubscribeConfig = subscribeConfig');
    expect(guardedInitialization).toContain('browser.runtime.onMessage.addListener(handleBookChanged)');
    expect(guardedInitialization).toContain("window.addEventListener('keydown', handleReviewKeyboard)");
    expect(guardedInitialization).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(guardedInitialization).toContain('await loadEntries();');
  });

  it('disposes the lifecycle guard before removing listeners', () => {
    const unmountBlock = extractBlock('onBeforeUnmount(() => {', '</script>');
    expect(unmountBlock.indexOf('lifecycle.dispose();')).toBeGreaterThanOrEqual(0);
    expect(unmountBlock.indexOf('lifecycle.dispose();')).toBeLessThan(
      unmountBlock.indexOf('browser.runtime.onMessage.removeListener(handleBookChanged)'),
    );
  });
});
