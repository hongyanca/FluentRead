/**
 * @file entrypoints/shadowBridge.content.ts
 * 文件职责：在网页 MAIN world 注入 Shadow DOM 路由桥，观察不会穿过隔离世界的页面导航变化。
 * 主要内容：从 document_start 调用 startShadowBridgeApp，并限定为无全局包装的主世界内容脚本。
 * 模块边界：只发布版本化导航信号，不暴露扩展配置或特权 API；可信校验和生命周期在 src/app/content/shadowBridge 中实现。
 */
import {startShadowBridgeApp} from '@/src/app/content/shadowBridge';

export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    world: 'MAIN',
    globalName: false,
    main: startShadowBridgeApp,
});
