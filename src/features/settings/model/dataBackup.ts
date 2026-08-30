/**
 * @file src/features/settings/model/dataBackup.ts
 * 文件职责：定义设置、单词本与模型用量的统一本机备份信封，并识别可兼容导入的旧版独立数据文件。
 * 主要内容：提供版本化完整备份类型、严格的顶层结构校验、导入类型识别与预览统计。
 * 模块边界：该模块只处理可序列化数据形状，不读取 IndexedDB、不保存配置、不下载文件；各领域仓库继续拥有自己的校验与合并语义。
 */

import {isConfigImportValid} from '@/src/core/config/transfer';
import {
    VOCABULARY_BOOK_EXPORT_FORMAT,
    VOCABULARY_BOOK_EXPORT_VERSION,
    type VocabularyBookExport,
} from '@/src/features/vocabulary/public';
import {
    MODEL_USAGE_TRANSFER_FORMAT,
    MODEL_USAGE_TRANSFER_VERSION,
    type ModelUsageTransferDocument,
} from '@/src/services/model-usage/types';

export const FLUENTREAD_DATA_BACKUP_FORMAT = 'fluentread-data-backup' as const;
export const FLUENTREAD_DATA_BACKUP_VERSION = 1 as const;

export interface FluentReadDataBackup {
    format: typeof FLUENTREAD_DATA_BACKUP_FORMAT;
    version: typeof FLUENTREAD_DATA_BACKUP_VERSION;
    exportedAt: number;
    config: Record<string, unknown>;
    vocabulary: VocabularyBookExport;
    modelUsage: ModelUsageTransferDocument;
}

export type LocalDataImport =
    | {kind: 'complete'; backup: FluentReadDataBackup}
    | {kind: 'vocabulary'; vocabulary: VocabularyBookExport}
    | {kind: 'model-usage'; modelUsage: ModelUsageTransferDocument}
    | {kind: 'config'; config: Record<string, unknown>};

export interface LocalDataImportSummary {
    kind: LocalDataImport['kind'];
    configIncluded: boolean;
    vocabularyEntries: number;
    vocabularyReviewLogs: number;
    modelUsageEvents: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isVocabularyExport(value: unknown): value is VocabularyBookExport {
    return isPlainRecord(value)
        && value.format === VOCABULARY_BOOK_EXPORT_FORMAT
        && value.version === VOCABULARY_BOOK_EXPORT_VERSION
        && typeof value.exportedAt === 'number'
        && typeof value.includesPrivateContext === 'boolean'
        && Array.isArray(value.entries)
        && Array.isArray(value.reviewLogs);
}

function isModelUsageExport(value: unknown): value is ModelUsageTransferDocument {
    return isPlainRecord(value)
        && value.format === MODEL_USAGE_TRANSFER_FORMAT
        && value.version === MODEL_USAGE_TRANSFER_VERSION
        && typeof value.exportedAt === 'number'
        && Array.isArray(value.events);
}

export function createFluentReadDataBackup(input: {
    config: Record<string, unknown>;
    vocabulary: VocabularyBookExport;
    modelUsage: ModelUsageTransferDocument;
    exportedAt?: number;
}): FluentReadDataBackup {
    if (!isConfigImportValid(input.config)) throw new TypeError('完整备份中的配置无效');
    if (!isVocabularyExport(input.vocabulary)) throw new TypeError('完整备份中的单词本数据无效');
    if (!isModelUsageExport(input.modelUsage)) throw new TypeError('完整备份中的模型用量无效');
    const exportedAt = input.exportedAt ?? Date.now();
    if (!Number.isFinite(exportedAt) || exportedAt < 0) throw new TypeError('完整备份导出时间无效');
    return {
        format: FLUENTREAD_DATA_BACKUP_FORMAT,
        version: FLUENTREAD_DATA_BACKUP_VERSION,
        exportedAt,
        config: input.config,
        vocabulary: input.vocabulary,
        modelUsage: input.modelUsage,
    };
}

export function parseLocalDataImport(value: unknown): LocalDataImport {
    if (!isPlainRecord(value)) throw new TypeError('备份文件必须是 JSON 对象');

    if (value.format === FLUENTREAD_DATA_BACKUP_FORMAT) {
        if (value.version !== FLUENTREAD_DATA_BACKUP_VERSION) throw new TypeError('完整备份版本不受支持');
        if (!Number.isFinite(value.exportedAt) || (value.exportedAt as number) < 0) {
            throw new TypeError('完整备份导出时间无效');
        }
        if (!isConfigImportValid(value.config)) throw new TypeError('完整备份中的配置无效');
        if (!isVocabularyExport(value.vocabulary)) throw new TypeError('完整备份中的单词本数据无效');
        if (!isModelUsageExport(value.modelUsage)) throw new TypeError('完整备份中的模型用量无效');
        return {kind: 'complete', backup: value as unknown as FluentReadDataBackup};
    }

    if (isVocabularyExport(value)) return {kind: 'vocabulary', vocabulary: value};
    if (isModelUsageExport(value)) return {kind: 'model-usage', modelUsage: value};
    if (isConfigImportValid(value)) return {kind: 'config', config: value};
    throw new TypeError('不是受支持的 FluentRead 备份或旧版配置文件');
}

export function summarizeLocalDataImport(value: LocalDataImport): LocalDataImportSummary {
    if (value.kind === 'complete') {
        return {
            kind: value.kind,
            configIncluded: true,
            vocabularyEntries: value.backup.vocabulary.entries.length,
            vocabularyReviewLogs: value.backup.vocabulary.reviewLogs.length,
            modelUsageEvents: value.backup.modelUsage.events.length,
        };
    }
    if (value.kind === 'vocabulary') {
        return {
            kind: value.kind,
            configIncluded: false,
            vocabularyEntries: value.vocabulary.entries.length,
            vocabularyReviewLogs: value.vocabulary.reviewLogs.length,
            modelUsageEvents: 0,
        };
    }
    if (value.kind === 'config') {
        return {
            kind: value.kind,
            configIncluded: true,
            vocabularyEntries: 0,
            vocabularyReviewLogs: 0,
            modelUsageEvents: 0,
        };
    }
    return {
        kind: value.kind,
        configIncluded: false,
        vocabularyEntries: 0,
        vocabularyReviewLogs: 0,
        modelUsageEvents: value.modelUsage.events.length,
    };
}
