/**
 * @file src/features/full-page-translation/progress.ts
 * 文件职责：提供全文翻译进度的独立内存状态源，以 sessionId 隔离新旧翻译任务，并向多个 UI 订阅者安全发布发现、完成和失败计数。
 * 主要内容：定义 FullPageTranslationProgress，包含开始、增量更新、结束、活动工作与紧凑状态判定、快照读取和订阅 API；数值会归一化，通知时复制状态，并隔离单个 listener 的异常。
 * 模块边界：该模块不访问 DOM、配置或浏览器存储，也不决定任务调度；content/runtime 负责更新进度，TranslationProgressPanel.vue 只订阅快照，状态仅存活于当前运行上下文。
 */
export interface FullPageTranslationProgress {
  sessionId: number;
  active: boolean;
  running: number;
  remaining: number;
  queued: number;
  offscreen: number;
}

type FullPageTranslationProgressListener = (progress: FullPageTranslationProgress) => void;

const listeners = new Set<FullPageTranslationProgressListener>();
let nextSessionId = 0;
let progress: FullPageTranslationProgress = {
  sessionId: 0,
  active: false,
  running: 0,
  remaining: 0,
  queued: 0,
  offscreen: 0,
};

function cloneProgress(): FullPageTranslationProgress {
  return {...progress};
}

function deliverProgress(listener: FullPageTranslationProgressListener): void {
  try {
    // 每个订阅者都获得独立快照，一个 UI 的误修改或异常不会污染其他 UI。
    listener(cloneProgress());
  } catch (error) {
    console.error('[FluentRead] 全文翻译进度订阅者执行失败', error);
  }
}

function notifyProgressListeners(): void {
  listeners.forEach(deliverProgress);
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** 只有正在请求或已经进入队列的工作才需要展开进度面板；离屏候选不应让大面板常驻。 */
export function hasActiveFullPageTranslationWork(
  value: Pick<FullPageTranslationProgress, 'active' | 'running' | 'queued'>,
): boolean {
  return value.active && (normalizeCount(value.running) > 0 || normalizeCount(value.queued) > 0);
}

/** 悬浮球不可用且会话暂时没有活动工作时，以淡勾选替代常驻的大进度面板。 */
export function shouldShowCompactFullPageTranslationStatus(
  value: Pick<FullPageTranslationProgress, 'active' | 'running' | 'queued'>,
  floatingBallEnabled: boolean,
): boolean {
  return !floatingBallEnabled && value.active && !hasActiveFullPageTranslationWork(value);
}

export function startFullPageTranslationProgress(): number {
  const sessionId = ++nextSessionId;
  progress = {
    sessionId,
    active: true,
    running: 0,
    remaining: 0,
    queued: 0,
    offscreen: 0,
  };
  notifyProgressListeners();
  return sessionId;
}

export function updateFullPageTranslationProgress(
  sessionId: number,
  value: Pick<FullPageTranslationProgress, 'running' | 'queued' | 'offscreen'>,
): void {
  if (!progress.active || progress.sessionId !== sessionId) return;

  const running = normalizeCount(value.running);
  const queued = normalizeCount(value.queued);
  const offscreen = normalizeCount(value.offscreen);
  const remaining = queued + offscreen;
  if (
    progress.running === running &&
    progress.remaining === remaining &&
    progress.queued === queued &&
    progress.offscreen === offscreen
  ) return;

  progress = {...progress, running, remaining, queued, offscreen};
  notifyProgressListeners();
}

export function finishFullPageTranslationProgress(sessionId: number): void {
  if (!progress.active || progress.sessionId !== sessionId) return;
  progress = {
    sessionId,
    active: false,
    running: 0,
    remaining: 0,
    queued: 0,
    offscreen: 0,
  };
  notifyProgressListeners();
}

export function getFullPageTranslationProgress(): FullPageTranslationProgress {
  return cloneProgress();
}

export function subscribeFullPageTranslationProgress(
  listener: FullPageTranslationProgressListener,
): () => void {
  listeners.add(listener);
  deliverProgress(listener);
  return () => {
    listeners.delete(listener);
  };
}
