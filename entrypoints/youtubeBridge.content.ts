/**
 * @file entrypoints/youtubeBridge.content.ts
 * 文件职责：在全部 YouTube 页面 MAIN world 预注入 timedtext 网络桥，确保首页/搜索页经 SPA 导航到播放页后仍能获取原生字幕响应。
 * 主要内容：匹配 youtube.com 的裸域和子域全路径，从 document_start 调用 startYoutubeTimedTextBridgeApp，并关闭 WXT 全局包装。
 * 模块边界：桥只覆盖顶层 YouTube SPA，不宣称支持 youtube-nocookie embed iframe；消费端仍需复验视频所有权和消息上限。
 */
import {startYoutubeTimedTextBridgeApp} from '@/src/app/content/youtubeTimedTextBridge';

export default defineContentScript({
  matches: ['*://*.youtube.com/*', '*://youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  globalName: false,
  main: startYoutubeTimedTextBridgeApp,
});
