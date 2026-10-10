/**
 * @file src/app/background/handlers/vocabulary.ts
 * 文件职责：集中暴露生词本后台用例、变更广播协议和仓库契约，供 messageRuntime 组装跨标签页同步能力。
 * 主要内容：只重导出组合根实际使用的 handler 集合工厂、浏览器变更广播器与 VocabularyBackgroundContext 上下文类型。
 * 模块边界：这里不操作 IndexedDB、不实现词条规则，也不渲染生词本界面；数据仓库与业务 handler 位于 vocabulary feature，app 层只负责选择依赖并注册。
 */
export {
    createBrowserVocabularyBookChangedBroadcaster,
    createVocabularyBackgroundHandlers,
    type VocabularyBackgroundContext,
} from '@/src/features/vocabulary/background';
