/**
 * @file src/app/content/xVideoBridge.ts
 * 文件职责：组装 X 原生字幕与公开媒体候选网络桥，复用公共卸载生命周期。
 * 主要内容：把 X 字幕及有界 video_info 资源识别策略注入共享 Fetch/XHR 桥，复用禁用、恢复、页面离开时的方法恢复与最近资源回放。
 * 模块边界：不读取扩展配置、不翻译或解析字幕时间轴，只连接站点策略与浏览器适配器。
 */
import {installYoutubeTimedTextBridge} from '@/src/features/video-subtitle/content/youtubeTimedTextBridge';
import {isXVideoBridgeResourceUrl, createXVideoBridgeResourcePayload} from '@/src/features/video-subtitle/content/xVideoSubtitleData';
export const startXVideoBridgeApp = () => installYoutubeTimedTextBridge({
    matches: isXVideoBridgeResourceUrl,
    payload: createXVideoBridgeResourcePayload,
    replayLatest: true,
    binaryText: true,
    maxResponseBytes: 2_000_000,
});
