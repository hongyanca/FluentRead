/**
 * @file src/core/translation/languages.ts
 *
 * 文件职责：解析请求级语言覆盖与配置默认值，生成一次翻译请求实际使用的源语言和目标语言。
 * 主要内容：定义 TranslationLanguageOverride、TranslationLanguageDefaults、TranslationLanguages，并由 resolveTranslationLanguages 清洗空值、应用回退和保留明确的 auto 选择。 可核对的公开符号包括 TranslationLanguageOverride、TranslationLanguageDefaults、TranslationLanguages、resolveTranslationLanguages。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

export interface TranslationLanguageOverride {
    sourceLanguage?: string;
    targetLanguage?: string;
}

export interface TranslationLanguageDefaults {
    sourceLanguage: string;
    targetLanguage: string;
}

export interface TranslationLanguages {
    sourceLanguage: string;
    targetLanguage: string;
}

function readLanguage(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * 解析一次请求实际使用的语言对，不读取也不修改全局配置。
 *
 * 步骤 1：请求级覆盖先经过空白清理。
 * 步骤 2：缺失或空白值回退到调用方提供的配置快照。
 */
export function resolveTranslationLanguages(
    message: TranslationLanguageOverride | null | undefined,
    defaults: TranslationLanguageDefaults,
): TranslationLanguages {
    return {
        sourceLanguage: readLanguage(message?.sourceLanguage, defaults.sourceLanguage),
        targetLanguage: readLanguage(message?.targetLanguage, defaults.targetLanguage),
    };
}
