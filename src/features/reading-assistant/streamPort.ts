/**
 * @file src/features/reading-assistant/streamPort.ts
 * 文件职责：把一个阅读请求绑定到独立的长连接，持续发送正文进度并在连接断开时取消后台工作。
 * 主要内容：限制每个端口一个请求、转发带请求标识的进度和结果、清理监听器并阻止断开后的消息。
 * 模块边界：仅适配注入的端口和阅读 handler，不直接访问浏览器、模型、配置或持久化存储。
 */
import type {ReadingSender, createReadingAssistantHandler} from './background';
import type {ReadingStreamMessage} from './types';

interface Listener<T extends (...args: any[]) => void> {addListener(listener: T): void; removeListener(listener: T): void}
export interface ReadingStreamPort {
    name: string;
    sender?: ReadingSender;
    postMessage(message: ReadingStreamMessage): void;
    disconnect(): void;
    onMessage: Listener<(message: unknown) => void>;
    onDisconnect: Listener<() => void>;
}

export function attachReadingStreamPort(port: ReadingStreamPort, handler: Pick<ReturnType<typeof createReadingAssistantHandler>, 'handle'>): void {
    if (port.name !== 'fluentReadHarnessStream') return;
    let connected = true;
    let started = false;
    let requestId = '';
    const sender = port.sender ?? {};
    const cleanup = () => {
        port.onMessage.removeListener(receive);
        port.onDisconnect.removeListener(disconnect);
    };
    const disconnect = () => {
        connected = false;
        cleanup();
        if (requestId) void handler.handle({type: 'fluentReadHarness', action: 'cancel', requestId}, sender).catch(() => undefined);
    };
    const send = (message: ReadingStreamMessage) => {
        if (!connected) return;
        try { port.postMessage(message); } catch { disconnect(); }
    };
    const receive = (message: unknown) => {
        if (started || !connected) return;
        started = true;
        if (message && typeof message === 'object' && 'requestId' in message && typeof message.requestId === 'string') requestId = message.requestId;
        void (async () => {
            try {
                const response = await handler.handle(message, sender, progress => send({type: 'progress', requestId, progress}));
                send({type: 'result', requestId, response});
            } catch {
                send({type: 'result', requestId, response: {success: false, error: '理解连接已中断，请重试'}});
            } finally {
                connected = false;
                cleanup();
                try { port.disconnect(); } catch { /* 已断开的端口无需再次关闭。 */ }
            }
        })();
    };
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnect);
}
