/**
 * @file src/features/glossary/public.ts
 * 文件职责：向设置中心暴露个人术语库的管理界面，保持其他功能只依赖术语库的公开入口。
 * 主要内容：导出设置组件；术语匹配、数据格式与翻译请求仍分别由 core/glossary 和 services/translation 管理。
 * 模块边界：不读取配置、不执行网络请求，也不把界面内部状态作为跨功能的数据接口。
 */
export {default as GlossarySettings} from './ui/GlossarySettings.vue';
