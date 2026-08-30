/**
 * @file src/features/image-translation/background/offscreenAdapter.ts
 * 文件职责：把图片识别、整图翻译和 OCR 语言包下载请求适配为平台 Offscreen 消息，并校验隔离文档返回的结构后交还后台 handlers。
 * 主要内容：包含 OffscreenResponse 解析、识别 lines 数组验证、译图 image/lines 结果收窄，以及 createImageTranslationOffscreenAdapter 和默认 chromeOffscreenClient 实例。
 * 模块边界：适配器不创建 Offscreen document、不执行 OCR/绘制，也不读取配置；文档生命周期属于 platform/offscreen，实际运算在 services/offscreenRuntime 与 ocrRuntime 中完成。
 */
import type {OcrLine} from '@/src/features/image-translation/core';
import type {ImageOcrLanguageCode} from '@/src/features/image-translation/ocrLanguages';
import type {OffscreenImageTranslationResult} from '@/src/features/image-translation/services/offscreenRuntime';
import {
    chromeOffscreenClient,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';

interface OffscreenResponse {
    readonly success?: boolean;
    readonly error?: string;
    readonly image?: unknown;
    readonly lines?: unknown;
}

function errorMessage(response: OffscreenResponse | undefined, fallback: string): string {
    return typeof response?.error === 'string' && response.error ? response.error : fallback;
}

function parseTranslationResult(
    response: OffscreenResponse | undefined,
    fallback: string,
): OffscreenImageTranslationResult {
    if (!response?.success || typeof response.image !== 'string' || !Array.isArray(response.lines)) {
        throw new Error(errorMessage(response, fallback));
    }
    return {image: response.image, lines: response.lines as OffscreenImageTranslationResult['lines']};
}

/** 图片 feature 对平台 Offscreen client 的唯一适配器。 */
export function createImageTranslationOffscreenAdapter(client: OffscreenClient = chromeOffscreenClient) {
    return {
        async recognizeImage(image: string, sourceLanguage: string): Promise<OcrLine[]> {
            const response = await client.send<OffscreenResponse>({
                type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN',
                image,
                sourceLanguage,
            });
            if (!response?.success || !Array.isArray(response.lines)) {
                throw new Error(errorMessage(response, '图片 OCR 失败'));
            }
            return response.lines as OcrLine[];
        },

        async translateImage(
            image: string,
            sourceLanguage: string,
            title: string,
        ): Promise<OffscreenImageTranslationResult> {
            const response = await client.send<OffscreenResponse>({
                type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN',
                image,
                sourceLanguage,
                title,
            });
            return parseTranslationResult(response, '图片翻译失败');
        },

        async downloadLanguages(languages: ImageOcrLanguageCode[]): Promise<void> {
            const response = await client.send<OffscreenResponse>({
                type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN',
                languages,
            });
            if (!response?.success) throw new Error(errorMessage(response, '图片 OCR 语言包下载失败'));
        },
    };
}

export const imageTranslationOffscreenAdapter = createImageTranslationOffscreenAdapter();
