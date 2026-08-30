/**
 * @file src/app/background/runtime.ts
 * 文件职责：作为扩展后台应用的顶层启动函数，按唯一顺序组装标签页状态、右键菜单、消息监听和后台维护任务。
 * 主要内容：创建共享 TabTranslationStateStore，安装 context menu runtime 和 message runtime，最后注册配置自动备份与翻译缓存清理任务。
 * 模块边界：本文件只负责后台生命周期启动，不实现消息分派、菜单规则、配置历史或缓存算法；WXT entrypoint 仅调用 startBackgroundApp，各子系统由相邻模块实现。
 */
import {installBackgroundMaintenance} from './maintenanceRuntime';
import {installBackgroundContextMenus} from './contextMenuRuntime';
import {installBackgroundMessageRuntime} from './messageRuntime';
import {TabTranslationStateStore} from './tabTranslationState';

// MV3 后台休眠后会重新从 content script 读取真值；这里只保存当前 worker 的瞬时缓存。
const tabTranslationStates = new TabTranslationStateStore();

/** 启动一次 MV2 background page 或 MV3 service worker 实例。 */
export function startBackgroundApp(): void {
    // 步骤 1：先建立菜单与 tab 生命周期，保证消息上报可以立即刷新展示。
    const contextMenus = installBackgroundContextMenus(tabTranslationStates);
    // 步骤 2：注册单一消息入口，把 provider 与 feature handlers 静态组装起来。
    installBackgroundMessageRuntime({
        tabTranslationStates,
        onFullPageStateChanged: (tabId) => {
            if (contextMenus.isSupported) void contextMenus.update(tabId);
        },
    });
    // 步骤 3：最后注册独立的配置备份与缓存维护任务，不阻塞 worker 启动。
    installBackgroundMaintenance();
}
