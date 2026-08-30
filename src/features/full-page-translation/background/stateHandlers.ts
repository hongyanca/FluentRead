/**
 * @file src/features/full-page-translation/background/stateHandlers.ts
 * 文件职责：定义全文翻译状态与站点扩展禁用状态的后台消息处理器，使 popup 和 content 可以按发送标签页安全地读写对应布尔状态。
 * 主要内容：包含两种消息协议、tabId 提取、布尔字段严格解析、状态存储依赖接口，以及通过工厂创建 fullPageTranslationState 和 siteExtensionDisabledState handlers。
 * 模块边界：该模块不直接依赖 browser.tabs 或具体 Map；composition root 注入状态仓库，调用上下文必须来自消息路由，全文 DOM 会话和配置规则分别留在 content/runtime 与 site-rules。
 */
export const FULL_PAGE_TRANSLATION_STATE_MESSAGE_TYPE = 'fullPageTranslationState' as const;
export const SITE_EXTENSION_DISABLED_STATE_MESSAGE_TYPE = 'siteExtensionDisabledState' as const;

export interface FullPageBackgroundContext {
    sender?: {
        tab?: {
            id?: number;
        };
    };
}

export interface FullPageTranslationStateMessage {
    type: typeof FULL_PAGE_TRANSLATION_STATE_MESSAGE_TYPE;
    isTranslated?: unknown;
}

export interface SiteExtensionDisabledStateMessage {
    type: typeof SITE_EXTENSION_DISABLED_STATE_MESSAGE_TYPE;
    isDisabled?: unknown;
}

export type FullPageTranslationStateRuntimeMessage =
    | FullPageTranslationStateMessage
    | SiteExtensionDisabledStateMessage;

export interface FullPageTranslationStateStore {
    setTranslated(tabId: number, translated: boolean): unknown;
    setSiteDisabled(tabId: number, disabled: boolean): unknown;
}

export interface FullPageTranslationStateDependencies {
    readonly stateStore: FullPageTranslationStateStore;
    readonly isTabId: (value: unknown) => value is number;
    readonly onStateChanged: (tabId: number) => void;
}

export interface FullPageTranslationStateHandler<TMessage extends FullPageTranslationStateRuntimeMessage> {
    readonly type: TMessage['type'];
    handle(message: TMessage, context: FullPageBackgroundContext): {success: true};
}

function parseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`全文翻译状态 ${field} 必须是布尔值`);
    return value;
}

function senderTabId(
    context: FullPageBackgroundContext,
    isTabId: (value: unknown) => value is number,
): number | null {
    const tabId = context.sender?.tab?.id;
    return isTabId(tabId) ? tabId : null;
}

/** 创建全文翻译/站点禁用状态 handler；MV3 瞬时状态存储由 app 层注入。 */
export function createFullPageTranslationStateHandlers(
    dependencies: FullPageTranslationStateDependencies,
): [
    FullPageTranslationStateHandler<FullPageTranslationStateMessage>,
    FullPageTranslationStateHandler<SiteExtensionDisabledStateMessage>,
] {
    return [
        {
            type: FULL_PAGE_TRANSLATION_STATE_MESSAGE_TYPE,
            handle(message, context) {
                const isTranslated = parseBoolean(message.isTranslated, 'isTranslated');
                const tabId = senderTabId(context, dependencies.isTabId);
                if (tabId !== null) {
                    dependencies.stateStore.setTranslated(tabId, isTranslated);
                    dependencies.onStateChanged(tabId);
                }
                return {success: true};
            },
        },
        {
            type: SITE_EXTENSION_DISABLED_STATE_MESSAGE_TYPE,
            handle(message, context) {
                const isDisabled = parseBoolean(message.isDisabled, 'isDisabled');
                const tabId = senderTabId(context, dependencies.isTabId);
                if (tabId !== null) {
                    dependencies.stateStore.setSiteDisabled(tabId, isDisabled);
                    dependencies.onStateChanged(tabId);
                }
                return {success: true};
            },
        },
    ];
}
