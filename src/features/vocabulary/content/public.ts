/**
 * @file src/features/vocabulary/content/public.ts
 * 文件职责：公开再次遇见收藏表达的页面生命周期。
 * 主要内容：精确导出挂载和卸载，供内容应用注册表统一管理。
 * 模块边界：独立于纯数据出口，不让后台导入 Vue 和 Shadow DOM；匹配与绘制由 feature 内部拥有。
 */
export {mountVocabularyReencounter, unmountVocabularyReencounter} from './reencounter';
