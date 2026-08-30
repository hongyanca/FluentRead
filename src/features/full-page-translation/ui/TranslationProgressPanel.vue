<!--
 * @file src/features/full-page-translation/ui/TranslationProgressPanel.vue
 * 文件职责：以半透明工作面板和低存在感状态勾选展示全文翻译进度，并允许用户临时收起，同时跟随扩展主题与系统深浅色偏好。
 * 主要内容：组件订阅 progress 内存状态和配置更新，有请求或排队任务时展示详情；仅剩离屏候选且悬浮球关闭时退化为淡勾选，避免大面板常驻又不丢失会话提示。
 * 模块边界：组件不启动、取消或重试翻译，也不保存业务进度；数据只来自 progress.ts，是否创建 Shadow UI 由 content/progressPanel.ts 决定，样式局限于组件作用域。
 -->
<template>
  <Transition name="fr-progress-panel">
    <aside
      v-if="isVisible"
      class="fr-translation-progress"
      :class="{ 'fr-dark': isDark, 'fr-static': !animationsEnabled, 'fr-compact': isCompact }"
      :data-session-id="progress.sessionId"
      :data-running="progress.running"
      :data-remaining="progress.remaining"
      :data-queued="progress.queued"
      :data-offscreen="progress.offscreen"
    >
      <span
        v-if="isCompact"
        class="fr-progress-compact-check"
        role="status"
        aria-live="polite"
        :aria-label="compactStatusLabel"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="9" />
          <path d="m5.8 10.2 2.5 2.5 5.8-6" />
        </svg>
      </span>

      <template v-else>
        <span class="fr-progress-indicator" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>

        <span
          class="fr-progress-copy"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          :aria-label="statusLabel"
        >
          <strong>翻译进度</strong>
          <span class="fr-progress-counts">
            <span>进行中 <b>{{ progress.running }}</b></span>
            <span class="fr-progress-divider" aria-hidden="true" />
            <span>剩余 <b>{{ progress.remaining }}</b></span>
          </span>
          <small v-if="progress.offscreen > 0">
            {{ progress.offscreen }} 项将在滚动到附近时翻译
          </small>
        </span>

        <button type="button" aria-label="本次全文翻译不再显示进度面板" title="本次隐藏" @click="dismiss">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </template>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  getFullPageTranslationProgress,
  hasActiveFullPageTranslationWork,
  shouldShowCompactFullPageTranslationStatus,
  subscribeFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';
import {config, subscribeConfig} from '@/src/services/config/store';

const progress = ref(getFullPageTranslationProgress());
const dismissedSessionId = ref<number | null>(null);
const animationsEnabled = ref(config.animations !== false);
const configuredTheme = ref(config.theme || 'auto');
const floatingBallEnabled = ref(config.disableFloatingBall !== true);
const prefersDark = ref(false);
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

let unsubscribeProgress: (() => void) | null = null;
let unsubscribeConfig: (() => void) | null = null;

const isDark = computed(() => configuredTheme.value === 'dark' || (
  configuredTheme.value === 'auto' && prefersDark.value
));

const hasActiveWork = computed(() => hasActiveFullPageTranslationWork(progress.value));
const isCompact = computed(() => shouldShowCompactFullPageTranslationStatus(
  progress.value,
  floatingBallEnabled.value,
));
const isVisible = computed(() => progress.value.sessionId !== dismissedSessionId.value &&
  (hasActiveWork.value || isCompact.value));

const compactStatusLabel = computed(() => progress.value.offscreen > 0
  ? `全文翻译已开启，${progress.value.offscreen} 项将在滚动到附近时翻译`
  : '全文翻译已开启');

const statusLabel = computed(() => {
  const offscreen = progress.value.offscreen > 0
    ? `，其中 ${progress.value.offscreen} 个任务将在滚动到附近时翻译`
    : '';
  return `翻译进度：正在进行 ${progress.value.running} 个任务，剩余 ${progress.value.remaining} 个任务${offscreen}`;
});

function updatePreferredTheme(event?: MediaQueryListEvent): void {
  prefersDark.value = event?.matches ?? darkModeMediaQuery.matches;
}

function dismiss(): void {
  dismissedSessionId.value = progress.value.sessionId;
}

onMounted(() => {
  updatePreferredTheme();
  darkModeMediaQuery.addEventListener('change', updatePreferredTheme);
  unsubscribeProgress = subscribeFullPageTranslationProgress((nextProgress) => {
    progress.value = nextProgress;
  });
  unsubscribeConfig = subscribeConfig((nextConfig) => {
    animationsEnabled.value = nextConfig.animations !== false;
    configuredTheme.value = nextConfig.theme || 'auto';
    floatingBallEnabled.value = nextConfig.disableFloatingBall !== true;
  });
});

onBeforeUnmount(() => {
  darkModeMediaQuery.removeEventListener('change', updatePreferredTheme);
  unsubscribeProgress?.();
  unsubscribeProgress = null;
  unsubscribeConfig?.();
  unsubscribeConfig = null;
});
</script>

<style scoped>
.fr-translation-progress {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 2147483645;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 28px;
  gap: 10px;
  align-items: center;
  width: min(286px, calc(100vw - 32px));
  padding: 11px 10px 11px 12px;
  border: 1px solid rgba(229, 88, 139, 0.24);
  border-radius: 14px;
  background: rgba(255, 252, 253, 0.84);
  box-shadow: 0 10px 28px rgba(68, 38, 52, 0.14), 0 2px 7px rgba(68, 38, 52, 0.06);
  color: #3f3540;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.35;
  pointer-events: auto;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.fr-progress-indicator {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  width: 34px;
  height: 34px;
  padding: 8px 7px;
  border-radius: 10px;
  background: linear-gradient(145deg, #fff0f5, #ffe0eb);
  color: #e84f87;
}

.fr-translation-progress.fr-compact {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  grid-template-columns: 1fr;
  gap: 0;
  place-items: center;
  border-color: rgba(34, 197, 94, 0.2);
  border-radius: 50%;
  background: rgba(240, 253, 244, 0.68);
  box-shadow: 0 4px 14px rgba(22, 101, 52, 0.1);
  pointer-events: none;
}

.fr-progress-compact-check,
.fr-progress-compact-check svg {
  display: block;
  width: 16px;
  height: 16px;
}

.fr-progress-compact-check circle {
  fill: rgba(34, 197, 94, 0.66);
}

.fr-progress-compact-check path {
  fill: none;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.fr-progress-indicator i {
  display: block;
  width: 4px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
  animation: fr-progress-pulse 0.72s ease-in-out infinite alternate;
}

.fr-progress-indicator i:nth-child(2) {
  height: 14px;
  animation-delay: 0.16s;
}

.fr-progress-indicator i:nth-child(3) {
  height: 11px;
  animation-delay: 0.32s;
}

.fr-progress-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.fr-progress-copy strong {
  color: #342b35;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.fr-progress-counts {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #746875;
  white-space: nowrap;
}

.fr-progress-counts b {
  color: #bd2f62;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
}

.fr-progress-divider {
  width: 1px;
  height: 10px;
  background: #e7dce1;
}

.fr-progress-copy small {
  overflow: hidden;
  color: #70636e;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button {
  display: grid;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #988b95;
  cursor: pointer;
}

button:hover,
button:focus-visible {
  background: #f8e9ef;
  color: #cf3e73;
  outline: none;
}

button:focus-visible {
  box-shadow: 0 0 0 2px rgba(232, 79, 135, 0.28);
}

button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.6;
}

.fr-dark {
  border-color: rgba(242, 116, 162, 0.3);
  background: rgba(38, 31, 39, 0.84);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28), 0 2px 7px rgba(0, 0, 0, 0.16);
  color: #f7edf1;
}

.fr-dark.fr-compact {
  border-color: rgba(74, 222, 128, 0.24);
  background: rgba(20, 45, 30, 0.68);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.2);
}

.fr-dark .fr-progress-indicator {
  background: linear-gradient(145deg, #593043, #442635);
  color: #ff80ae;
}

.fr-dark .fr-progress-copy strong {
  color: #fff7fa;
}

.fr-dark .fr-progress-counts {
  color: #d1c2c9;
}

.fr-dark .fr-progress-counts b {
  color: #ff80ae;
}

.fr-dark .fr-progress-divider {
  background: #5d4c55;
}

.fr-dark .fr-progress-copy small,
.fr-dark button {
  color: #bfaeb7;
}

.fr-dark button:hover,
.fr-dark button:focus-visible {
  background: #523242;
  color: #ff91b8;
}

.fr-progress-panel-enter-active,
.fr-progress-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.fr-progress-panel-enter-from,
.fr-progress-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.fr-static .fr-progress-indicator i {
  animation: none;
}

.fr-static.fr-progress-panel-enter-active,
.fr-static.fr-progress-panel-leave-active {
  transition: none;
}

@keyframes fr-progress-pulse {
  from { transform: scaleY(0.5); opacity: 0.5; }
  to { transform: scaleY(1); opacity: 1; }
}

@media (max-width: 420px) {
  .fr-translation-progress {
    right: max(10px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
    width: min(270px, calc(100vw - 20px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .fr-translation-progress,
  .fr-progress-indicator i {
    animation: none;
    transition: none;
  }
}
</style>
