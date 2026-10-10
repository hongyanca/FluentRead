/**
 * @file src/app/background/thunderbirdMessageRuntime.ts
 * 文件职责：在 Thunderbird 中把现有全文翻译内容脚本接入邮件阅读窗口。
 * 主要内容：注册邮件显示脚本，并将邮件工具栏按钮映射为翻译或恢复；网页浏览器没有这些 MailExtension API 时不安装任何监听器。
 * 模块边界：只适配 Thunderbird API 和现有 content 消息协议，不读取邮件原文、不发起翻译请求，也不改变浏览器版 manifest。
 */

export const THUNDERBIRD_MESSAGE_CONTENT_SCRIPT = 'content-scripts/content.js';

interface MessageDisplayScriptRegistration {
    register(options: {
        js: Array<{file: string}>;
        runAt: 'document_start';
    }): Promise<unknown>;
}

interface MessageDisplayAction {
    onClicked: {addListener(listener: (tab: {id?: number}) => void): void};
}

interface MailTabs {
    sendMessage(tabId: number, message: {type: string; action?: 'fullPage' | 'restore'}): Promise<unknown>;
}

export interface ThunderbirdMessageApi {
    messageDisplayScripts?: MessageDisplayScriptRegistration;
    messageDisplayAction?: MessageDisplayAction;
    tabs: MailTabs;
}

interface TranslationStateReply {
    status?: string;
    isTranslated?: boolean;
}

/** 邮件正文脚本与按钮使用同一份 FluentRead 消息协议，浏览器版无额外副作用。 */
export function installThunderbirdMessageRuntime(
    api: ThunderbirdMessageApi,
    warn: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): boolean {
    if (!api.messageDisplayScripts || !api.messageDisplayAction) return false;

    void api.messageDisplayScripts.register({
        js: [{file: THUNDERBIRD_MESSAGE_CONTENT_SCRIPT}],
        runAt: 'document_start',
    }).catch((error) => warn('[FluentRead] 注册 Thunderbird 邮件阅读脚本失败', error));

    api.messageDisplayAction.onClicked.addListener((tab) => {
        if (!Number.isInteger(tab.id) || (tab.id ?? -1) < 0) return;
        const tabId = tab.id!;
        void (async () => {
            const state = await api.tabs.sendMessage(tabId, {type: 'getFullPageTranslationState'}) as TranslationStateReply | undefined;
            if (state?.status !== 'success') return;
            await api.tabs.sendMessage(tabId, {
                type: 'contextMenuTranslate',
                action: state.isTranslated ? 'restore' : 'fullPage',
            });
        })().catch((error) => warn('[FluentRead] Thunderbird 邮件翻译操作失败', error));
    });
    return true;
}
