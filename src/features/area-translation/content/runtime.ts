/**
 * @file src/features/area-translation/content/runtime.ts
 * 文件职责：为圈选翻译安装无 DOM 的可信入口，并仅在首次有效手势后挂载 Vue 覆盖层。
 * 主要内容：管理快捷键与右键入口、ContentScriptContext、异步挂载代次、closed Shadow Root 和关闭时的资源释放。
 * 模块边界：本文件只协调入口与组件生命周期，不实现拖拽选区、截图或 OCR；手势资格归 areaHotkey，交互状态归 AreaTranslator.vue，平台隔离归 shadow-ui。
 */
import AreaTranslator from '@/src/features/area-translation/ui/AreaTranslator.vue';
import { config } from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';
import {setAreaContextMenuHandler} from './contextMenuBridge';
import {shouldStartAreaTranslationFromHotkey} from './areaHotkey';

interface AreaTranslatorExposed {beginSelection(): boolean}
let areaTranslatorInstance: AreaTranslatorExposed | null = null;
let areaTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<AreaTranslatorExposed | null> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;
let launcherController: AbortController | null = null;
let releaseContextMenuHandler: (() => void) | null = null;

export function isAreaTranslatorMounted(): boolean {
  return launcherController !== null && !launcherController.signal.aborted;
}

/** 注册入口时不创建宿主节点；右键和快捷键都走同一个按需挂载路径。 */
export function mountAreaTranslator(ctx?: ContentScriptContext): void {
  if (ctx) contentScriptContext = ctx;
  if (launcherController || !contentScriptContext || config.selectionAreaEnabled !== true || config.on === false) return;

  const controller = new AbortController();
  launcherController = controller;
  document.addEventListener('keydown', (event) => {
    if (!shouldStartAreaTranslationFromHotkey(event, config, document)) return;
    event.preventDefault();
    void activateAreaTranslator().catch((error: unknown) => console.error('[FluentRead] 圈选翻译挂载失败', error));
  }, {capture: true, signal: controller.signal});
  releaseContextMenuHandler = setAreaContextMenuHandler(() => {
    if (controller.signal.aborted || config.on === false || config.selectionAreaEnabled !== true) return false;
    return activateAreaTranslator();
  });
}

async function activateAreaTranslator(): Promise<boolean> {
  if (!isAreaTranslatorMounted()) return false;
  if (areaTranslatorInstance) return areaTranslatorInstance.beginSelection();

  if (!mountingPromise) {
    const requestId = ++mountRequestId;
    let pending!: Promise<AreaTranslatorExposed | null>;
    // launcher 只在 mountAreaTranslator 保存上下文后安装。
    pending = createVueShadowUi(contentScriptContext!, {
      name: 'fluent-read-area-translator-ui',
      hostId: 'fluent-read-area-translator-container',
      component: AreaTranslator,
      zIndex: 2_147_483_647,
      // 译图可能包含跨源 frame 的截图像素，必须与宿主页脚本可见的 Shadow Tree 隔离。
      mode: 'closed',
    }).then((ui) => {
      if (requestId !== mountRequestId || !isAreaTranslatorMounted()
        || config.on === false || config.selectionAreaEnabled !== true) {
        ui.remove();
        return null;
      }
      const instance = ui.mounted?.instance as AreaTranslatorExposed | null | undefined;
      if (typeof instance?.beginSelection !== 'function') {
        ui.remove();
        return null;
      }
      areaTranslatorUi = ui;
      areaTranslatorInstance = instance;
      return instance;
    }).finally(() => {
      if (mountingPromise === pending) mountingPromise = null;
    });
    mountingPromise = pending;
  }

  const instance = await mountingPromise;
  return Boolean(instance && isAreaTranslatorMounted() && instance.beginSelection());
}

export function unmountAreaTranslator(): void {
  // 先撤销入口和未完成的挂载，再释放当前 UI，避免迟到的 Promise 恢复已关闭的覆盖层。
  mountRequestId += 1;
  mountingPromise = null;
  launcherController?.abort();
  launcherController = null;
  releaseContextMenuHandler?.();
  releaseContextMenuHandler = null;
  areaTranslatorUi?.remove();
  areaTranslatorUi = null;
  areaTranslatorInstance = null;
}
