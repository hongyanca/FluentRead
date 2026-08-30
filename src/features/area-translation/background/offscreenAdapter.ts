/**
 * @file src/features/area-translation/background/offscreenAdapter.ts
 * 文件职责：把圈选翻译 feature 的图片、源语言、标题和视口选区转换成平台 Offscreen 消息，并把返回值收窄为可供后台 handler 使用的图片翻译结果。
 * 主要内容：包含 AreaOffscreenResponse 协议形状、createAreaTranslationOffscreenAdapter 工厂、成功响应的 image 与 lines 校验，以及复用 chromeOffscreenClient 的默认适配器实例。
 * 模块边界：适配器只拥有 feature 到 OffscreenClient 的协议转换，不创建 offscreen document、不执行 OCR 或绘图；文档生命周期归 platform/offscreen，图像处理归 image-translation services。
 */
import type {AreaTranslationSelection} from '@/src/features/area-translation/core';
import type {OffscreenImageTranslationResult} from '@/src/features/image-translation/public';
import {
    chromeOffscreenClient,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';

interface AreaOffscreenResponse {
    readonly success?: boolean;
    readonly error?: string;
    readonly image?: unknown;
    readonly lines?: unknown;
}

/** 圈选 feature 只声明自身消息，文档创建和 runtime callback 由平台 client 负责。 */
export function createAreaTranslationOffscreenAdapter(client: OffscreenClient = chromeOffscreenClient) {
    return {
        async translateArea(
            image: string,
            sourceLanguage: string,
            title: string,
            selection: AreaTranslationSelection,
        ): Promise<OffscreenImageTranslationResult> {
            const response = await client.send<AreaOffscreenResponse>({
                type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN',
                image,
                sourceLanguage,
                title,
                selection,
            });
            if (!response?.success || typeof response.image !== 'string' || !Array.isArray(response.lines)) {
                throw new Error(response?.error || '圈选翻译失败');
            }
            return {image: response.image, lines: response.lines as OffscreenImageTranslationResult['lines']};
        },
    };
}

export const areaTranslationOffscreenAdapter = createAreaTranslationOffscreenAdapter();
