/**
 * @file src/features/vocabulary/background/index.ts
 * 文件职责：汇总单词本后台的 handler 工厂、广播工具、ACK 常量和依赖类型，为应用级消息注册提供稳定入口。
 * 主要内容：文件从 handler.ts 精确再导出运行能力和类型，并从 feature protocol 转发 VocabularyBookRuntimeMessage 供 router 静态约束。
 * 模块边界：该 barrel 不创建数据库或注册 browser.runtime；实例化仓库、日志和广播适配器由 background composition root 负责，领域模型保持在 learningModel/repository。
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
} from './handler';

export type {
    VocabularyBookRuntimeMessage,
} from '@/src/features/vocabulary/protocol';
