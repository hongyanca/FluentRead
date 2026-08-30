/**
 * @file src/features/full-page-translation/content/progressPanel.ts
 * 文件职责：管理全文翻译进度面板在内容页中的异步 Shadow UI 生命周期，并依据配置开关、翻译活动状态和请求代次决定保留或清理挂载结果。
 * 主要内容：包含单例实例和 UI 句柄、ContentScriptContext 缓存、mountRequestId 所有权校验、closed Shadow Root 创建，以及 mountTranslationProgressPanel 与 unmountTranslationProgressPanel。
 * 模块边界：该文件不计算进度也不渲染面板内容；状态发布归 progress.ts，视觉和关闭行为归 TranslationProgressPanel.vue，何时启用由 content composition root 和配置服务控制。
 */
import TranslationProgressPanel from '@/src/features/full-page-translation/ui/TranslationProgressPanel.vue';
import {config} from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

let progressPanelInstance: unknown = null;
let progressPanelUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<unknown | null> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;
let mountRequested = false;

export function mountTranslationProgressPanel(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;
  mountRequested = config.translationProgressPanelEnabled === true;
  if (progressPanelUi || progressPanelInstance || mountingPromise || !mountRequested) {
    return mountingPromise;
  }
  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  let retryAfterStaleMount = false;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-translation-progress-ui',
    // 保留旧版 host id，继续兼容既有 DOM 排除规则和自动化定位。
    hostId: 'fluent-read-translation-status-container',
    component: TranslationProgressPanel,
    zIndex: 2_147_483_645,
  }).then((ui) => {
    if (requestId !== mountRequestId || config.translationProgressPanelEnabled !== true) {
      retryAfterStaleMount = requestId !== mountRequestId;
      ui.remove();
      return null;
    }
    progressPanelUi = ui;
    progressPanelInstance = ui.mounted?.instance ?? null;
    return progressPanelInstance;
  }).catch((error) => {
    console.error('[FluentRead] 翻译进度面板挂载失败', error);
    return null;
  }).finally(() => {
    mountingPromise = null;
    // 设置页可能在 Shadow UI 首次挂载完成前快速关闭再开启。旧请求会按
    // requestId 自行移除，这里补发用户最后一次明确保留的挂载请求。
    if (retryAfterStaleMount && mountRequested && !progressPanelInstance) {
      void mountTranslationProgressPanel();
    }
  });

  return mountingPromise;
}

export function unmountTranslationProgressPanel(): void {
  mountRequested = false;
  mountRequestId += 1;
  progressPanelUi?.remove();
  progressPanelUi = null;
  progressPanelInstance = null;
}
