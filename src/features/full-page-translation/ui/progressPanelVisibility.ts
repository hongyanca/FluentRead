/**
 * @file src/features/full-page-translation/ui/progressPanelVisibility.ts
 * 文件职责：稳定全文翻译进度面板的展示状态，避免短请求和队列间隙反复触发显隐动画。
 * 主要内容：延迟展开短任务、等待连续空闲后收起、保留弹窗等待提示，并在关闭、会话切换和卸载时取消迟到计时器。
 * 模块边界：只管理隐藏、紧凑和展开三种展示状态；不修改 progress.ts 的实时计数，也不参与翻译调度或配置持久化。
 */
import {
  hasActiveFullPageTranslationWork,
  shouldShowCompactFullPageTranslationStatus,
  type FullPageTranslationProgress,
} from '../progress';

export type ProgressPanelDisplayMode = 'hidden' | 'compact' | 'expanded';

const SHOW_DELAY_MS = 180;
const IDLE_DELAY_MS = 600;

export function createProgressPanelVisibility(onChange: (mode: ProgressPanelDisplayMode) => void) {
  let mode: ProgressPanelDisplayMode = 'hidden';
  let sessionId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingMode: ProgressPanelDisplayMode | null = null;
  let revision = 0;
  let disposed = false;

  function cancelPending(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingMode = null;
    revision += 1;
  }

  function apply(next: ProgressPanelDisplayMode): void {
    if (mode === next) return;
    mode = next;
    onChange(next);
  }

  function schedule(next: ProgressPanelDisplayMode, delay: number): void {
    // 计数仍会持续刷新，同一个目标状态不能因刷新而不断延后截止时间。
    if (pendingMode === next) return;
    cancelPending();
    pendingMode = next;
    const requestRevision = revision;
    timer = setTimeout(() => {
      if (disposed || requestRevision !== revision) return;
      timer = null;
      pendingMode = null;
      apply(next);
    }, delay);
  }

  return {
    update(progress: FullPageTranslationProgress, floatingBallEnabled: boolean, dismissed: boolean): void {
      if (disposed) return;
      if (sessionId !== progress.sessionId) {
        cancelPending();
        sessionId = progress.sessionId;
        apply('hidden');
      }

      // 用户关闭或恢复原文不走空闲延迟，也不能被已排入事件队列的回调重新打开。
      if (!progress.active || dismissed) {
        cancelPending();
        apply('hidden');
        return;
      }

      const next: ProgressPanelDisplayMode = hasActiveFullPageTranslationWork(progress)
        ? 'expanded'
        : shouldShowCompactFullPageTranslationStatus(progress, floatingBallEnabled) ? 'compact' : 'hidden';
      if (next === mode || progress.modalPhase === 'waiting') {
        cancelPending();
        apply(next);
      } else if (next === 'expanded') {
        schedule(next, SHOW_DELAY_MS);
      } else if (mode === 'expanded') {
        schedule(next, IDLE_DELAY_MS);
      } else {
        cancelPending();
        apply(next);
      }
    },
    dispose(): void {
      disposed = true;
      cancelPending();
    },
  };
}
