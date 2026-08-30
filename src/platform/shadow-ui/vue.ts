/**
 * @file src/platform/shadow-ui/vue.ts
 *
 * 文件职责：把 Vue 应用挂载到扩展创建的隔离 Shadow DOM，并注入跨 feature 共享的基础样式与事件隔离设置。
 * 主要内容：定义 VueShadowMount 与 VueShadowUiOptions，createVueShadowUi 依据 options 选择 open/closed 模式，创建宿主、shadow root、样式和 app，并返回由 WXT 管理的 mount/unmount 资源句柄。 可核对的公开符号包括 VueShadowMount、VueShadowUiOptions、createVueShadowUi。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

import { createApp, type App as VueApp, type Component } from 'vue';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';

export interface VueShadowMount {
  app: VueApp;
  instance: unknown;
}

export interface VueShadowUiOptions {
  name: string;
  hostId: string;
  component: Component;
  props?: Record<string, unknown>;
  zIndex?: number;
  mode?: 'open' | 'closed';
}

const SHADOW_FOUNDATION = `
  :host {
    all: initial !important;
    display: block !important;
    position: relative !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    contain: none !important;
    color-scheme: light dark;
  }

  html,
  body {
    width: 0 !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/**
 * 把 Vue 组件挂载到隔离的 Shadow DOM。
 *
 * 步骤 1：WXT 负责 host 的生命周期和内容脚本失效清理。
 * 步骤 2：这里统一 Vue 的 mount/unmount，避免每个 feature 重复维护 glue。
 * 步骤 3：显式的 host 基础样式阻断宿主页的继承和裁剪影响。
 */
export async function createVueShadowUi(
  ctx: ContentScriptContext,
  options: VueShadowUiOptions,
): Promise<ShadowRootContentScriptUi<VueShadowMount>> {
  const ui = await createShadowRootUi<VueShadowMount>(ctx, {
    name: options.name,
    position: 'overlay',
    alignment: 'top-left',
    zIndex: options.zIndex ?? 2_147_483_647,
    mode: options.mode ?? 'open',
    inheritStyles: false,
    isolateEvents: ['keydown', 'keyup', 'keypress'],
    css: SHADOW_FOUNDATION,
    onMount(container) {
      const app = createApp(options.component, options.props ?? {});
      const instance = app.mount(container);
      return { app, instance };
    },
    onRemove(mounted) {
      mounted?.app.unmount();
    },
  });

  ui.shadowHost.id = options.hostId;
  ui.shadowHost.setAttribute('data-fluent-read-ui', options.name);
  ui.mount();
  return ui;
}
