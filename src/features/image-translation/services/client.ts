/**
 * @file src/features/image-translation/services/client.ts
 * 文件职责：封装网页与扩展页面调用图片翻译后台的 runtime 消息，统一支持 OCR 识别、整图翻译和跨域图片抓取三种客户端操作。
 * 主要内容：提供 recognizeImageInExtension、translateImageInExtension、fetchImageInExtension，构造对应消息并验证 success、lines、image 与 dataUrl 后返回强类型结果。
 * 模块边界：客户端不读取图片像素、不管理 UI 状态也不访问 tabs/offscreen；权限操作和输入校验由 background handlers 完成，调用超时与用户反馈由 content/runtime 决定。
 */
import type { OcrLine } from '@/src/features/image-translation/core';

interface ImageTranslationLine extends OcrLine {
    backgroundColor: string;
}

interface ImageTranslationResponse {
    success: boolean;
    image?: string;
    lines?: ImageTranslationLine[];
    error?: string;
}

interface ImageOcrResponse {
    success: boolean;
    lines?: OcrLine[];
    error?: string;
}

interface ImageFetchResponse {
    success: boolean;
    image?: string;
    error?: string;
}

export async function recognizeImageInExtension(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageOcr',
        image,
        sourceLanguage,
    }) as ImageOcrResponse | undefined;

    if (!response?.success) {
        throw new Error(response?.error || '图片 OCR 服务不可用');
    }

    return response.lines || [];
}

export async function translateImageInExtension(
    image: string,
    sourceLanguage: string,
    title: string,
): Promise<{ image: string; lines: ImageTranslationLine[] }> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageTranslate',
        image,
        sourceLanguage,
        title,
    }) as ImageTranslationResponse | undefined;

    if (!response?.success || !response.image || !Array.isArray(response.lines)) {
        throw new Error(response?.error || '图片翻译服务不可用');
    }

    return { image: response.image, lines: response.lines };
}

export async function fetchImageInExtension(imageUrl: string): Promise<string> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageFetch',
        url: imageUrl,
    }) as ImageFetchResponse | undefined;

    if (!response?.success || !response.image) {
        throw new Error(response?.error || '无法读取远程图片');
    }

    return response.image;
}
