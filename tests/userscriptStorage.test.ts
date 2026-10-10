import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    completeUserscriptConfigPreparation,
    configStorage,
    getStoredValue,
    listStoredKeys,
    removeStoredValue,
    setStoredValue,
} from '@/userscript/storage';

describe('userscript GM storage adapter', () => {
    afterEach(() => {
        globalThis.GM_getValue = undefined;
        globalThis.GM_setValue = undefined;
        globalThis.GM_deleteValue = undefined;
        globalThis.GM_listValues = undefined;
        globalThis.GM = undefined;
    });

    it('persists with Safari Userscripts async GM.* when classic functions are absent', async () => {
        const values = new Map<string, unknown>();
        globalThis.GM = {
            async getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
            async setValue(key, value) { values.set(key, value); },
            async deleteValue(key) { values.delete(key); },
            async listValues() { return [...values.keys()]; },
        };

        await setStoredValue('local:safari', {on: true});
        expect(values.get('local:safari')).toBe('{"on":true}');
        await expect(getStoredValue('local:safari')).resolves.toEqual({on: true});
        await expect(listStoredKeys()).resolves.toEqual(['local:safari']);
        await removeStoredValue('local:safari');
        await expect(listStoredKeys()).resolves.toEqual([]);
    });

    it('serializes objects for legacy GM implementations', async () => {
        const values = new Map<string, unknown>();
        globalThis.GM_getValue = ((key, fallback) => values.has(key) ? values.get(key) : fallback) as NonNullable<typeof globalThis.GM_getValue>;
        globalThis.GM_setValue = (key, value) => { values.set(key, value); };
        globalThis.GM_deleteValue = (key) => { values.delete(key); };
        globalThis.GM_listValues = () => [...values.keys()];

        await setStoredValue('local:config', {service: 'freeTranslation', on: true});
        expect(values.get('local:config')).toBe('{"service":"freeTranslation","on":true}');
        await expect(getStoredValue('local:config')).resolves.toEqual({service: 'freeTranslation', on: true});
        await expect(listStoredKeys()).resolves.toEqual(['local:config']);

        await removeStoredValue('local:config');
        await expect(getStoredValue('local:config')).resolves.toBeNull();
    });

    it('reads plain strings left by the 2024 userscript', async () => {
        globalThis.GM_getValue = ((key, fallback) => key === 'model' ? 'microsoft' : fallback) as NonNullable<typeof globalThis.GM_getValue>;
        await expect(getStoredValue('model')).resolves.toBe('microsoft');
    });

    it('blocks the shared config store until userscript migration has completed', async () => {
        const values = new Map<string, unknown>([
            ['local:config', JSON.stringify({count: 16})],
        ]);
        let reads = 0;
        globalThis.GM_getValue = ((key, fallback) => {
            reads += 1;
            return values.has(key) ? values.get(key) : fallback;
        }) as NonNullable<typeof globalThis.GM_getValue>;
        globalThis.GM_setValue = (key, value) => { values.set(key, value); };

        const changes: unknown[] = [];
        const stopWatching = configStorage.watch('local:config', (value) => changes.push(value));

        const pending = configStorage.getItem<{count: number}>('local:config');
        await Promise.resolve();
        expect(reads).toBe(0);

        completeUserscriptConfigPreparation();
        await expect(pending).resolves.toEqual({count: 16});
        await Promise.resolve();
        await setStoredValue('local:config', {count: 17});
        expect(reads).toBeGreaterThanOrEqual(1);
        expect(changes).toEqual([{count: 17}]);

        stopWatching();
        await setStoredValue('local:config', {count: 18});
        expect(changes).toEqual([{count: 17}]);
        completeUserscriptConfigPreparation();
    });

    it('rejects eager config reads on preparation failure and cancels deferred watches', async () => {
        vi.resetModules();
        const rejectedStorage = await import('@/userscript/storage');
        const rejectedRead = rejectedStorage.configStorage.getItem('local:config');
        const rejectedChanges: unknown[] = [];
        rejectedStorage.configStorage.watch('local:config', (value) => rejectedChanges.push(value));
        rejectedStorage.failUserscriptConfigPreparation(new Error('migration failed'));

        await expect(rejectedRead).rejects.toThrow('migration failed');
        await Promise.resolve();
        await rejectedStorage.setStoredValue('local:config', {count: 1});
        expect(rejectedChanges).toEqual([]);
        rejectedStorage.failUserscriptConfigPreparation(new Error('ignored repeat'));
        rejectedStorage.completeUserscriptConfigPreparation();

        vi.resetModules();
        const cancelledStorage = await import('@/userscript/storage');
        const cancelledChanges: unknown[] = [];
        const cancel = cancelledStorage.configStorage.watch(
            'local:config',
            (value) => cancelledChanges.push(value),
        );
        cancel();
        cancelledStorage.completeUserscriptConfigPreparation();
        await Promise.resolve();
        await cancelledStorage.setStoredValue('local:config', {count: 2});
        expect(cancelledChanges).toEqual([]);
        cancel();
    });
});
