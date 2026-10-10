/**
 * @file entrypoints/xVideoBridge.content.ts
 * 文件职责：在 X/Twitter MAIN world 启动字幕资源桥。
 * 主要内容：声明站点匹配与 document_start 注入，委托应用组合根。
 * 模块边界：入口不修改宿主 API，具体桥接与清理由视频 feature 统一负责。
 */
import {startXVideoBridgeApp} from '@/src/app/content/xVideoBridge';
export default defineContentScript({
  matches: ['*://*.x.com/*', '*://x.com/*', '*://*.twitter.com/*', '*://twitter.com/*'],
  runAt: 'document_start', world: 'MAIN', globalName: false,
  main: startXVideoBridgeApp,
});
