import {describe, expect, it, vi} from 'vitest';
import {
    MODEL_USAGE_MESSAGE_TYPE,
    createModelUsageHandler,
    parseModelUsageFilter,
    parseModelUsageRequestQuery,
    type ModelUsageRepositoryContract,
} from '@/src/app/background/handlers/modelUsage';
import {emptyModelUsageTotals} from '@/src/services/model-usage/aggregation';
import type {
    DashboardSnapshot,
    Filter,
    ModelUsageRequestPage,
    ModelUsageTransferDocument,
} from '@/src/services/model-usage/types';

const trustedContext = {sender: {url: 'chrome-extension://fluentread/options.html'}};
const untrustedContext = {sender: {url: 'https://example.com/article'}};
const isOptionsUrl = (url: string) => url.startsWith('chrome-extension://fluentread/options.html');

function snapshot(filter: Filter): DashboardSnapshot {
    const totals = emptyModelUsageTotals();
    return {
        generatedAt: 1_000,
        recordingStartedAt: null,
        dimensions: [],
        metrics: {today: totals, sevenDays: totals, thirtyDays: totals},
        selected: {filter, totals},
        timeline: [],
        breakdown: [],
    };
}

function createRepository(): ModelUsageRepositoryContract & {
    getDashboard: ReturnType<typeof vi.fn>;
    getRequestLog: ReturnType<typeof vi.fn>;
    exportData: ReturnType<typeof vi.fn>;
    importData: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
} {
    return {
        getDashboard: vi.fn(async (filter: Filter) => snapshot(filter)),
        getRequestLog: vi.fn(async (query): Promise<ModelUsageRequestPage> => ({
            generatedAt: 1_000,
            filter: query.filter,
            items: [],
            totalCount: 0,
            nextCursor: null,
        })),
        exportData: vi.fn(async (): Promise<ModelUsageTransferDocument> => ({
            format: 'fluentread-model-usage',
            version: 1,
            exportedAt: 1_000,
            events: [],
        })),
        importData: vi.fn(async () => ({receivedCount: 2, importedCount: 1, duplicateCount: 1})),
        clear: vi.fn(async () => undefined),
    };
}

function handler(repository = createRepository()) {
    return createModelUsageHandler(repository, isOptionsUrl);
}

describe('模型用量后台 handler', () => {
    it('query 默认查询三十日，并返回类型化 dashboard 数据', async () => {
        const repository = createRepository();
        const target = handler(repository);

        const response = await target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
        }, trustedContext);

        expect(target.type).toBe('modelUsage');
        expect(repository.getDashboard).toHaveBeenCalledWith({range: '30d'});
        expect(response).toEqual({success: true, data: snapshot({range: '30d'})});
    });

    it('query 收窄并清理服务、模型筛选文本', async () => {
        const repository = createRepository();
        const target = handler(repository);

        const response = await target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: '7d', serviceId: ' moonshot ', model: ' kimi-k3 '},
        }, trustedContext);

        const filter = {range: '7d', serviceId: 'moonshot', model: 'kimi-k3'} as const;
        expect(repository.getDashboard).toHaveBeenCalledWith(filter);
        expect(response).toEqual({success: true, data: snapshot(filter)});

        await target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: 'today', model: 'kimi-k3'},
        }, trustedContext);
        expect(repository.getDashboard).toHaveBeenLastCalledWith({range: 'today', model: 'kimi-k3'});
    });

    it('reset 只委托仓库 clear 并返回明确确认', async () => {
        const repository = createRepository();
        const response = await handler(repository).handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'reset',
        }, trustedContext);

        expect(repository.clear).toHaveBeenCalledOnce();
        expect(repository.getDashboard).not.toHaveBeenCalled();
        expect(response).toEqual({success: true, data: {cleared: true}});
    });

    it('list 校验用途、状态、缓存和游标后委托稳定分页查询', async () => {
        const repository = createRepository();
        const target = handler(repository);
        const query = {
            filter: {
                range: '7d',
                serviceId: ' moonshot ',
                purpose: 'translation',
                outcome: 'timeout',
                cacheStatus: 'hit',
            },
            cursor: {startedAt: 1_000, id: 'request-2'},
            limit: 20,
        };

        const response = await target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'list',
            query,
        }, trustedContext);

        expect(repository.getRequestLog).toHaveBeenCalledWith({
            filter: {
                range: '7d',
                serviceId: 'moonshot',
                purpose: 'translation',
                outcome: 'timeout',
                cacheStatus: 'hit',
            },
            cursor: {startedAt: 1_000, id: 'request-2'},
            limit: 20,
        });
        expect(response).toMatchObject({success: true, data: {totalCount: 0}});
        expect(parseModelUsageRequestQuery(undefined)).toEqual({filter: {range: '30d'}});
        expect(() => parseModelUsageRequestQuery({filter: {range: '30d'}, limit: 101})).toThrow('1-100');
        expect(() => parseModelUsageRequestQuery({filter: {range: '30d', purpose: 'billing'}})).toThrow('purpose');
        expect(() => parseModelUsageRequestQuery({filter: {range: '30d', cacheStatus: 'unknown'}})).toThrow('cacheStatus');
        expect(() => parseModelUsageRequestQuery({filter: {range: '30d'}, cursor: {startedAt: 1, id: 'bad id'}})).toThrow('id');
    });

    it('list 在省略 query、游标和页大小时使用默认查询', async () => {
        const repository = createRepository();
        const target = handler(repository);

        await expect(target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'list',
        }, trustedContext)).resolves.toMatchObject({success: true, data: {totalCount: 0}});

        expect(repository.getRequestLog).toHaveBeenCalledWith({filter: {range: '30d'}});
        expect(parseModelUsageRequestQuery({})).toEqual({filter: {range: '30d'}});
    });

    it('拒绝非对象请求查询、非对象游标和所有非法 startedAt 边界', () => {
        for (const query of [null, [], 'query']) {
            expect(() => parseModelUsageRequestQuery(query)).toThrow('请求查询必须是对象');
        }
        for (const cursor of [null, [], 'cursor']) {
            expect(() => parseModelUsageRequestQuery({cursor})).toThrow('请求游标必须是对象');
        }
        for (const startedAt of ['1000', Number.NaN, Number.POSITIVE_INFINITY, -1, 8_640_000_000_000_001]) {
            expect(() => parseModelUsageRequestQuery({cursor: {startedAt, id: 'request-1'}}))
                .toThrow('startedAt 无效');
        }
    });

    it('拒绝游标 id 与页大小的其余非法形态', () => {
        for (const id of [42, '', 'x'.repeat(201)]) {
            expect(() => parseModelUsageRequestQuery({cursor: {startedAt: 1_000, id}})).toThrow('id 无效');
        }
        for (const limit of [1.5, 0]) {
            expect(() => parseModelUsageRequestQuery({limit})).toThrow('limit 必须是 1-100 的整数');
        }
    });

    it('export/import 返回版本化迁移结果且不经过 dashboard', async () => {
        const repository = createRepository();
        const target = handler(repository);
        const document = await repository.exportData();

        await expect(target.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'export'}, trustedContext))
            .resolves.toEqual({success: true, data: document});
        await expect(target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'import',
            document,
        }, trustedContext)).resolves.toEqual({
            success: true,
            data: {receivedCount: 2, importedCount: 1, duplicateCount: 1},
        });
        expect(repository.importData).toHaveBeenCalledWith(document);
        expect(repository.getDashboard).not.toHaveBeenCalled();
    });

    it('只允许 Options 扩展页读取或修改模型用量', async () => {
        const repository = createRepository();
        const target = handler(repository);

        for (const context of [untrustedContext, {}, {sender: {url: 'chrome-extension://fluentread/popup.html'}}]) {
            await expect(target.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'query'}, context))
                .resolves.toEqual({success: false, error: '当前上下文无权访问模型用量数据'});
        }
        expect(repository.getDashboard).not.toHaveBeenCalled();
        expect(repository.clear).not.toHaveBeenCalled();
    });

    it('拒绝未知动作、非法 range、空筛选值与非普通对象', async () => {
        const repository = createRepository();
        const target = handler(repository);

        await expect(target.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'unsupported'}, trustedContext))
            .resolves.toEqual({success: false, error: '不支持的模型用量操作'});
        await expect(target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: '365d'},
        }, trustedContext)).resolves.toMatchObject({success: false, error: expect.stringContaining('range')});
        await expect(target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: 'today', serviceId: '   '},
        }, trustedContext)).resolves.toMatchObject({success: false, error: expect.stringContaining('serviceId')});
        await expect(target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: 'today', serviceId: 42},
        }, trustedContext)).resolves.toMatchObject({success: false, error: expect.stringContaining('必须是字符串')});
        await expect(target.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: [],
        }, trustedContext)).resolves.toMatchObject({success: false, error: expect.stringContaining('必须是对象')});
        expect(repository.getDashboard).not.toHaveBeenCalled();
    });

    it('把仓库查询与清理失败转换为可传输错误响应', async () => {
        const repository = createRepository();
        repository.getDashboard.mockRejectedValueOnce(new Error('IndexedDB query blocked'));
        repository.clear.mockRejectedValueOnce(new Error('IndexedDB clear blocked'));
        const target = handler(repository);

        await expect(target.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'query'}, trustedContext))
            .resolves.toEqual({success: false, error: 'IndexedDB query blocked'});
        await expect(target.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'reset'}, trustedContext))
            .resolves.toEqual({success: false, error: 'IndexedDB clear blocked'});

        repository.getDashboard.mockRejectedValueOnce(null);
        await expect(target.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'query'}, trustedContext))
            .resolves.toEqual({success: false, error: '模型用量统计暂时不可用'});
    });

    it('公开筛选解析器保留 null prototype 对象并拒绝超长文本', () => {
        const filter = Object.assign(Object.create(null), {range: 'today', serviceId: 'moonshot'});
        expect(parseModelUsageFilter(filter)).toEqual({range: 'today', serviceId: 'moonshot'});
        expect(() => parseModelUsageFilter({range: 'today', model: 'x'.repeat(201)})).toThrow('model');
    });
});
