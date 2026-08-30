/**
 * @file src/features/area-translation/content/runtime.ts
 * 文件职责：管理圈选翻译 Vue 覆盖层在网页内容脚本中的单例生命周期，并防止异步 Shadow UI 挂载完成后把已经禁用或过期的实例重新留在页面。
 * 主要内容：包含挂载状态探测、ContentScriptContext 缓存、mountRequestId 所有权校验、closed Shadow Root 创建，以及配置关闭或卸载时移除 UI 和清空实例引用。
 * 模块边界：本文件只协调组件挂载与资源释放，不实现拖拽选区、截图或 OCR；交互状态归 AreaTranslator.vue，平台隔离归 shadow-ui，是否启用仍由共享配置和 feature registry 决定。
 */
import AreaTranslator from '@/src/features/area-translation/ui/AreaTranslator.vue';
import { config } from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

let areaTranslatorInstance: any = null;
let areaTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

export function isAreaTranslatorMounted(): boolean {
  return Boolean(document.getElementById('fluent-read-area-translator-container'));
}

export function mountAreaTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;
  if (areaTranslatorInstance || mountingPromise || config.selectionAreaEnabled !== true) return mountingPromise;
  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-area-translator-ui',
    hostId: 'fluent-read-area-translator-container',
    component: AreaTranslator,
    zIndex: 2_147_483_647,
    // 译图可能包含跨源 frame 的截图像素，必须与宿主页脚本可见的 Shadow Tree 隔离。
    mode: 'closed',
  }).then((ui) => {
    // 挂载完成后复核配置与代次；失去所有权的 UI 立即销毁，不写回单例。
    if (requestId !== mountRequestId || config.selectionAreaEnabled !== true) {
      ui.remove();
      return null;
    }
    areaTranslatorUi = ui;
    areaTranslatorInstance = ui.mounted?.instance ?? null;
    return areaTranslatorInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

export function unmountAreaTranslator(): void {
  // 先让未完成的挂载失效，再释放当前实例，避免迟到的 Promise 恢复已关闭的覆盖层。
  mountRequestId += 1;
  areaTranslatorUi?.remove();
  areaTranslatorUi = null;
  areaTranslatorInstance = null;
}
