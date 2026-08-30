/**
 * @file entrypoints/document/main.ts
 * 文件职责：启动文档翻译独立页面的 Vue 应用。
 * 主要内容：把固定的 #app 容器交给 mountDocumentTranslationApp 完成页面装配。
 * 模块边界：不解析文件、不执行翻译或导出；这些能力由 document app 与 feature 服务实现。
 */
import {mountDocumentTranslationApp} from '@/src/app/document-translation/page';

mountDocumentTranslationApp('#app');
