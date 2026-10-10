import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const browserMock = vi.hoisted(() => ({storage: {onChanged: {addListener: vi.fn(), removeListener: vi.fn()}}}));
vi.mock('webextension-polyfill', () => ({default: browserMock}));
import {
    CHROME_TRANSLATION_PREPARATION_STORAGE_KEY,
    CHROME_TRANSLATION_PREPARATION_STORAGE_PREFIX,
    createChromeTranslationPreparationStore,
    isChromeTranslationPreparationRequest,
    type ChromeTranslationPreparationStorageArea,
} from '@/src/platform/browser/chromeTranslationPreparationRequest';

const originalStorage = browserMock.storage;
const en = {sourceLanguage: 'en', targetLanguage: 'zh'};
const ja = {sourceLanguage: 'ja', targetLanguage: 'zh'};
const fr = {sourceLanguage: 'fr', targetLanguage: 'zh'};
const key = (source: string, target = 'zh') => `${CHROME_TRANSLATION_PREPARATION_STORAGE_PREFIX}${source}:${target}`;
const record = (sourceLanguage: string, updatedAt: number) => ({sourceLanguage, targetLanguage: 'zh', updatedAt});

function area() {
    const values: Record<string, unknown> = {};
    return {
        values,
        get: vi.fn(async () => ({...values})),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
        remove: vi.fn(async (keys: string | string[]) => {
            for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
        }),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return {promise, resolve};
}

function handler() {
    return originalStorage.onChanged.addListener.mock.calls.at(-1)?.[0] as (changes: Record<string, unknown>, area: string) => void;
}

async function flushReads() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function replaceStorage(value: unknown) {
    Object.defineProperty(browserMock, 'storage', {configurable: true, writable: true, value});
}

describe('Chrome translation preparation request store', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        replaceStorage(originalStorage);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        replaceStorage(originalStorage);
    });

    it('validates concrete pairs and rejects auto, same language, aliases and malformed values', () => {
        expect(isChromeTranslationPreparationRequest(en)).toBe(true);
        for (const value of [
            null, 1, [], {},
            {sourceLanguage: 1, targetLanguage: 'zh'},
            {sourceLanguage: 'auto', targetLanguage: 'zh'},
            {sourceLanguage: 'AUTO', targetLanguage: 'zh'},
            {sourceLanguage: 'en', targetLanguage: 'auto'},
            {sourceLanguage: 'en', targetLanguage: 'EN'},
            {sourceLanguage: 'zh-CN', targetLanguage: 'zh-Hans'},
            {sourceLanguage: 'zh-TW', targetLanguage: 'zh-Hant'},
            {sourceLanguage: 'en', targetLanguage: 'bad value'},
        ]) expect(isChromeTranslationPreparationRequest(value)).toBe(false);
    });

    it('stores canonical pairs independently and selects the most recently updated request', async () => {
        const mocked = area();
        const store = createChromeTranslationPreparationStore(mocked);
        const now = vi.spyOn(Date, 'now').mockReturnValue(100);
        await store.set({sourceLanguage: ' EN ', targetLanguage: 'zh-Hans'});
        expect(mocked.values).toEqual({[key('en')]: {...en, updatedAt: 100}});
        now.mockReturnValue(200);
        await store.set(ja);
        await expect(store.get()).resolves.toEqual(ja);
        expect(Object.keys(mocked.values)).toHaveLength(2);
        now.mockReturnValue(300);
        await store.set(en);
        await expect(store.get()).resolves.toEqual(en);
        await store.set({sourceLanguage: 'ZH-tw', targetLanguage: 'EN'});
        expect(mocked.values[key('zh-Hant', 'en')]).toEqual({sourceLanguage: 'zh-Hant', targetLanguage: 'en', updatedAt: 300});
        await store.clear({sourceLanguage: 'zh-HK', targetLanguage: 'en'});
        expect(mocked.values[key('zh-Hant', 'en')]).toBeUndefined();
        await expect(store.get()).resolves.toEqual(en);
    });

    it('ignores malformed entries and breaks equal-time ties consistently across entry orders', async () => {
        const mocked = area();
        const store = createChromeTranslationPreparationStore(mocked);
        Object.assign(mocked.values, {
            unrelated: record('ru', 1000),
            [CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]: record('fr', 1000),
            [key('bad')]: null,
            [key('de')]: record('en', 1000),
            [key('ru')]: {...record('ru', 1), updatedAt: '1000'},
            [key('ko')]: record('ko', Number.NaN),
            [key('es')]: record('es', Number.POSITIVE_INFINITY),
            [key('it')]: record('it', -1),
            [key('en')]: record('en', 100),
            [key('ja')]: record('ja', 100),
            [key('fr')]: record('fr', 100),
            [key('pt')]: record('pt', 99),
        });
        await expect(store.get()).resolves.toEqual(ja);
        mocked.get.mockResolvedValueOnce(Object.fromEntries(Object.entries(mocked.values).reverse()));
        await expect(store.get()).resolves.toEqual(ja);
    });

    it('clears only the requested pair without reading another pair or deleting unrelated state', async () => {
        const mocked = area();
        const store = createChromeTranslationPreparationStore(mocked);
        await store.set(en);
        await store.set(ja);
        await store.clear(en);
        expect(mocked.get).not.toHaveBeenCalled();
        expect(mocked.remove).toHaveBeenCalledWith(key('en'));
        await expect(store.get()).resolves.toEqual(ja);
        await store.clear(fr);
        expect(mocked.values[key('ja')]).toBeDefined();
        mocked.remove.mockClear();
        await store.clear({sourceLanguage: 'auto', targetLanguage: 'zh'});
        expect(mocked.remove).not.toHaveBeenCalled();
    });

    it('preserves a newer pair written by a second context while the first context clears its prepared pair', async () => {
        const mocked = area();
        const optionsStore = createChromeTranslationPreparationStore(mocked);
        const backgroundStore = createChromeTranslationPreparationStore(mocked);
        await backgroundStore.set(en);
        const removal = deferred<void>();
        mocked.remove.mockImplementationOnce(async (storageKey) => {
            await removal.promise;
            delete mocked.values[storageKey as string];
        });
        const clearing = optionsStore.clear(en);
        await backgroundStore.set(ja);
        expect(mocked.values[key('ja')]).toBeDefined();
        removal.resolve();
        await clearing;
        await expect(optionsStore.get()).resolves.toEqual(ja);
        expect(mocked.values[key('en')]).toBeUndefined();
    });

    it('clears existing preparation keys while preserving unrelated keys and a concurrent new pair', async () => {
        const mocked = area();
        const optionsStore = createChromeTranslationPreparationStore(mocked);
        const backgroundStore = createChromeTranslationPreparationStore(mocked);
        mocked.values.unrelated = 'keep';
        await backgroundStore.set(en);
        const snapshot = {...mocked.values};
        const pendingRead = deferred<Record<string, unknown>>();
        mocked.get.mockReturnValueOnce(pendingRead.promise);
        const clearing = optionsStore.clear();
        await backgroundStore.set(ja);
        pendingRead.resolve(snapshot);
        await clearing;
        expect(mocked.remove).toHaveBeenCalledWith([key('en')]);
        expect(mocked.values.unrelated).toBe('keep');
        await expect(optionsStore.get()).resolves.toEqual(ja);
        await optionsStore.clear();
        expect(mocked.values).toEqual({unrelated: 'keep'});
        mocked.remove.mockClear();
        await optionsStore.clear();
        expect(mocked.remove).not.toHaveBeenCalled();
        await expect(optionsStore.get()).resolves.toBeNull();
    });

    it('reads the latest complete state for relevant session changes and falls back after a pair is removed', async () => {
        const mocked = area();
        const store = createChromeTranslationPreparationStore(mocked);
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        const change = handler();
        change({[key('en')]: {}}, 'local');
        change({}, 'session');
        change({other: {}, [CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]: {}}, 'session');
        expect(mocked.get).not.toHaveBeenCalled();
        mocked.values[key('en')] = record('en', 100);
        mocked.values[key('ja')] = record('ja', 200);
        change({[key('en')]: {newValue: null}}, 'session');
        await flushReads();
        expect(listener).toHaveBeenLastCalledWith(ja);
        delete mocked.values[key('ja')];
        change({[key('ja')]: {}}, 'session');
        await flushReads();
        expect(listener).toHaveBeenLastCalledWith(en);
        delete mocked.values[key('en')];
        change({[key('en')]: {}}, 'session');
        await flushReads();
        expect(listener).toHaveBeenLastCalledWith(null);
        unsubscribe();
        expect(originalStorage.onChanged.removeListener).toHaveBeenCalledWith(change);
    });

    it('suppresses stale asynchronous reads and all callbacks after unsubscription', async () => {
        const mocked = area();
        const first = deferred<Record<string, unknown>>();
        const second = deferred<Record<string, unknown>>();
        const third = deferred<Record<string, unknown>>();
        mocked.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
        const listener = vi.fn();
        const unsubscribe = createChromeTranslationPreparationStore(mocked).subscribe(listener);
        const change = handler();
        change({[key('en')]: {}}, 'session');
        change({[key('ja')]: {}}, 'session');
        second.resolve({[key('ja')]: record('ja', 200)});
        await flushReads();
        first.resolve({[key('en')]: record('en', 100)});
        await flushReads();
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(ja);
        change({[key('fr')]: {}}, 'session');
        unsubscribe();
        third.resolve({[key('fr')]: record('fr', 300)});
        await flushReads();
        change({[key('en')]: {}}, 'session');
        expect(listener).toHaveBeenCalledOnce();
        expect(mocked.get).toHaveBeenCalledTimes(3);
    });

    it('quietly handles unavailable, malformed and failing storage operations', async () => {
        Object.defineProperty(browserMock, 'storage', {configurable: true, get: () => { throw new Error('storage blocked'); }});
        const blocked = createChromeTranslationPreparationStore();
        await expect(blocked.get()).resolves.toBeNull();
        blocked.subscribe(vi.fn())();
        replaceStorage(undefined);
        const unavailable = createChromeTranslationPreparationStore();
        await expect(unavailable.get()).resolves.toBeNull();
        await expect(unavailable.set(en)).resolves.toBeUndefined();
        await expect(unavailable.clear()).resolves.toBeUndefined();
        unavailable.subscribe(vi.fn())();
        replaceStorage(originalStorage);
        await expect(createChromeTranslationPreparationStore().get()).resolves.toBeNull();
        const partial = createChromeTranslationPreparationStore({} as ChromeTranslationPreparationStorageArea);
        await expect(partial.get()).resolves.toBeNull();
        await expect(partial.set(en)).resolves.toBeUndefined();
        await expect(partial.clear(en)).resolves.toBeUndefined();
        const mocked = area();
        const store = createChromeTranslationPreparationStore(mocked);
        mocked.get.mockResolvedValueOnce(null as unknown as Record<string, unknown>);
        await expect(store.get()).resolves.toBeNull();
        mocked.get.mockRejectedValue(new Error('read failed'));
        mocked.set.mockRejectedValue(new Error('write failed'));
        mocked.remove.mockRejectedValue(new Error('remove failed'));
        await expect(store.get()).resolves.toBeNull();
        await expect(store.set(en)).resolves.toBeUndefined();
        await expect(store.clear()).resolves.toBeUndefined();
        await expect(store.clear(en)).resolves.toBeUndefined();
        await expect(store.set({sourceLanguage: 'auto', targetLanguage: 'zh'})).resolves.toBeUndefined();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        handler()({[key('en')]: {}}, 'session');
        await flushReads();
        expect(listener).toHaveBeenCalledWith(null);
        unsubscribe();
    });

    it('contains subscriber failures and degrades if change-event registration or removal is unavailable', async () => {
        const mocked = area();
        const listener = vi.fn(() => { throw new Error('display failed'); });
        const unsubscribe = createChromeTranslationPreparationStore(mocked).subscribe(listener);
        handler()({[key('en')]: {}}, 'session');
        await flushReads();
        expect(listener).toHaveBeenCalledOnce();
        originalStorage.onChanged.removeListener.mockImplementationOnce(() => { throw new Error('remove failed'); });
        expect(unsubscribe).not.toThrow();
        originalStorage.onChanged.addListener.mockImplementationOnce(() => { throw new Error('registration failed'); });
        createChromeTranslationPreparationStore(mocked).subscribe(vi.fn())();
        replaceStorage({});
        createChromeTranslationPreparationStore().subscribe(vi.fn())();
        replaceStorage({onChanged: {}});
        createChromeTranslationPreparationStore().subscribe(vi.fn())();
        replaceStorage({session: mocked, onChanged: {addListener: vi.fn()}});
        await expect(createChromeTranslationPreparationStore().get()).resolves.toBeNull();
        createChromeTranslationPreparationStore().subscribe(vi.fn())();
    });
});

it('简繁转换的两个方向保存在独立会话键，脚本优先于冲突地区', async () => {
    const mocked = area();
    const store = createChromeTranslationPreparationStore(mocked);
    await store.set({sourceLanguage: 'zh-Hans-HK', targetLanguage: 'zh-Hant-CN'});
    await store.set({sourceLanguage: 'zh-Hant', targetLanguage: 'zh-Hans'});
    expect(Object.keys(mocked.values).sort()).toEqual([key('zh', 'zh-Hant'), key('zh-Hant', 'zh')].sort());
    await store.clear({sourceLanguage: 'zh-Hans', targetLanguage: 'zh-Hant'});
    expect(Object.keys(mocked.values)).toEqual([key('zh-Hant', 'zh')]);
});
