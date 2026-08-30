/**
 * @file src/app/background/handlers/vocabulary.ts
 * 文件职责：集中暴露生词本后台用例、变更广播协议和仓库契约，供 messageRuntime 组装跨标签页同步能力。
 * 主要内容：重导出新增/查询等 handler 工厂、浏览器广播器、变更消息与确认响应，以及 VocabularyBookRuntimeMessage 和 repository contract 类型。
 * 模块边界：这里不操作 IndexedDB、不实现词条规则，也不渲染生词本界面；数据仓库与业务 handler 位于 vocabulary feature，app 层只负责选择依赖并注册。
 */
export {
    createBrowserVocabularyBookChangedBroadcaster,
    createVocabularyBackgroundHandlers,
    createVocabularyBookChangedAckHandler,
    createVocabularyBookChangedMessage,
    createVocabularyBookHandler,
    VOCABULARY_BOOK_CHANGED_ACK_RESPONSE,
    type VocabularyBackgroundContext,
    type VocabularyBookBackgroundDependencies,
    type VocabularyBookChangeBroadcastAdapter,
    type VocabularyBookChangedBroadcaster,
    type VocabularyBookRepositoryContract,
} from '@/src/features/vocabulary/background';

export type {
    VocabularyBookRuntimeMessage,
} from '@/src/features/vocabulary/protocol';
