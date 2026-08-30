import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {installShadowAndRouteBridge} from '@/src/platform/shadow-ui/pageBridge';
import browser, {resetPlatformMessageHandler, setPlatformMessageHandler} from './browser';
import {createUserscriptContentContext} from './context';
import {userscriptFetch} from './http';
import {ensureUserscriptConfig} from './initialize';
import {getUserscriptConfigCount} from './count';

declare global {
    // 脚本管理器可能在 SPA 状态变化时重新注入，因此在当前沙箱中保存幂等启动标记。
    var __fluentReadUserscriptBootstrapped: boolean | undefined;
}

let disposeShadowAndRouteBridge: (() => void) | undefined;
let disposeUserscriptRuntime: (() => void) | undefined;

async function waitForDocumentEnd(): Promise<void> {
    if (document.readyState !== 'loading') return;
    await new Promise<void>((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), {once: true}));
}

function registerMenu(label: string, listener: () => void): void {
    const register = globalThis.GM_registerMenuCommand;
    if (typeof register === 'function') register(label, listener);
}

/**
 * 先安装页面路由桥和 GM 网络适配器，再归一化配置，最后动态加载共享内容应用。
 * 这个顺序可防止共享模块在 userscript 能力边界建立前读取扩展专属配置或使用原生 fetch。
 */
async function bootstrap(): Promise<void> {
    if (globalThis.__fluentReadUserscriptBootstrapped) return;
    globalThis.__fluentReadUserscriptBootstrapped = true;

    disposeShadowAndRouteBridge = installShadowAndRouteBridge();
    setRuntimeFetch(userscriptFetch);
    await ensureUserscriptConfig();

    // 配置边界就绪后再加载这些模块，避免模块级初始化观察到尚未迁移的旧配置。
    const [platformModule, settingsModule, contentModule, translationModule, configModule] = await Promise.all([
        import('./platform'),
        import('./settings'),
        import('@/entrypoints/content'),
        import('@/src/app/content/features'),
        import('@/src/services/config/store'),
    ]);
    const ctx = createUserscriptContentContext();
    const synchronizeCountProjection = async () => {
        const count = await getUserscriptConfigCount();
        if (configModule.config.count === count) return;
        configModule.config.count = count;
        await configModule.saveConfig(configModule.config);
    };
    const openSettings = () => {
        void synchronizeCountProjection()
            .catch((error) => console.error('[FluentRead userscript] 同步翻译计数失败', error))
            .finally(() => settingsModule.openUserscriptSettings(ctx));
    };
    const closeSettings = () => settingsModule.closeUserscriptSettings();
    const synchronizeVisibleCount = () => {
        if (document.visibilityState === 'visible') {
            void synchronizeCountProjection().catch((error) => {
                console.error('[FluentRead userscript] 同步翻译计数失败', error);
            });
        }
    };
    const toggleTranslationListener = (
        message: any,
        _sender: unknown,
        sendResponse: (response?: unknown) => void,
    ) => {
        if (message?.type !== 'userscriptTogglePageTranslation') return false;
        if (translationModule.isFullPageTranslationActive()) translationModule.restoreOriginalContent();
        else void translationModule.autoTranslateEnglishPage();
        sendResponse({success: true});
        return true;
    };
    let runtimeDisposed = false;
    const disposeRuntime = () => {
        if (runtimeDisposed) return;
        runtimeDisposed = true;
        window.removeEventListener('fluentread-userscript-open-settings', openSettings);
        window.removeEventListener('fluentread-userscript-close-settings', closeSettings);
        window.removeEventListener('focus', synchronizeVisibleCount);
        document.removeEventListener('visibilitychange', synchronizeVisibleCount);
        browser.runtime.onMessage.removeListener(toggleTranslationListener);
        resetPlatformMessageHandler();
        try {
            closeSettings();
        } catch (error) {
            console.error('[FluentRead userscript] 关闭设置面板失败', error);
        }
        ctx.invalidate();
    };
    disposeUserscriptRuntime = disposeRuntime;
    setPlatformMessageHandler(platformModule.createPlatformMessageHandler(openSettings));
    window.addEventListener('fluentread-userscript-open-settings', openSettings);
    window.addEventListener('fluentread-userscript-close-settings', closeSettings);
    window.addEventListener('focus', synchronizeVisibleCount);
    document.addEventListener('visibilitychange', synchronizeVisibleCount);

    browser.runtime.onMessage.addListener(toggleTranslationListener);

    registerMenu('流畅阅读：打开设置', openSettings);
    registerMenu('流畅阅读：翻译 / 恢复当前网页', () => {
        if (translationModule.isFullPageTranslationActive()) translationModule.restoreOriginalContent();
        else void translationModule.autoTranslateEnglishPage();
    });
    registerMenu('流畅阅读：启用 / 暂停', () => {
        const enabled = !configModule.config.on;
        configModule.config.on = enabled;
        void configModule.saveConfig().then(async () => {
            await browser.tabs.sendMessage(1, {
                type: 'toggleFloatingBall',
                isEnabled: enabled && !configModule.config.disableFloatingBall,
            });
            await browser.tabs.sendMessage(1, {
                type: 'updateSelectionTranslatorMode',
                mode: enabled ? configModule.config.selectionTranslatorMode : 'disabled',
            });
            if (!enabled) translationModule.restoreOriginalContent();
        });
    });
    registerMenu('流畅阅读：清空翻译缓存', () => {
        void browser.runtime.sendMessage({type: 'clearTranslationCache'});
    });

    await waitForDocumentEnd();
    await contentModule.default.main(ctx as never);
    void browser.runtime.sendMessage({type: 'userscriptCacheMaintenance'}).catch(() => undefined);

    // 单页 userscript 没有扩展 content-script 的自动销毁钩子，离页时显式释放监听器和 Shadow UI。
    window.addEventListener('beforeunload', () => {
        disposeRuntime();
        disposeUserscriptRuntime = undefined;
        disposeShadowAndRouteBridge?.();
        disposeShadowAndRouteBridge = undefined;
    }, {once: true});
}

void bootstrap().catch((error) => {
    disposeUserscriptRuntime?.();
    disposeUserscriptRuntime = undefined;
    disposeShadowAndRouteBridge?.();
    disposeShadowAndRouteBridge = undefined;
    globalThis.__fluentReadUserscriptBootstrapped = false;
    console.error('[FluentRead userscript] 初始化失败', error);
});
