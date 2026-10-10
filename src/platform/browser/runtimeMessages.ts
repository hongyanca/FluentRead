/**
 * @file src/platform/browser/runtimeMessages.ts
 * 文件职责：封装扩展消息的注册和发送边界，避免 runtime 撤销中断页面资源清理。
 * 主要内容：注册时捕获原始 onMessage 事件并提供幂等、安全注销；异步发送将同步失效异常转为 Promise 拒绝。
 * 模块边界：只管理浏览器消息 API 的生命周期，不包装监听函数、不改变消息响应协议或决定业务重试策略。
 */
import browser from 'webextension-polyfill';

interface RuntimeMessageEvent<Listener> {
    addListener(listener: Listener): void;
    removeListener(listener: Listener): void;
}

/** 注销只使用注册时的事件对象；扩展更新后不能重新读取已撤销的 runtime。 */
export function addRuntimeMessageListener<Listener extends (...args: any[]) => any>(
    runtime: {onMessage?: RuntimeMessageEvent<Listener>} | null | undefined,
    listener: Listener,
): () => void {
    const event = runtime?.onMessage;
    if (!event) return () => undefined;
    event.addListener(listener);
    let subscribed = true;
    return () => {
        if (!subscribed) return;
        subscribed = false;
        try { event.removeListener(listener); }
        catch { /* 扩展上下文失效时，仍允许调用方继续清理 DOM、计时器和订阅。 */ }
    };
}

/** API 读取和调用都在 async 内，同步的上下文失效也能由调用方的 catch 处理。 */
export async function sendRuntimeMessage(message: unknown): Promise<any> {
    return browser.runtime.sendMessage(message);
}
