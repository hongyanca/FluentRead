/**
 * @file entrypoints/content.ts
 * 文件职责：声明注入所有网页的 WXT 内容脚本入口，并把页面功能生命周期交给内容应用组合根。
 * 主要内容：在 document_start 注入并等待基础 DOM 可挂载后调用 startContentApp，统一启动翻译、悬浮与交互功能。
 * 模块边界：入口不读取配置、不操作页面 DOM，也不直接挂载 feature；激活、清理和错误隔离均由 src/app/content 管理。
 */
import {startContentApp} from '@/src/app/content/runtime';
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    cssInjectionMode: 'ui',
    main: startContentApp,
});
