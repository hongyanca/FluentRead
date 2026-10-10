/**
 * @file src/features/area-translation/protocol.ts
 * 文件职责：定义圈选翻译独立的截图识别和文本结果协议，供内容页、后台与 Offscreen 共用。
 * 主要内容：导出选区几何、原始 OCR 截图和包含原文、译文及独立 AI 校正文的结果类型；提示码明确区分机器翻译局限和仅文字 AI 辅助。
 * 模块边界：协议不挂载 UI、不读取配置、不执行网络或识别；保留原始截图和 OCR 行，使任何纠错始终可核对。
 */
export {areaRectToImageCrop, type AreaTranslationSelection} from './core';
export type {AreaRecognitionResult, AreaTranslationMode, AreaTranslationResult} from './types';
