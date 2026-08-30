/**
 * @file src/features/vocabulary/public.ts
 * 文件职责：暴露单词本供其他 feature 消费的稳定公开合同。
 * 主要内容：重导出迁移、导入导出和消息请求所需的常量、纯函数与类型。
 * 模块边界：本文件只是纯 barrel，不暴露仓库或 UI 实现，不执行任何运行时逻辑。
 */
export {
    buildAnkiTsv,
    VOCABULARY_BOOK_EXPORT_FORMAT,
    VOCABULARY_BOOK_EXPORT_VERSION,
    VOCABULARY_BOOK_MESSAGE,
    vocabularyImportNeedsConfirmation,
    type VocabularyBookExport,
    type VocabularyBookRequest,
    type VocabularyBookResponse,
    type VocabularyExportEntry,
    type VocabularyImportResult,
} from './learningModel';
