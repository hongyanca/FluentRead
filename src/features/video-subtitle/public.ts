/**
 * @file src/features/video-subtitle/public.ts
 * 文件职责：定义视频字幕 feature 的公共入口，分别暴露内容页字幕翻译运行时和 MAIN-world timedtext 桥的安装能力。
 * 主要内容：文件精确再导出 mountVideoSubtitleTranslation 与 installYoutubeTimedTextBridge，使应用层能够按执行世界分别注册两个生命周期。
 * 模块边界：该 barrel 不执行自动挂载，也不暴露解析器或内部 DOM 常量；content composition root 决定启停和站点范围，桥与 UI 必须保持独立清理。
 */
export {isYouTubeVideoPage, mountVideoSubtitleTranslation} from './content/runtime';
export {installYoutubeTimedTextBridge} from './content/youtubeTimedTextBridge';
