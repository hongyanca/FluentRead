/**
 * @file src/features/input-translation/background/handler.ts
 * 文件职责：定义输入框快捷翻译的后台消息处理器，在调用固定翻译依赖前校验原文和目标语言，并统一返回成功译文结构。
 * 主要内容：包含 inputBoxTranslation 消息常量、请求/响应与依赖接口、非空字符串解析，以及 createInputBoxTranslationHandler 工厂对 translateText 的薄编排。
 * 模块边界：此文件不监听键盘、不修改输入框也不绑定具体 provider；content feature 负责触发和提交，翻译实现由 background composition root 注入，统一路由负责错误响应。
 */
export const INPUT_BOX_TRANSLATION_MESSAGE_TYPE = 'inputBoxTranslation' as const;

export interface InputBoxTranslationMessage {
    type: typeof INPUT_BOX_TRANSLATION_MESSAGE_TYPE;
    text?: unknown;
    targetLang?: unknown;
}

export interface InputBoxTranslationResponse {
    success: true;
    translatedText: string;
}

export interface InputBoxTranslationDependencies {
    readonly translateText: (text: string, targetLanguage: string) => Promise<string>;
}

export interface InputBoxTranslationHandler {
    readonly type: typeof INPUT_BOX_TRANSLATION_MESSAGE_TYPE;
    handle(message: InputBoxTranslationMessage): Promise<InputBoxTranslationResponse>;
}

function parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new TypeError(`输入框翻译 ${field} 必须是字符串`);
    if (!value.trim()) throw new TypeError(`输入框翻译 ${field} 不能为空`);
    return value;
}

/** 创建输入框翻译 handler；微软 provider 由后台 composition root 注入。 */
export function createInputBoxTranslationHandler(
    dependencies: InputBoxTranslationDependencies,
): InputBoxTranslationHandler {
    return {
        type: INPUT_BOX_TRANSLATION_MESSAGE_TYPE,
        async handle(message) {
            // 步骤 1：页面消息先经过严格协议收窄，避免 undefined 进入微软翻译。
            const text = parseRequiredString(message.text, 'text');
            const targetLanguage = parseRequiredString(message.targetLang, 'targetLang');

            // 步骤 2：provider 返回值同样属于不可信边界，必须是非空字符串。
            const translatedText = await dependencies.translateText(text, targetLanguage);
            if (typeof translatedText !== 'string' || !translatedText.trim()) {
                throw new Error('微软翻译未返回译文');
            }
            return {success: true, translatedText};
        },
    };
}
