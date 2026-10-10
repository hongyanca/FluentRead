/**
 * @file src/ui/view-model/aiContext.ts
 * 文件职责：把 AI 智能上下文的保存偏好、服务能力和页面可用性转换为弹窗状态，避免将开关开启误写为当前译文已增强。
 * 主要内容：定义状态输入与展示结果，按暂停、浏览器限制、服务支持和配置缺失说明当前限制，并独立判断偏好开关是否可操作。
 * 模块边界：本文件只返回界面状态与国际化键，不读取浏览器、不保存配置、不检测网络连接，也不启动或重新执行翻译。
 */

export interface AIContextPresentationInput {
    enabled: boolean;
    supported: boolean;
    pluginEnabled: boolean;
    siteDisabled: boolean;
    unavailable: boolean;
    missingCredentials: boolean;
    translating: boolean;
}

export type AIContextPresentationState = 'off' | 'ready' | 'needs-setup' | 'unsupported' | 'unavailable' | 'paused';

export interface AIContextPresentation {
    state: AIContextPresentationState;
    descriptionKey: string;
    toggleDisabled: boolean;
}

/** 开启只代表保存的偏好；不支持或尚缺凭据时也允许提前保存，供后续新翻译使用。 */
export function resolveAIContextPresentation(input: AIContextPresentationInput): AIContextPresentation {
    let state: AIContextPresentationState;
    let description: string;

    if (!input.pluginEnabled) {
        state = 'paused';
        description = 'paused';
    } else if (input.siteDisabled) {
        state = 'paused';
        description = 'sitePaused';
    } else if (input.unavailable) {
        state = 'unavailable';
        description = 'unavailable';
    } else if (!input.supported) {
        state = 'unsupported';
        description = 'unsupported';
    } else if (input.missingCredentials) {
        state = 'needs-setup';
        description = 'needsSetup';
    } else {
        state = input.enabled ? 'ready' : 'off';
        description = state;
    }

    return {
        state,
        descriptionKey: `popup.aiContext.description.${input.translating ? 'translating' : description}`,
        toggleDisabled: !input.pluginEnabled || input.siteDisabled || input.translating,
    };
}
