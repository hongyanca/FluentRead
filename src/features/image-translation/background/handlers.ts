/**
 * @file src/features/image-translation/background/handlers.ts
 * 文件职责：定义图片 OCR、整图翻译、文本批译、语言包下载和远程图片获取五类后台消息，并对来自页面或扩展 UI 的未知输入执行严格校验。
 * 主要内容：包含消息常量与联合类型、data:image 和字符串数组解析、OCR 语言白名单、对象结果断言，以及通过依赖注入创建各操作 handler 的 createImageTranslationBackgroundHandlers。
 * 模块边界：本文件只负责协议入口与用例编排，不直接运行 Tesseract、Canvas、网络 fetch 或 Offscreen；这些能力分别由 repository、remote fetcher、adapter 与 services 实现并由 app 注入。
 */
import {
    IMAGE_OCR_LANGUAGE_PACKS,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from '@/src/features/image-translation/ocrLanguages';
import {markTranslationRemainingBudget} from '@/src/services/translation/requestSnapshot';

export const IMAGE_OCR_MESSAGE_TYPE = 'fluentReadImageOcr' as const;
export const IMAGE_TRANSLATE_MESSAGE_TYPE = 'fluentReadImageTranslate' as const;
export const IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE = 'fluentReadImageTranslateTexts' as const;
export const IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE = 'fluentReadImageOcrDownload' as const;
export const IMAGE_FETCH_MESSAGE_TYPE = 'fluentReadImageFetch' as const;

export interface ImageOcrMessage {
    type: typeof IMAGE_OCR_MESSAGE_TYPE;
    image?: unknown;
    sourceLanguage?: unknown;
}

export interface ImageTranslateMessage {
    type: typeof IMAGE_TRANSLATE_MESSAGE_TYPE;
    image?: unknown;
    sourceLanguage?: unknown;
    title?: unknown;
}

export interface ImageTranslateTextsMessage {
    type: typeof IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE;
    texts?: unknown;
    title?: unknown;
}

export interface ImageOcrDownloadMessage {
    type: typeof IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE;
    languages?: unknown;
}

export interface ImageFetchMessage {
    type: typeof IMAGE_FETCH_MESSAGE_TYPE;
    url?: unknown;
}

export type ImageTranslationBackgroundMessage =
    | ImageOcrMessage
    | ImageTranslateMessage
    | ImageTranslateTextsMessage
    | ImageOcrDownloadMessage
    | ImageFetchMessage;

type ImageTextTranslationRequestBase = {
    context: string;
    pageContext: '';
    useCache: true;
    serviceOverride: string;
    requestTimeoutMs: number;
};

type ImageTextTranslationRequest = ImageTextTranslationRequestBase & (
    | {origin: string}
    | {origin: string[]}
);

export interface ImageTranslationBackgroundDependencies {
    readonly assertLanguagesDownloaded: (sourceLanguage: string) => Promise<void>;
    readonly recognizeImage: (image: string, sourceLanguage: string) => Promise<unknown>;
    readonly translateImage: (image: string, sourceLanguage: string, title: string) => Promise<unknown>;
    readonly getTranslationService: () => string;
    readonly supportsBatchTranslation: (service: string) => boolean;
    readonly translateTexts: (request: ImageTextTranslationRequest) => Promise<string | string[]>;
    readonly downloadLanguages: (languages: ImageOcrLanguageCode[]) => Promise<void>;
    readonly markLanguagesDownloaded: (languages: ImageOcrLanguageCode[]) => Promise<ImageOcrLanguageCode[]>;
    readonly fetchImage: (url: string) => Promise<string>;
    readonly now?: () => number;
}

export interface ImageTranslationBackgroundHandler<TMessage extends ImageTranslationBackgroundMessage> {
    readonly type: TMessage['type'];
    handle(message: TMessage): Promise<unknown>;
}

const SUPPORTED_OCR_LANGUAGES = new Set(IMAGE_OCR_LANGUAGE_PACKS.map((pack) => pack.code));
export const IMAGE_TEXT_TRANSLATION_TIMEOUT_MS = 120_000;

function parseDataImage(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) {
        throw new TypeError('图片数据无效');
    }
    return value;
}

function parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`图片翻译 ${field} 必须是非空字符串`);
    }
    return value;
}

function parseOptionalTitle(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new TypeError('图片翻译 title 必须是字符串');
    return value;
}

function parseTexts(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('图片中没有可翻译文字');
    if (!value.every((text): text is string => typeof text === 'string' && text.trim().length > 0)) {
        throw new TypeError('图片翻译 texts 只能包含非空字符串');
    }
    return [...value];
}

function parseOcrLanguages(value: unknown): ImageOcrLanguageCode[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('OCR 语言包列表不能为空');
    if (!value.every((language): language is ImageOcrLanguageCode =>
        typeof language === 'string' && SUPPORTED_OCR_LANGUAGES.has(language as ImageOcrLanguageCode))) {
        throw new TypeError('OCR 语言包列表包含不支持的语言');
    }
    return normalizeImageOcrLanguageCodes(value);
}

function parseObjectResult(value: unknown, operation: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${operation}结果无效`);
    }
    return value as Record<string, unknown>;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function translateImageTexts(
    texts: string[],
    title: string,
    dependencies: ImageTranslationBackgroundDependencies,
): Promise<string[]> {
    // 步骤 1：冻结本次 OCR 事务使用的 provider，避免逐条回退期间设置变化混入另一服务。
    const service = dependencies.getTranslationService();
    const now = dependencies.now ?? (() => Date.now());
    const deadline = now() + IMAGE_TEXT_TRANSLATION_TIMEOUT_MS;
    const baseRequest = {
        context: title,
        pageContext: '' as const,
        useCache: true as const,
        serviceOverride: service,
    };
    const remainingBudget = () => {
        const remaining = Math.floor(deadline - now());
        if (remaining <= 0) throw new Error('图片文字翻译总时间已耗尽');
        return remaining;
    };

    if (dependencies.supportsBatchTranslation(service)) {
        try {
            const translations = await dependencies.translateTexts(markTranslationRemainingBudget({
                ...baseRequest,
                origin: texts,
                requestTimeoutMs: remainingBudget(),
            }));
            if (!Array.isArray(translations)
                || translations.length !== texts.length
                || !translations.every((translation) => typeof translation === 'string')) {
                throw new Error('provider 未返回等长字符串数组');
            }
            return translations;
        } catch (error) {
            throw new Error(`图片文字批量翻译失败：${getErrorMessage(error)}`);
        }
    }

    // 步骤 2：旧式单条 provider 按原 OCR 顺序串行调用，既保序也不会绕过共享并发上限。
    const translations: string[] = [];
    for (const [index, origin] of texts.entries()) {
        try {
            const translation = await dependencies.translateTexts(markTranslationRemainingBudget({
                ...baseRequest,
                origin,
                requestTimeoutMs: remainingBudget(),
            }));
            if (typeof translation !== 'string') throw new Error('provider 未返回字符串译文');
            translations.push(translation);
        } catch (error) {
            throw new Error(`图片第 ${index + 1} 段文字翻译失败：${getErrorMessage(error)}`);
        }
    }
    return translations;
}

/** 创建图片 OCR/翻译/下载/远程读取 handlers。 */
export function createImageTranslationBackgroundHandlers(
    dependencies: ImageTranslationBackgroundDependencies,
): ImageTranslationBackgroundHandler<ImageTranslationBackgroundMessage>[] {
    return [
        {
            type: IMAGE_OCR_MESSAGE_TYPE,
            async handle(message: ImageOcrMessage) {
                const image = parseDataImage(message.image);
                const sourceLanguage = parseRequiredString(message.sourceLanguage, 'sourceLanguage');
                await dependencies.assertLanguagesDownloaded(sourceLanguage);
                const lines = await dependencies.recognizeImage(image, sourceLanguage);
                if (!Array.isArray(lines)) throw new Error('图片 OCR 结果无效');
                return {success: true, lines};
            },
        },
        {
            type: IMAGE_TRANSLATE_MESSAGE_TYPE,
            async handle(message: ImageTranslateMessage) {
                const image = parseDataImage(message.image);
                const sourceLanguage = parseRequiredString(message.sourceLanguage, 'sourceLanguage');
                const title = parseOptionalTitle(message.title);
                await dependencies.assertLanguagesDownloaded(sourceLanguage);
                const result = parseObjectResult(
                    await dependencies.translateImage(image, sourceLanguage, title),
                    '图片翻译',
                );
                return {success: true, ...result};
            },
        },
        {
            type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE,
            async handle(message: ImageTranslateTextsMessage) {
                const texts = parseTexts(message.texts);
                const translations = await translateImageTexts(
                    texts,
                    parseOptionalTitle(message.title),
                    dependencies,
                );
                return {success: true, translations};
            },
        },
        {
            type: IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE,
            async handle(message: ImageOcrDownloadMessage) {
                const languages = parseOcrLanguages(message.languages);
                await dependencies.downloadLanguages(languages);
                const downloaded = await dependencies.markLanguagesDownloaded(languages);
                return {success: true, languages: downloaded};
            },
        },
        {
            type: IMAGE_FETCH_MESSAGE_TYPE,
            async handle(message: ImageFetchMessage) {
                const url = parseRequiredString(message.url, 'url');
                const image = await dependencies.fetchImage(url);
                if (typeof image !== 'string' || !image.startsWith('data:image/')) {
                    throw new Error('远程图片结果无效');
                }
                return {success: true, image};
            },
        },
    ];
}
