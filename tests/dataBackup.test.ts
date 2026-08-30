import {describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {prepareConfigForExport} from '@/src/core/config/transfer';
import {
    FLUENTREAD_DATA_BACKUP_FORMAT,
    createFluentReadDataBackup,
    parseLocalDataImport,
    summarizeLocalDataImport,
} from '@/src/features/settings/model/dataBackup';
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

function vocabulary(): VocabularyBookExport {
    return {
        format: VOCABULARY_BOOK_EXPORT_FORMAT,
        version: VOCABULARY_BOOK_EXPORT_VERSION,
        exportedAt: 100,
        includesPrivateContext: false,
        entries: [],
        reviewLogs: [],
    };
}

function modelUsage(): ModelUsageTransferDocument {
    return {
        format: MODEL_USAGE_TRANSFER_FORMAT,
        version: MODEL_USAGE_TRANSFER_VERSION,
        exportedAt: 100,
        events: [],
    };
}

describe('统一本机数据备份信封', () => {
    it('组合并识别配置、单词本与模型用量完整备份', () => {
        const backup = createFluentReadDataBackup({
            config: prepareConfigForExport(new Config()),
            vocabulary: vocabulary(),
            modelUsage: modelUsage(),
            exportedAt: 200,
        });

        expect(backup).toMatchObject({format: FLUENTREAD_DATA_BACKUP_FORMAT, version: 1, exportedAt: 200});
        const parsed = parseLocalDataImport(JSON.parse(JSON.stringify(backup)));
        expect(parsed).toEqual({kind: 'complete', backup});
        expect(summarizeLocalDataImport(parsed)).toEqual({
            kind: 'complete',
            configIncluded: true,
            vocabularyEntries: 0,
            vocabularyReviewLogs: 0,
            modelUsageEvents: 0,
        });
    });

    it('兼容识别旧版单词本、模型用量与配置文件', () => {
        expect(parseLocalDataImport(vocabulary())).toEqual({kind: 'vocabulary', vocabulary: vocabulary()});
        expect(parseLocalDataImport(modelUsage())).toEqual({kind: 'model-usage', modelUsage: modelUsage()});

        const vocabularyWithRows = {
            ...vocabulary(),
            entries: [null as never],
            reviewLogs: [null as never],
        };
        expect(summarizeLocalDataImport({kind: 'vocabulary', vocabulary: vocabularyWithRows})).toEqual({
            kind: 'vocabulary',
            configIncluded: false,
            vocabularyEntries: 1,
            vocabularyReviewLogs: 1,
            modelUsageEvents: 0,
        });
        const modelUsageWithRows = {...modelUsage(), events: [null as never]};
        expect(summarizeLocalDataImport({kind: 'model-usage', modelUsage: modelUsageWithRows})).toEqual({
            kind: 'model-usage',
            configIncluded: false,
            vocabularyEntries: 0,
            vocabularyReviewLogs: 0,
            modelUsageEvents: 1,
        });

        const config = JSON.parse(JSON.stringify(prepareConfigForExport(new Config()))) as Record<string, unknown>;
        expect(parseLocalDataImport(config)).toEqual({kind: 'config', config});
        expect(summarizeLocalDataImport({kind: 'config', config})).toEqual({
            kind: 'config',
            configIncluded: true,
            vocabularyEntries: 0,
            vocabularyReviewLogs: 0,
            modelUsageEvents: 0,
        });
    });

    it('拒绝版本、配置或领域数据不完整的伪备份', () => {
        const config = prepareConfigForExport(new Config());
        expect(() => parseLocalDataImport(null)).toThrow('JSON 对象');
        expect(() => parseLocalDataImport([])).toThrow('JSON 对象');
        expect(() => parseLocalDataImport(new Date())).toThrow('JSON 对象');
        expect(() => parseLocalDataImport({format: FLUENTREAD_DATA_BACKUP_FORMAT, version: 2}))
            .toThrow('版本');
        expect(() => createFluentReadDataBackup({config: {}, vocabulary: vocabulary(), modelUsage: modelUsage()}))
            .toThrow('配置');
        expect(() => parseLocalDataImport({
            format: FLUENTREAD_DATA_BACKUP_FORMAT,
            version: 1,
            exportedAt: 100,
            config,
            vocabulary: {...vocabulary(), entries: null},
            modelUsage: modelUsage(),
        })).toThrow('单词本');
        expect(() => parseLocalDataImport({format: 'unsupported'})).toThrow('不是受支持');
    });

    it('对创建时的单词本、模型用量和时间字段执行完整校验', () => {
        const config = prepareConfigForExport(new Config());
        const invalidVocabularyValues = [
            null,
            {...vocabulary(), format: 'other'},
            {...vocabulary(), version: 2},
            {...vocabulary(), exportedAt: '100'},
            {...vocabulary(), includesPrivateContext: 'false'},
            {...vocabulary(), entries: null},
            {...vocabulary(), reviewLogs: null},
        ] as unknown as VocabularyBookExport[];
        for (const invalidVocabulary of invalidVocabularyValues) {
            expect(() => createFluentReadDataBackup({
                config,
                vocabulary: invalidVocabulary,
                modelUsage: modelUsage(),
            })).toThrow('单词本');
        }

        const invalidModelUsageValues = [
            null,
            {...modelUsage(), format: 'other'},
            {...modelUsage(), version: 2},
            {...modelUsage(), exportedAt: '100'},
            {...modelUsage(), events: null},
        ] as unknown as ModelUsageTransferDocument[];
        for (const invalidModelUsage of invalidModelUsageValues) {
            expect(() => createFluentReadDataBackup({
                config,
                vocabulary: vocabulary(),
                modelUsage: invalidModelUsage,
            })).toThrow('模型用量');
        }

        expect(() => createFluentReadDataBackup({
            config,
            vocabulary: vocabulary(),
            modelUsage: modelUsage(),
            exportedAt: Number.POSITIVE_INFINITY,
        })).toThrow('导出时间');
        expect(() => createFluentReadDataBackup({
            config,
            vocabulary: vocabulary(),
            modelUsage: modelUsage(),
            exportedAt: -1,
        })).toThrow('导出时间');

        const now = vi.spyOn(Date, 'now').mockReturnValue(321);
        expect(createFluentReadDataBackup({config, vocabulary: vocabulary(), modelUsage: modelUsage()}).exportedAt)
            .toBe(321);
        now.mockRestore();
    });

    it('对完整备份的时间、配置和各领域严格拒绝失真数据', () => {
        const backup = createFluentReadDataBackup({
            config: prepareConfigForExport(new Config()),
            vocabulary: vocabulary(),
            modelUsage: modelUsage(),
            exportedAt: 100,
        });
        expect(() => parseLocalDataImport({...backup, exportedAt: Number.NaN})).toThrow('导出时间');
        expect(() => parseLocalDataImport({...backup, exportedAt: -1})).toThrow('导出时间');
        expect(() => parseLocalDataImport({...backup, config: {}})).toThrow('配置');
        expect(() => parseLocalDataImport({...backup, modelUsage: {...modelUsage(), events: null}}))
            .toThrow('模型用量');
    });

    it('接受无原型的标准 JSON 对象形状', () => {
        const nullPrototypeModel = Object.assign(Object.create(null), modelUsage()) as ModelUsageTransferDocument;
        const parsed = parseLocalDataImport(nullPrototypeModel);
        expect(parsed.kind).toBe('model-usage');
        if (parsed.kind === 'model-usage') expect(parsed.modelUsage).toBe(nullPrototypeModel);
    });
});
