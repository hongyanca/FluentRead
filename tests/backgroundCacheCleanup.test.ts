import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({cleanupTranslationCache: vi.fn()}));

vi.mock('@/src/app/translation/runtime', () => ({
    cleanupTranslationCache: mocks.cleanupTranslationCache,
}));

interface AlarmListener {
    (alarm: {name: string}): void;
}

function browserFixture(existingAlarm?: {name: string}) {
    const listeners: AlarmListener[] = [];
    const create = vi.fn(async () => undefined);
    vi.stubGlobal('browser', {
        alarms: {
            onAlarm: {addListener: (listener: AlarmListener) => listeners.push(listener)},
            get: vi.fn(async () => existingAlarm),
            create,
        },
    });
    return {listeners, create};
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mocks.cleanupTranslationCache.mockReset().mockResolvedValue(undefined);
});

describe('后台翻译缓存维护调度', () => {
    it('worker 启动立即清理并只响应命名 alarm，缺失任务时创建每日维护', async () => {
        const fixture = browserFixture();
        const runtime = await import('@/src/app/background/cacheCleanup');

        runtime.installTranslationCacheCleanup();
        await Promise.resolve();
        await Promise.resolve();

        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
        expect(fixture.create).toHaveBeenCalledWith(runtime.TRANSLATION_CACHE_CLEANUP_ALARM, {
            delayInMinutes: 1,
            periodInMinutes: 1440,
        });
        fixture.listeners[0]({name: 'other-alarm'});
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
        fixture.listeners[0]({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledTimes(2);
    });

    it('已有每日维护任务时不重复创建', async () => {
        const runtime = await import('@/src/app/background/cacheCleanup');
        const fixture = browserFixture({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});

        runtime.installTranslationCacheCleanup();
        await Promise.resolve();
        await Promise.resolve();

        expect(fixture.create).not.toHaveBeenCalled();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
    });
});
