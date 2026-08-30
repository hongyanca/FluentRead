/**
 * @file src/platform/shadow-ui/pageBridge.ts
 *
 * 文件职责：在页面 MAIN world 安装 Shadow DOM 与路由变更 bridge，并返回可精确卸载的生命周期函数。
 * 主要内容：组合 pageBridgeCore 的环境适配，补丁 attachShadow 与 history 方法，转发开放 ShadowRoot 和 SPA 导航事件，同时保证重复安装及 dispose 可恢复宿主 API。 可核对的公开符号包括 installShadowAndRouteBridge。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

import {
    installShadowRouteBridgeLifecycleCore,
    type AttachShadowPort,
    type BridgeEventTarget,
    type HistoryMutationPort,
} from './pageBridgeCore';

/** 把真实页面的 DOM/History API 注入可测试的 MAIN world bridge。 */
export function installShadowAndRouteBridge(): () => void {
    const pageWindow = window as typeof window & Record<string, unknown>;
    const navigation = (pageWindow as typeof window & {navigation?: EventTarget}).navigation;
    return installShadowRouteBridgeLifecycleCore({
        stateHost: pageWindow,
        attachShadow: {
            get: () => Element.prototype.attachShadow as unknown as AttachShadowPort,
            set: (value) => { Element.prototype.attachShadow = value as typeof Element.prototype.attachShadow; },
        },
        pushState: {
            get: () => history.pushState as unknown as HistoryMutationPort,
            set: (value) => { history.pushState = value as History['pushState']; },
        },
        replaceState: {
            get: () => history.replaceState as unknown as HistoryMutationPort,
            set: (value) => { history.replaceState = value as History['replaceState']; },
        },
        windowEvents: window as unknown as BridgeEventTarget,
        documentEvents: document as unknown as BridgeEventTarget,
        navigationEvents: navigation as unknown as BridgeEventTarget | undefined,
        getHref: () => location.href,
        createEvent: (type, init) => new CustomEvent(type, init),
    });
}
