/**
 * @file src/features/area-translation/types.ts
 * 文件职责：声明圈选翻译的本地识别数据、模式与独立文本结果，供后台、内容页和 Offscreen 共享静态契约。
 * 主要内容：定义原始裁剪截图与 OCR 行，以及保留原文、译文、可选校正文和明确模式提示及本次服务、模型快照的结果类型。
 * 模块边界：该文件仅包含 TypeScript 类型，不执行校验、OCR、网络请求或 UI 渲染；跨 feature 调用从 protocol 取得契约。
 */
import type {OcrLine} from '@/src/shared/image/types';
export type AreaTranslationMode = 'standard' | 'ai';
export type AreaTranslationWarning = 'standard-quality' | 'ai-text-only';
export interface AreaRecognitionResult {
    image: string;
    lines: OcrLine[];
    sourceText?: string;
    recognitionMethod?: 'ocr' | 'vision';
    recognitionFallback?: 'unsupported' | 'unknown';
}
export interface AreaTranslationResult extends AreaRecognitionResult {
    /** 本次请求冻结的公开服务信息；不包含端点或凭据。 */
    service: string;
    serviceName: string;
    /** 非模型服务为空字符串。 */
    model: string;
    sourceText: string;
    translatedText: string;
    correctedText?: string;
    mode: AreaTranslationMode;
    warnings: AreaTranslationWarning[];
}
