/**
 * @file src/features/reading-assistant/sessionHandler.ts
 * 文件职责：校验最近三十天阅读会话的查询和删除消息，将历史访问限制在扩展界面和获准的内容脚本。
 * 主要内容：验证发送者、隐私窗口、会话标识及分页，路由列表、详情、单条删除和清空操作。
 * 模块边界：只调用注入的会话仓库，不接触网页 DOM、模型请求或浏览器 API，也不允许客户端任意写入历史。
 */
import type {HarnessSessionStore} from '@/src/services/harness/sessionTypes';
import type {ReadingSender} from './background';

interface SessionHandlerDependencies {
    store: HarnessSessionStore;
    extensionId: string;
    optionsUrl: string;
    ready: Promise<unknown>;
    eligibility(sender: ReadingSender): string | undefined;
    privateContext(): boolean;
}
const ERROR = {success: false, error: '无法访问阅读会话'} as const;
export function createReadingSessionHandler(deps: SessionHandlerDependencies) {
    return async (message: unknown, sender: ReadingSender) => {
        if (sender.id !== deps.extensionId || deps.privateContext() || sender.tab?.incognito
            || !message || typeof message !== 'object' || !('action' in message)) return ERROR;
        const optionsPage = sender.url?.split(/[?#]/u)[0] === deps.optionsUrl;
        if (!optionsPage && (!Number.isSafeInteger(sender.tab?.id) || sender.tab!.id! < 0)) return ERROR;
        try {
            await deps.ready;
            if (!optionsPage && deps.eligibility(sender)) return ERROR;
            switch (message.action) {
                case 'sessions-list': {
                    const offset = 'offset' in message ? message.offset : 0;
                    if (!Number.isSafeInteger(offset) || (offset as number) < 0) return ERROR;
                    return {success: true, ...await deps.store.list(offset as number, 30)};
                }
                case 'sessions-get':
                case 'sessions-delete': {
                    if (!('sessionId' in message) || typeof message.sessionId !== 'string' || !/^[\w.:-]{1,128}$/u.test(message.sessionId)) return ERROR;
                    if (message.action === 'sessions-get') return {success: true, session: await deps.store.get(message.sessionId)};
                    await deps.store.delete(message.sessionId);
                    return {success: true};
                }
                case 'sessions-clear': await deps.store.clear(); return {success: true};
                default: return ERROR;
            }
        } catch { return {success: false, error: '会话操作未完成，请稍后重试'}; }
    };
}
