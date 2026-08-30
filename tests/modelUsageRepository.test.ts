import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    FluentReadModelUsageDatabase,
    ModelUsageRepository,
    normalizeStoredModelUsageEvent,
    parseModelUsageTransferDocument,
} from '@/src/platform/storage/modelUsageRepository';
import type {ModelUsageEvent} from '@/src/services/model-usage/types';

let databaseSequence = 0;
const databases: FluentReadModelUsageDatabase[] = [];

function createRepository(label = 'default') {
    databaseSequence += 1;
    const database = new FluentReadModelUsageDatabase(`FluentReadModelUsage-test-${label}-${databaseSequence}`);
    databases.push(database);
    return new ModelUsageRepository(database);
}

function usageEvent(overrides: Partial<ModelUsageEvent> = {}): ModelUsageEvent {
    return {
        id: `event-${databaseSequence}-${Math.random().toString(36).slice(2)}`,
        startedAt: new Date(2026, 7, 29, 10).getTime(),
        durationMs: 250,
        serviceId: 'moonshot',
        configuredModel: 'kimi-k2.6',
        purpose: 'translation',
        outcome: 'success',
        usageAvailability: 'reported',
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        ...overrides,
    };
}

afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await Promise.all(databases.splice(0).map(async (database) => {
        database.close();
        await database.delete();
    }));
});

describe('大模型用量 IndexedDB repository', () => {
    it('批量写入只保留白名单字段，并以事件 id 幂等去重', async () => {
        const repository = createRepository('allowlist');
        const first = {
            ...usageEvent({id: 'request-a', actualModel: 'kimi-k3', cachedInputTokens: 12}),
            prompt: '不得持久化的网页正文',
            url: 'https://private.example/path?token=secret',
            apiKey: 'sk-sensitive-sentinel',
        } as ModelUsageEvent;
        const second = usageEvent({
            id: 'request-b',
            usageAvailability: 'unreported',
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
        });

        await expect(repository.recordMany([first, second])).resolves.toBe(2);
        await expect(repository.recordMany([first, second])).resolves.toBe(0);

        const stored = await repository.database.events.orderBy('id').toArray();
        expect(stored).toHaveLength(2);
        expect(stored[0]).toMatchObject({
            id: 'request-a',
            schemaVersion: 1,
            serviceId: 'moonshot',
            configuredModel: 'kimi-k2.6',
            actualModel: 'kimi-k3',
            model: 'kimi-k3',
            totalTokens: 100,
        });
        expect(JSON.stringify(stored)).not.toContain('网页正文');
        expect(JSON.stringify(stored)).not.toContain('private.example');
        expect(JSON.stringify(stored)).not.toContain('sk-sensitive-sentinel');
        await expect(repository.recordMany([])).resolves.toBe(0);
    });

    it('同批验证失败不留下半批事件，重复 id 的不同内容也不会覆盖旧记录', async () => {
        const repository = createRepository('atomic');
        const valid = usageEvent({id: 'stable-event'});
        await expect(repository.recordMany([
            valid,
            {...usageEvent({id: 'invalid-event'}), inputTokens: -1},
        ])).rejects.toThrow('inputTokens');
        await expect(repository.database.events.count()).resolves.toBe(0);

        await repository.recordMany([valid]);
        await expect(repository.recordMany([{...valid, totalTokens: 999}]))
            .rejects.toThrow('id 冲突');
        await expect(repository.database.events.get('stable-event')).resolves.toMatchObject({totalTokens: 100});

        const duplicate = usageEvent({id: 'same-batch'});
        await expect(repository.recordMany([duplicate, duplicate])).resolves.toBe(1);
        await expect(repository.recordMany([duplicate, {...duplicate, totalTokens: 101}]))
            .rejects.toThrow('id 冲突');
    });

    it('自动生成事件 id，并在 randomUUID 不可用时使用本地回退标识', async () => {
        const repository = createRepository('generated-id');
        await repository.recordMany([usageEvent({id: undefined})]);
        const uuidRecord = await repository.database.events.toCollection().first();
        expect(uuidRecord?.id).toMatch(/^[0-9a-f-]{36}$/iu);

        vi.stubGlobal('crypto', {});
        await repository.recordMany([usageEvent({id: undefined, configuredModel: ''})]);
        const records = await repository.database.events.toArray();
        expect(records.some((record) => record.id.startsWith('usage-'))).toBe(true);
        expect(records.some((record) => record.configuredModel === 'unknown' && record.model === 'unknown')).toBe(true);
    });

    it('查询仅扫描最近三十日本地窗口，但保留全历史起点与服务模型维度', async () => {
        const repository = createRepository('dashboard');
        const now = new Date(2026, 7, 29, 16).getTime();
        const old = new Date(2026, 3, 1, 12).getTime();
        await repository.recordMany([
            usageEvent({
                id: 'historical',
                startedAt: old,
                serviceId: 'openai',
                configuredModel: 'gpt-5-mini',
                totalTokens: 500,
            }),
            usageEvent({
                id: 'today-kimi',
                startedAt: new Date(2026, 7, 29, 10).getTime(),
                serviceId: 'moonshot',
                configuredModel: 'kimi-k2.6',
                totalTokens: 100,
            }),
            usageEvent({
                id: 'yesterday-kimi',
                startedAt: new Date(2026, 7, 28, 10).getTime(),
                serviceId: 'moonshot',
                configuredModel: 'kimi-k2.6',
                outcome: 'timeout',
                usageAvailability: 'unreported',
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
            }),
        ]);

        const snapshot = await repository.getDashboard({range: '7d', serviceId: 'moonshot'}, now);
        expect(snapshot.recordingStartedAt).toBe(old);
        expect(snapshot.dimensions).toEqual([
            {serviceId: 'moonshot', models: ['kimi-k2.6']},
            {serviceId: 'openai', models: ['gpt-5-mini']},
        ]);
        expect(snapshot.metrics.today.totalTokens).toBe(100);
        expect(snapshot.selected.totals).toMatchObject({
            requestCount: 2,
            successfulRequests: 1,
            failedRequests: 1,
        });
        expect(snapshot.selected.totals.totalTokens).toBe(100);
    });

    it('以 startedAt 和 id 稳定倒序分页，并组合服务、模型、场景、结果与缓存筛选', async () => {
        const repository = createRepository('request-log');
        const now = new Date(2026, 7, 29, 16).getTime();
        const sameTime = now - 1_000;
        await repository.recordMany([
            usageEvent({id: 'request-a', startedAt: sameTime, cachedInputTokens: 0}),
            usageEvent({id: 'request-c', startedAt: sameTime, cachedInputTokens: 30}),
            usageEvent({id: 'request-b', startedAt: sameTime, cachedInputTokens: 20}),
            usageEvent({id: 'request-older', startedAt: sameTime - 1_000, cachedInputTokens: undefined}),
            usageEvent({
                id: 'request-other',
                startedAt: sameTime - 2_000,
                serviceId: 'openai',
                configuredModel: 'gpt-5-mini',
                purpose: 'connection-test',
                outcome: 'timeout',
                usageAvailability: 'unreported',
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
            }),
        ]);

        const first = await repository.getRequestLog({filter: {range: '30d'}, limit: 2}, now);
        expect(first.items.map((item) => item.id)).toEqual(['request-c', 'request-b']);
        expect(first.totalCount).toBe(5);
        expect(first.nextCursor).toEqual({startedAt: sameTime, id: 'request-b'});

        const second = await repository.getRequestLog({
            filter: {range: '30d'},
            cursor: first.nextCursor!,
            limit: 2,
        }, now);
        expect(second.items.map((item) => item.id)).toEqual(['request-a', 'request-older']);
        expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);

        const hit = await repository.getRequestLog({
            filter: {range: '30d', serviceId: 'moonshot', model: 'kimi-k2.6', cacheStatus: 'hit'},
            limit: 20,
        }, now);
        expect(hit.items.map((item) => item.id)).toEqual(['request-c', 'request-b']);
        const timedOutConnection = await repository.getRequestLog({
            filter: {range: '30d', purpose: 'connection-test', outcome: 'timeout', cacheStatus: 'unreported'},
            limit: 20,
        }, now);
        expect(timedOutConnection.items.map((item) => item.id)).toEqual(['request-other']);
    });

    it('请求日志使用默认页长，支持缓存未命中并拒绝非法筛选与游标', async () => {
        const repository = createRepository('request-log-validation');
        const now = new Date(2026, 7, 29, 16).getTime();
        await repository.recordMany([
            usageEvent({id: 'cache-miss', startedAt: now - 1_000, cachedInputTokens: 0}),
            usageEvent({id: 'cache-hit', startedAt: now - 2_000, cachedInputTokens: 1}),
        ]);

        const defaultPage = await repository.getRequestLog(undefined, now);
        expect(defaultPage.items.map((item) => item.id)).toEqual(['cache-miss', 'cache-hit']);
        expect(defaultPage.nextCursor).toBeNull();

        const misses = await repository.getRequestLog({
            filter: {range: '30d', cacheStatus: 'miss'},
            limit: 100,
        }, now);
        expect(misses.items.map((item) => item.id)).toEqual(['cache-miss']);

        await expect(repository.getRequestLog({
            filter: {range: '30d', purpose: 'billing' as never},
        }, now)).rejects.toThrow('purpose');
        await expect(repository.getRequestLog({
            filter: {range: '30d', outcome: 'pending' as never},
        }, now)).rejects.toThrow('outcome');
        await expect(repository.getRequestLog({
            filter: {range: '30d', cacheStatus: 'partial' as never},
        }, now)).rejects.toThrow('cacheStatus');

        for (const limit of [0, 101, 1.5, '20']) {
            await expect(repository.getRequestLog({
                filter: {range: '30d'},
                limit: limit as never,
            }, now)).rejects.toThrow('limit');
        }

        for (const cursor of [null, [], 'cursor']) {
            await expect(repository.getRequestLog({
                filter: {range: '30d'},
                cursor: cursor as never,
            }, now)).rejects.toThrow('游标必须是对象');
        }
        await expect(repository.getRequestLog({
            filter: {range: '30d'},
            cursor: {startedAt: now, id: 42 as never},
        }, now)).rejects.toThrow('游标 id 必须是字符串');
        await expect(repository.getRequestLog({
            filter: {range: '30d'},
            cursor: {startedAt: now, id: 'invalid id'},
        }, now)).rejects.toThrow('id 格式');
        await expect(repository.getRequestLog({
            filter: {range: '30d'},
            cursor: {startedAt: -1, id: 'valid-id'},
        }, now)).rejects.toThrow('cursor.startedAt');
    });

    it('版本化导出只含白名单事件，导入幂等合并且冲突与未知字段整批拒绝', async () => {
        const source = createRepository('export-source');
        const target = createRepository('import-target');
        await source.recordMany([usageEvent({
            id: 'portable-event',
            actualModel: 'kimi-k3',
            cachedInputTokens: 40,
            cacheWriteTokens: 10,
        })]);

        const document = await source.exportData(2_000);
        expect(document).toMatchObject({
            format: 'fluentread-model-usage',
            version: 1,
            exportedAt: 2_000,
        });
        expect(document.events).toEqual([expect.objectContaining({
            id: 'portable-event',
            schemaVersion: 1,
            cacheWriteTokens: 10,
        })]);
        expect(JSON.stringify(document)).not.toContain('"model"');

        await expect(target.importData(document)).resolves.toEqual({
            receivedCount: 1,
            importedCount: 1,
            duplicateCount: 0,
        });
        await expect(target.importData(document)).resolves.toEqual({
            receivedCount: 1,
            importedCount: 0,
            duplicateCount: 1,
        });

        const conflict = structuredClone(document);
        conflict.events[0].totalTokens = 999;
        await expect(target.importData(conflict)).rejects.toThrow('id 冲突');
        await expect(target.database.events.count()).resolves.toBe(1);

        expect(() => parseModelUsageTransferDocument({...document, prompt: '不得接受'})).toThrow('不支持的字段');
        expect(() => parseModelUsageTransferDocument({...document, version: 2})).toThrow('版本');
        expect(() => parseModelUsageTransferDocument({
            ...document,
            events: [{...document.events[0], url: 'https://private.example'}],
        })).toThrow('不支持的字段');
        expect(() => parseModelUsageTransferDocument({
            ...document,
            events: [{...document.events[0], id: undefined}],
        })).toThrow('稳定 id');
    });

    it('导入文档严格校验纯对象、格式、事件数组与事件版本', () => {
        const event = {
            ...usageEvent({id: 'portable-validation'}),
            schemaVersion: 1 as const,
        };
        const document = {
            format: 'fluentread-model-usage' as const,
            version: 1 as const,
            exportedAt: 2_000,
            events: [event],
        };

        for (const invalidDocument of [null, [], new Date(0)]) {
            expect(() => parseModelUsageTransferDocument(invalidDocument)).toThrow('必须是对象');
        }
        expect(() => parseModelUsageTransferDocument({...document, format: 'other'})).toThrow('类型无效');
        expect(() => parseModelUsageTransferDocument({...document, events: null})).toThrow('events 必须是数组');
        expect(() => parseModelUsageTransferDocument({...document, events: [null]})).toThrow('导入事件 1 必须是对象');
        expect(() => parseModelUsageTransferDocument({
            ...document,
            events: [{...event, id: '  '}],
        })).toThrow('稳定 id');
        expect(() => parseModelUsageTransferDocument({
            ...document,
            events: [{...event, schemaVersion: 2}],
        })).toThrow('导入事件 1 版本');

        const tooManyEvents = new Array(250_001);
        expect(() => parseModelUsageTransferDocument({...document, events: tooManyEvents}))
            .toThrow('最多包含 250000 条事件');

        const nullPrototypeEvent = Object.assign(Object.create(null), event);
        const nullPrototypeDocument = Object.assign(Object.create(null), {
            ...document,
            events: [nullPrototypeEvent],
        });
        expect(parseModelUsageTransferDocument(nullPrototypeDocument).events)
            .toEqual([expect.objectContaining({id: 'portable-validation'})]);
    });

    it('导入在序列化失败或超过 128 MiB 时早期拒绝', () => {
        const cyclic = {
            format: 'fluentread-model-usage',
            version: 1,
            exportedAt: 2_000,
            events: [] as unknown[],
        };
        cyclic.events.push(cyclic);
        expect(() => parseModelUsageTransferDocument(cyclic)).toThrow('无法序列化');

        const encode = vi.spyOn(TextEncoder.prototype, 'encode')
            .mockReturnValue({byteLength: 128 * 1024 * 1024 + 1} as Uint8Array);
        expect(() => parseModelUsageTransferDocument({
            format: 'fluentread-model-usage',
            version: 1,
            exportedAt: 2_000,
            events: [],
        })).toThrow('超过 128 MiB 上限');
        encode.mockRestore();
    });

    it('导出在事件数或序列化体积超限时拒绝且校验导出时间', async () => {
        const repository = createRepository('export-limits');
        const orderBy = vi.spyOn(repository.database.events, 'orderBy');
        orderBy.mockReturnValueOnce({
            toArray: async () => ({length: 250_001}),
        } as never);
        await expect(repository.exportData(2_000)).rejects.toThrow('单次最多导出 250000 条事件');

        orderBy.mockReturnValueOnce({
            toArray: async () => [],
        } as never);
        const encode = vi.spyOn(TextEncoder.prototype, 'encode')
            .mockReturnValue({byteLength: 128 * 1024 * 1024 + 1} as Uint8Array);
        await expect(repository.exportData(2_000)).rejects.toThrow('导出文件超过 128 MiB 上限');
        encode.mockRestore();

        await expect(repository.exportData(-1)).rejects.toThrow('exportedAt');
    });

    it('clear 只清当前模型用量库，不影响另一个仓库', async () => {
        const target = createRepository('target');
        const untouched = createRepository('untouched');
        const inFlightGeneration = target.captureGeneration();
        await target.recordMany([usageEvent({id: 'target-event'})]);
        await untouched.recordMany([usageEvent({id: 'untouched-event'})]);

        await target.clear();

        await expect(target.database.events.count()).resolves.toBe(0);
        await expect(untouched.database.events.count()).resolves.toBe(1);
        await expect(target.recordMany([
            usageEvent({id: 'finished-after-reset'}),
        ], inFlightGeneration)).resolves.toBe(0);
        await expect(target.database.events.count()).resolves.toBe(0);

        const currentGeneration = target.captureGeneration();
        expect(currentGeneration).not.toBe(inFlightGeneration);
        await expect(target.recordMany([
            usageEvent({id: 'started-after-reset'}),
        ], currentGeneration)).resolves.toBe(1);
        await expect(target.database.events.count()).resolves.toBe(1);

        const racing = createRepository('reset-race');
        const racingGeneration = racing.captureGeneration();
        const originalBulkGet = racing.database.events.bulkGet.bind(racing.database.events);
        let clearPromise: Promise<void> | undefined;
        vi.spyOn(racing.database.events, 'bulkGet').mockImplementationOnce((keys) => {
            clearPromise = racing.clear();
            return originalBulkGet(keys);
        });
        await expect(racing.recordMany([
            usageEvent({id: 'raced-finish'}),
        ], racingGeneration)).resolves.toBe(0);
        await clearPromise;
        await expect(racing.database.events.count()).resolves.toBe(0);
    });

    it('严格拒绝非法枚举、时间、状态码和非整数 Token', async () => {
        const repository = createRepository('validation');
        expect(() => normalizeStoredModelUsageEvent(null as never)).toThrow('必须是对象');
        expect(() => normalizeStoredModelUsageEvent([] as never)).toThrow('必须是对象');
        expect(() => normalizeStoredModelUsageEvent({...usageEvent(), schemaVersion: 2 as never}))
            .toThrow('版本');
        await expect(repository.recordMany([{...usageEvent(), purpose: 'billing' as never}]))
            .rejects.toThrow('purpose');
        await expect(repository.recordMany([{...usageEvent(), outcome: 'pending' as never}]))
            .rejects.toThrow('outcome');
        await expect(repository.recordMany([{...usageEvent(), usageAvailability: 'partial' as never}]))
            .rejects.toThrow('usageAvailability');
        await expect(repository.recordMany([{...usageEvent(), totalTokens: undefined}]))
            .rejects.toThrow('必须包含输入、输出和总 Token');
        await expect(repository.recordMany([{...usageEvent(), usageAvailability: 'unreported'}]))
            .rejects.toThrow('不能携带 Token');
        await expect(repository.recordMany([{...usageEvent(), durationMs: Number.NaN}]))
            .rejects.toThrow('durationMs');
        await expect(repository.recordMany([{...usageEvent(), startedAt: MAX_DATE_PLUS_ONE}]))
            .rejects.toThrow('startedAt');
        await expect(repository.recordMany([{...usageEvent(), statusCode: 999}]))
            .rejects.toThrow('statusCode');
        await expect(repository.recordMany([{...usageEvent(), totalTokens: 1.5}]))
            .rejects.toThrow('totalTokens');
        await expect(repository.recordMany([{...usageEvent(), inputTokens: 10, cachedInputTokens: 8, cacheWriteTokens: 3}]))
            .rejects.toThrow('缓存 Token');
        await expect(repository.recordMany([{...usageEvent(), serviceId: 42 as never}]))
            .rejects.toThrow('serviceId');
        await expect(repository.recordMany([{...usageEvent(), serviceId: '\u0000  '}]))
            .rejects.toThrow('不能为空');
        await expect(repository.recordMany([{...usageEvent(), id: 42 as never}]))
            .rejects.toThrow('id 必须是字符串');
        await expect(repository.recordMany([{...usageEvent(), id: 'invalid id'}]))
            .rejects.toThrow('id 格式');
        await expect(repository.database.events.count()).resolves.toBe(0);
    });

    it('保存全部可选数值字段并处理空库、损坏维度键', async () => {
        const empty = createRepository('empty-dashboard');
        const emptySnapshot = await empty.getDashboard({range: '30d'}, new Date(2026, 7, 29).getTime());
        expect(emptySnapshot.recordingStartedAt).toBeNull();
        expect(emptySnapshot.dimensions).toEqual([]);

        const repository = createRepository('optional-fields');
        await repository.recordMany([usageEvent({
            id: 'all-optionals',
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            statusCode: 429,
        })]);
        await expect(repository.database.events.get('all-optionals')).resolves.toMatchObject({
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            statusCode: 429,
        });

        const originalOrderBy = repository.database.events.orderBy.bind(repository.database.events);
        vi.spyOn(repository.database.events, 'orderBy').mockImplementation((index: string | string[]) => {
            if (index === '[serviceId+model]') {
                return {uniqueKeys: async () => ['invalid', [42, 'model'], ['service'], ['moonshot', 'kimi-k2.6']]} as never;
            }
            return originalOrderBy(index);
        });
        const snapshot = await repository.getDashboard({range: 'today'}, new Date(2026, 7, 29, 12).getTime());
        expect(snapshot.dimensions).toEqual([{serviceId: 'moonshot', models: ['kimi-k2.6']}]);
    });
});

const MAX_DATE_PLUS_ONE = 8_640_000_000_000_001;
