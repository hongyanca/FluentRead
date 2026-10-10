import {describe, expect, it, vi} from 'vitest';
const storage=vi.hoisted(()=>({getItem:vi.fn(async()=>[]),setItem:vi.fn(async()=>undefined)}));
vi.mock('@wxt-dev/storage',()=>({storage}));
import {visionProbeStorage, VISION_PROBE_STORAGE_KEY} from '@/src/platform/storage/visionProbeStorage';
describe('本地识图结论存储',()=>{
    it('独立键读写最小能力记录，不进入用户配置',async()=>{
        expect(VISION_PROBE_STORAGE_KEY).toBe('local:modelVisionProbe:v1');
        await expect(visionProbeStorage.load()).resolves.toEqual([]);
        const records=[{identity:'a'.repeat(64),capability:'supported' as const,checkedAt:100}];
        await visionProbeStorage.save(records);
        expect(storage.getItem).toHaveBeenCalledWith(VISION_PROBE_STORAGE_KEY);
        expect(storage.setItem).toHaveBeenCalledWith(VISION_PROBE_STORAGE_KEY,records);
    });
});
