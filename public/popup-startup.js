/**
 * @file public/popup-startup.js
 * 文件职责：在 Popup HTML 解析阶段唤醒后台，使后台初始化与界面模块加载并行。
 * 主要内容：只请求引导状态提示，兼容 Firefox Promise 与 Chromium callback API，吞掉预唤醒故障。
 * 模块边界：无框架依赖、不读写配置、不挂载界面；提示仅供模块预取，实际渲染等待配置 store 的新快照。
 */
(() => {
    const globals = globalThis;
    const message = {type: 'popupStartup'};
    try {
        if (globals.browser?.runtime) {
            globals.__fluentReadPopupWarmup = Promise.resolve(globals.browser.runtime.sendMessage(message))
                .catch(() => undefined);
        } else if (globals.chrome?.runtime) {
            const runtime = globals.chrome.runtime;
            globals.__fluentReadPopupWarmup = new Promise(resolve => {
                runtime.sendMessage(message, response => resolve(runtime.lastError ? undefined : response));
            }).catch(() => undefined);
        }
    } catch {
        // 正常配置读取负责失败回退，预唤醒不能阻断 HTML 或模块加载。
    }
})();
