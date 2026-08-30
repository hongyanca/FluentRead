/**
 * @file src/features/floating-ball/content/runtime.ts
 * 文件职责：协调悬浮球组件在网页中的创建、恢复位置、显隐、权威翻译状态同步和卸载，并向组件注入全文翻译切换与打开设置页的动作。
 * 主要内容：维护单例 Shadow UI、迟到挂载 requestId、全文会话订阅与 position-change 字段补丁，提供 mountFloatingBall、toggleFloatingBallTranslation、unmountFloatingBall 三个生命周期入口。
 * 模块边界：运行时只拥有挂载和桥接职责，不实现拖拽视觉或全文翻译算法；FloatingBall.vue 负责交互，full-page feature 提供翻译动作，配置持久化通过 services/config 完成。
 */
import FloatingBall from '@/src/features/floating-ball/ui/FloatingBall.vue';
import {config, requestConfigPatch} from '@/src/services/config/store';
import browser from 'webextension-polyfill';
import {
  autoTranslateEnglishPage,
  isFullPageTranslationActive,
  restoreOriginalContent,
  subscribeFullPageTranslationProgress,
} from '@/src/features/full-page-translation/public';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

interface FloatingBallExposed {
  toggleTranslation: () => void;
  setTranslationState: (isTranslating: boolean) => void;
}

let floatingBallInstance: FloatingBallExposed | null = null;
let floatingBallUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<FloatingBallExposed | null> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;
let unsubscribeFullPageTranslationProgress: (() => void) | null = null;

/** 创建并挂载悬浮球 */
export function mountFloatingBall(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果配置禁用了悬浮球或已存在实例，则不创建
  if (config.disableFloatingBall || floatingBallUi || floatingBallInstance || mountingPromise) {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const ballPosition = config.floatingBallPosition || 'right';
  const requestId = ++mountRequestId;
  // 更新配置
  config.floatingBallPosition = ballPosition;

  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-floating-ball-ui',
    hostId: 'fluent-read-floating-ball-container',
    component: FloatingBall,
    props: {
      position: ballPosition,
      showMenu: true,
      logoUrl: browser.runtime.getURL('/icon/128.png'),
      initialTranslating: isFullPageTranslationActive(),
      onSettingsClick: () => {
        void browser.runtime.sendMessage({type: 'openOptionsPage'}).catch((error: unknown) => {
          console.error('[FluentRead] 打开设置页失败', error);
        });
      },
      // 添加位置变化事件监听
      onPositionChanged: (newPosition: 'left' | 'right') => {
        // 只提交位置字段；配置服务会立即乐观同步，并在后台基于最新快照合并。
        void requestConfigPatch(
          {floatingBallPosition: newPosition},
          browser.runtime.sendMessage.bind(browser.runtime),
        ).catch((error: unknown) => console.error('Failed to save config:', error));
      },
      // 添加翻译状态变化事件监听
      onTranslationToggle: (isTranslating: boolean) => {
        if (isTranslating === isFullPageTranslationActive()) return;

        if (isTranslating) {
          autoTranslateEnglishPage();
        } else {
          restoreOriginalContent();
        }
      },
    },
    // 宿主页可以向开放的 Shadow Tree 派发合成点击，因此翻译、设置和位置控件必须留在 closed 边界内。
    mode: 'closed',
  }).then((ui) => {
    // 异步挂载返回时重新核对请求所有权，禁止已禁用的旧实例回到页面。
    if (requestId !== mountRequestId || config.disableFloatingBall) {
      ui.remove();
      return null;
    }

    floatingBallUi = ui;
    floatingBallInstance = (ui.mounted?.instance as FloatingBallExposed | null | undefined) ?? null;
    if (floatingBallInstance) {
      unsubscribeFullPageTranslationProgress?.();
      unsubscribeFullPageTranslationProgress = subscribeFullPageTranslationProgress((progress) => {
        floatingBallInstance?.setTranslationState(progress.active);
      });
    }

    return floatingBallInstance;
  }).catch((error: unknown) => {
    console.error('[FluentRead] 悬浮球挂载失败', error);
    return null;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * 通过隔离的 Vue 实例切换翻译，不使用 DOM CustomEvent。宿主页与内容脚本共享 DOM
 * 事件面，不能让页面脚本借此调用扩展动作。
 */
export function toggleFloatingBallTranslation(): boolean {
  if (!floatingBallInstance?.toggleTranslation) return false;
  floatingBallInstance.toggleTranslation();
  return true;
}

/**
 * 卸载悬浮球
 */
export function unmountFloatingBall() {
  // 先使仍在等待的挂载失效，再释放当前实例，避免迟到的 Promise 重新写回句柄。
  mountRequestId++;
  unsubscribeFullPageTranslationProgress?.();
  unsubscribeFullPageTranslationProgress = null;
  if (floatingBallUi || floatingBallInstance) {
    if (isFullPageTranslationActive()) {
      restoreOriginalContent();
    }
    floatingBallUi?.remove();
    floatingBallUi = null;
    floatingBallInstance = null;
  }
}
