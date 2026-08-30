/**
 * @file src/features/area-translation/services/client.ts
 * 文件职责：封装圈选翻译内容页到扩展后台的两段式消息调用，先获取当前可见标签页截图，再提交选区、语言和标题获得处理后的译图。
 * 主要内容：定义 AreaTranslationResult，提供 captureVisibleAreaInExtension 与 translateCapturedAreaInExtension，并严格检查 success、image 和 OCR lines 后生成面向 UI 的错误。
 * 模块边界：客户端只处理 webextension runtime 协议，不直接使用 tabs.captureVisibleTab、Offscreen 或 Canvas；消息实现归 background handlers，拖拽状态与结果展示归 AreaTranslator.vue。
 */
import browser from 'webextension-polyfill';
import type { OcrLine } from '@/src/shared/image/types';
import type { AreaTranslationSelection } from '@/src/features/area-translation/core';

export interface AreaTranslationResult {
    image: string;
    lines: Array<OcrLine & { backgroundColor: string }>;
}

interface AreaTranslationResponse extends Partial<AreaTranslationResult> {
    success: boolean;
    error?: string;
}

export async function captureVisibleAreaInExtension(): Promise<string> {
    const response = await browser.runtime.sendMessage({ type: 'fluentReadAreaCapture' }) as { success?: boolean; image?: string; error?: string } | undefined;
    if (!response?.success || !response.image) {
        throw new Error(response?.error || '无法读取当前页面区域');
    }
    return response.image;
}

export async function translateCapturedAreaInExtension(
    image: string,
    selection: AreaTranslationSelection,
    sourceLanguage: string,
    title: string,
): Promise<AreaTranslationResult> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadAreaTranslateCapture',
        image,
        selection,
        sourceLanguage,
        title,
    }) as AreaTranslationResponse | undefined;

    if (!response?.success || !response.image || !Array.isArray(response.lines)) {
        throw new Error(response?.error || '圈选翻译服务不可用');
    }

    return { image: response.image, lines: response.lines };
}
