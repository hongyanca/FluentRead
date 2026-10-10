/**
 * @file src/platform/browser/actionIcon.ts
 * 文件职责：为 Chromium 工具栏图标写入提供可捕获原生回调错误的 Promise 边界。
 * 主要内容：仅在 Chrome/Edge 扩展目标中使用原生 action.setIcon 回调，在回调有效期内读取 runtime.lastError 并拒绝 Promise；其余环境保持传入 API 的调用方式。
 * 模块边界：只适配带标签页和图片路径的图标写入，不处理角标、业务状态、页面消息或错误日志；Firefox、userscript 与无原生扩展 API 的测试替身继续使用已有 Promise 接口。
 */

export interface ActionIconDetails {
    tabId: number;
    path: Record<number, string>;
}

export interface ActionIconApi {
    setIcon(details: ActionIconDetails): Promise<void> | void;
}

interface NativeChromeIconApi {
    runtime?: {id?: string; readonly lastError?: {message?: string}};
    action?: {setIcon?: (details: ActionIconDetails, callback: () => void) => void};
}

export async function setActionIcon(action: ActionIconApi, details: ActionIconDetails): Promise<void> {
    const nativeChrome = (globalThis as {chrome?: NativeChromeIconApi}).chrome;
    const nativeRuntime = nativeChrome?.runtime;
    const nativeAction = nativeChrome?.action;
    const setNativeIcon = nativeAction?.setIcon;
    if ((import.meta.env.BROWSER === 'chrome' || import.meta.env.BROWSER === 'edge')
        && nativeRuntime?.id && typeof setNativeIcon === 'function') {
        // 部分 Chromium setIcon 的 Promise 已完成仍遗留回调错误，必须在原生回调内读取。
        // 官方契约：https://developer.chrome.com/docs/extensions/reference/api/runtime#property-lastError
        await new Promise<void>((resolve, reject) => {
            setNativeIcon.call(nativeAction, details, () => {
                const error = nativeRuntime.lastError;
                if (error) reject(new Error(error.message ?? 'Failed to set action icon'));
                else resolve();
            });
        });
        return;
    }
    await action.setIcon(details);
}
