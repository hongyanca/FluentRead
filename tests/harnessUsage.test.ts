/**
 * @file tests/harnessUsage.test.ts
 * 文件职责：验证 Harness 用量事件转换，以及 reading 事件在模型用量仓库中的保存、导出和恢复。
 * 主要内容：覆盖完整/缺失 LanguageModelUsage、缓存与 reasoning 明细和幂等导入。
 * 模块边界：使用临时 IndexedDB，不访问真实模型、网络或 Harness runtime。
 */
import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it} from 'vitest';
import {ModelUsageRepository, FluentReadModelUsageDatabase} from '@/src/platform/storage/modelUsageRepository';
import {createHarnessUsageEvent} from '@/src/services/harness/usage';

const databases: FluentReadModelUsageDatabase[] = [];
let sequence = 0;

afterEach(async () => {
    await Promise.all(databases.splice(0).map(async (database) => {
        database.close();
        await database.delete();
    }));
});

function repository(): ModelUsageRepository {
    sequence += 1;
    const database = new FluentReadModelUsageDatabase(`FluentReadHarnessUsage-${sequence}`);
    databases.push(database);
    return new ModelUsageRepository(database);
}

describe('Harness usage event', () => {
    it('preserves complete token, cache and reasoning details', () => {
        const event = createHarnessUsageEvent({
            service: 'openai', model: 'gpt-test', actualModel: 'gpt-actual', startedAt: 100, durationMs: 25, outcome: 'success',
            usage: {
                inputTokens: 100, outputTokens: 40, totalTokens: 140,
                inputTokenDetails: {noCacheTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 0},
                outputTokenDetails: {textTokens: 35, reasoningTokens: 5},
            },
        });
        expect(event).toMatchObject({purpose: 'reading', usageAvailability: 'reported', inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedInputTokens: 20, cacheWriteTokens: 0, reasoningTokens: 5});
        expect(event.actualModel).toBe('gpt-actual');
    });

    it('does not turn missing usage fields into zero', () => {
        expect(createHarnessUsageEvent({service: 'openai', model: 'gpt-test', startedAt: 100, durationMs: 25, outcome: 'cancelled'})).toMatchObject({purpose: 'reading', usageAvailability: 'unreported'});
        const malformed = createHarnessUsageEvent({
            service: 'openai', model: 'gpt-test', startedAt: 100, durationMs: 25, outcome: 'error',
            usage: {inputTokens: 10, outputTokens: undefined, totalTokens: undefined, inputTokenDetails: {noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined}, outputTokenDetails: {textTokens: undefined, reasoningTokens: undefined}},
        });
        expect(malformed.usageAvailability).toBe('malformed');
        expect(malformed).not.toHaveProperty('inputTokens');
        const legacy = createHarnessUsageEvent({
            service: 'openai', model: 'gpt-test', startedAt: 100, durationMs: 25, outcome: 'success',
            usage: {inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedInputTokens: 1, reasoningTokens: 1} as never,
        });
        expect(legacy).toMatchObject({cachedInputTokens: 1, reasoningTokens: 1});
        const noDetails = createHarnessUsageEvent({
            service: 'openai', model: 'gpt-test', startedAt: 100, durationMs: 25, outcome: 'success',
            usage: {inputTokens: 1, outputTokens: 2, totalTokens: 3} as never,
        });
        expect(noDetails).not.toHaveProperty('cachedInputTokens');
        expect(noDetails).not.toHaveProperty('cacheWriteTokens');
        expect(noDetails).not.toHaveProperty('reasoningTokens');
        const knownModel = createHarnessUsageEvent({service: 'openai', model: 'gpt-configured', startedAt: 100, durationMs: 25, outcome: 'success', usage: {inputTokens: 1, outputTokens: 2, totalTokens: 3} as never});
        expect(knownModel).not.toHaveProperty('actualModel');
    });

    it('saves, exports and restores reading events through the repository', async () => {
        const source = repository();
        const target = repository();
        const event = createHarnessUsageEvent({service: 'deepseek', model: 'deepseek-chat', startedAt: 200, durationMs: 30, outcome: 'success', usage: {inputTokens: 5, outputTokens: 7, totalTokens: 12, inputTokenDetails: {noCacheTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0}, outputTokenDetails: {textTokens: 7, reasoningTokens: undefined}}});
        event.id = 'reading-event-1';
        await expect(source.recordMany([event])).resolves.toBe(1);
        const document = await source.exportData(300);
        expect(document.events[0]).toMatchObject({purpose: 'reading', totalTokens: 12});
        await expect(target.importData(document)).resolves.toMatchObject({receivedCount: 1, importedCount: 1});
        await expect(target.database.events.where('purpose').equals('reading').count()).resolves.toBe(1);
        await expect(target.importData(document)).resolves.toMatchObject({receivedCount: 1, importedCount: 0, duplicateCount: 1});
    });
});
