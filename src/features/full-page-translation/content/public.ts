/**
 * @file src/features/full-page-translation/content/public.ts
 * 文件职责：向其他内容功能提供全文翻译已注册文本根的受控只读端口。
 * 主要内容：仅导出可见译文根查询，保持闭合 ShadowRoot 的注册及撤销所有权，不暴露注册器、会话或翻译运行时。
 * 模块边界：这是无平台依赖的 content 公共出口，避免只读正文收集或文档评分适配器间接启动完整翻译与配置存储。
 */
export {readVisibleTranslationRoot} from './visibleTranslation';
