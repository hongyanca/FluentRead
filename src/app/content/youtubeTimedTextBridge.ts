/**
 * @file src/app/content/youtubeTimedTextBridge.ts
 * 文件职责：为 YouTube timedtext MAIN-world 桥提供 app 层启动入口，使 WXT 注入脚本遵循统一的 start…App 组合约定。
 * 主要内容：把 video-subtitle/content 中的 installYoutubeTimedTextBridge 重命名导出为 startYoutubeTimedTextBridgeApp，供独立 MAIN-world entrypoint 调用。
 * 模块边界：本文件不拦截 XHR/fetch、不解析字幕 URL，也不管理启停事件；桥接所有权和宿主 API 恢复逻辑保留在 video-subtitle feature 内部。
 */
export {
    installYoutubeTimedTextBridge as startYoutubeTimedTextBridgeApp,
} from '@/src/features/video-subtitle/content/youtubeTimedTextBridge';
