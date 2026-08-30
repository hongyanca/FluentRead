/**
 * @file src/features/selection-translation/content/runtime.ts
 * 文件职责：管理 SelectionTranslator Vue 覆盖层在内容脚本中的单例挂载、异步所有权校验与卸载，避免配置快速切换时旧 Promise 污染新实例。
 * 主要内容：缓存 ContentScriptContext，维护 mountRequestId、实例与 Shadow UI 句柄，创建最高层级 closed Shadow Root，并在 selectionTranslatorEnabled 关闭或请求过期时立即移除。
 * 模块边界：运行时只负责编排组件生命周期，不读取 Selection API、不调用翻译或 TTS；这些行为归 Vue 组件与控制器，Shadow DOM 创建由 platform/shadow-ui 提供。
 */
import SelectionTranslator from '@/src/features/selection-translation/ui/SelectionTranslator.vue';
import { config } from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

let selectionTranslatorInstance: any = null;
let selectionTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

/**
 * 挂载选词翻译组件
 */
export function mountSelectionTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果已存在实例或配置禁用了此功能，则不创建
  if (selectionTranslatorInstance || mountingPromise || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-selection-translator-ui',
    hostId: 'fluent-read-selection-translator-container',
    component: SelectionTranslator,
    zIndex: 2_147_483_646,
    // 词卡包含复制、朗读和翻译动作，closed root 防止宿主页通过合成 DOM 事件调用这些能力。
    mode: 'closed',
  }).then((ui) => {
    // 异步创建结束后复核代次和开关，旧请求不得覆盖较新的挂载状态。
    if (requestId !== mountRequestId || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
      ui.remove();
      return null;
    }

    selectionTranslatorUi = ui;
    selectionTranslatorInstance = ui.mounted?.instance ?? null;
    return selectionTranslatorInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * 卸载选词翻译组件
 */
export function unmountSelectionTranslator() {
  // 先使未完成的挂载失效，再清空 UI 与实例引用。
  mountRequestId++;
  selectionTranslatorUi?.remove();
  selectionTranslatorUi = null;
  selectionTranslatorInstance = null;
}
