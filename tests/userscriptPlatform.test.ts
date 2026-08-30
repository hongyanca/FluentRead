import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CONFIG_COUNT_INCREMENT_MESSAGE} from '@/src/services/config/count';

const mocks = vi.hoisted(() => ({
    config: {count: 0},
    saveConfig: vi.fn(),
    incrementUserscriptConfigCount: vi.fn(),
    applyConfigHistoryAction: vi.fn(),
    runTranslationServiceConnectionTest: vi.fn(),
    translateMicrosoftTexts: vi.fn(),
    cleanupTranslationCache: vi.fn(),
    clearTranslationCache: vi.fn(),
    translateWithCache: vi.fn(),
    lookupWord: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({
    config: mocks.config,
    configReady: Promise.resolve(),
    CONFIG_HISTORY_MESSAGE: 'configHistoryAction',
    CONFIG_PERSIST_MESSAGE: 'persistConfig',
    saveConfig: mocks.saveConfig,
    applyConfigHistoryAction: mocks.applyConfigHistoryAction,
}));

vi.mock('@/userscript/count', () => ({
    incrementUserscriptConfigCount: mocks.incrementUserscriptConfigCount,
}));

vi.mock('@/src/core/config/constants', () => ({
    CONNECTION_TEST_MESSAGE: 'testTranslationServiceConnection',
}));

vi.mock('@/src/providers/translation/microsoft', () => ({
    translateMicrosoftTexts: mocks.translateMicrosoftTexts,
}));

vi.mock('@/src/providers/translation/connectionTest', () => ({
    runTranslationServiceConnectionTest: mocks.runTranslationServiceConnectionTest,
}));

vi.mock('@/src/app/translation/runtime', () => ({
    cleanupTranslationCache: mocks.cleanupTranslationCache,
    clearTranslationCache: mocks.clearTranslationCache,
    translateWithCache: mocks.translateWithCache,
}));

vi.mock('@/src/features/selection-translation/services/wordDictionary', () => ({
    lookupWord: mocks.lookupWord,
}));

import {createPlatformMessageHandler} from '@/userscript/platform';

describe('userscript 平台消息适配', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.config.count = 0;
        mocks.saveConfig.mockResolvedValue(undefined);
        mocks.incrementUserscriptConfigCount.mockResolvedValue(14);
    });

    it('通过 userscript 专用副本累加，并只把权威总数投影到共享配置', async () => {
        mocks.config.count = 12;
        const handler = createPlatformMessageHandler(vi.fn());

        await expect(handler({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 2,
            operationId: 'userscript-operation-1',
        })).resolves.toEqual({
            success: true,
            count: 14,
        });
        expect(mocks.incrementUserscriptConfigCount).toHaveBeenCalledWith(2, 'userscript-operation-1');
        expect(mocks.saveConfig).toHaveBeenCalledOnce();
        expect(mocks.saveConfig).toHaveBeenCalledWith(mocks.config);
        expect(mocks.config.count).toBe(14);
    });

    it('拒绝无效计数增量或 operationId，且不写专用副本', async () => {
        const handler = createPlatformMessageHandler(vi.fn());

        await expect(handler({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 0,
            operationId: 'userscript-operation-2',
        })).resolves.toEqual({
            success: false,
            error: '无效的翻译计数增量',
        });
        await expect(handler({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 1,
            operationId: 'bad id',
        })).resolves.toEqual({
            success: false,
            error: '无效的翻译计数操作标识',
        });
        expect(mocks.incrementUserscriptConfigCount).not.toHaveBeenCalled();
        expect(mocks.saveConfig).not.toHaveBeenCalled();
    });
});
