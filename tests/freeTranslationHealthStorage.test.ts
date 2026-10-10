import {describe, expect, it, vi} from 'vitest';
const {getItem, setItem} = vi.hoisted(() => ({getItem: vi.fn(), setItem: vi.fn()}));
vi.mock('@wxt-dev/storage', () => ({storage: {getItem, setItem}}));
import {freeTranslationHealthStorage, FREE_TRANSLATION_HEALTH_STORAGE_KEY} from '@/src/platform/storage/freeTranslationHealthStorage';

describe('private anonymous provider health storage port', () => {
    it('round trips only the caller health snapshot under an independent local key', async () => {
        const entries = [{identity: 'microsoft:hash', retryAt: 1000, failures: 2, category: 'rate-limit' as const}];
        getItem.mockResolvedValue(entries);
        await expect(freeTranslationHealthStorage.load()).resolves.toBe(entries);
        expect(getItem).toHaveBeenCalledWith(FREE_TRANSLATION_HEALTH_STORAGE_KEY);
        await freeTranslationHealthStorage.save(entries);
        expect(setItem).toHaveBeenCalledWith('local:freeTranslationHealth:v1', entries);
    });
});
