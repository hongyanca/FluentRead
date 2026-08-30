/**
 * @file src/app/offscreen/imageTranslation.ts
 * 文件职责：汇总 Offscreen Document 中图片与区域翻译所需的 OCR 和渲染能力，供 offscreen runtime 通过单一 app 路径装配。
 * 主要内容：重导出 OCR 语言包下载、图片识别、整图翻译、圈选区域翻译函数，以及 Offscreen 图片翻译行和结果类型。
 * 模块边界：该 barrel 不监听 runtime 消息、不探测浏览器 capability，也不持有 Worker；OCR 和绘制实现由 image-translation feature services 所有，路由在 messageRouter。
 */
export {
    downloadImageOcrLanguages,
    recognizeImage,
} from '@/src/features/image-translation/services/ocrRuntime';
export {
    translateAreaInOffscreen,
    translateImageInOffscreen,
    type OffscreenImageTranslationLine,
    type OffscreenImageTranslationResult,
} from '@/src/features/image-translation/services/offscreenRuntime';
