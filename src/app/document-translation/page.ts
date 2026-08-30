/**
 * @file src/app/document-translation/page.ts
 * 文件职责：提供文档翻译页面的最小 Vue 挂载函数，把 WXT 页面入口与 DocumentApp 组件及其页面样式连接起来。
 * 主要内容：导入 DocumentApp、document-page.css 和共享视觉 token，创建 Vue 应用并挂载到调用方提供的 CSS selector。
 * 模块边界：这里不注册 Element Plus 全局依赖、不处理文件或配置，也不管理卸载；WXT entrypoint 决定选择器和启动时机，业务交互全部在组件与 feature 中。
 */
import {createApp} from 'vue';
import DocumentApp from './DocumentApp.vue';
import './document-page.css';

/** 文档翻译 WXT 页面唯一挂载入口。 */
export function mountDocumentTranslationApp(selector: string): void {
    createApp(DocumentApp).mount(selector);
}
