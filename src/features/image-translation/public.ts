/**
 * @file src/features/image-translation/public.ts
 * 文件职责：汇总图片翻译 feature 的对外契约，供 content 注册、设置页面和区域翻译适配器获取各自所需的最小稳定能力。
 * 主要内容：再导出图片翻译 mount/unmount 和右键目标切换、漫画连续翻译动作与状态订阅、OCR 语言包准备函数，以及 ImageOcrSettings Vue 组件；语言包常量由 ocrLanguages 直接提供。
 * 模块边界：公共入口不暴露后台 handler、Tesseract worker 或 Canvas 修补细节；应用层据浏览器 capability 选择性使用，区域翻译只依赖共享结果类型而不反向控制图片 UI。
 */
export {
    toggleMangaTranslation,
    subscribeMangaTranslation,
    toggleContextMenuImage,
    mountImageTranslator,
    unmountImageTranslator,
} from './content';
export type {MangaTranslationStatus} from './content/mangaSession';
export {default as ImageOcrSettings} from './ui/ImageOcrSettings.vue';
export {prepareImageOcrLanguages} from './services/client';
export {isImageTranslatorNeeded, isMangaReaderPage, mountMangaEntry, unmountMangaEntry, openMangaEntry} from './content/mangaEntry';
export {default as MangaSettings} from './ui/MangaSettings.vue';
