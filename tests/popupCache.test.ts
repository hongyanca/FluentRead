import {describe, expect, it, vi} from 'vitest';
import {requestTranslationCacheClear} from '@/src/app/popup/cache';

describe('popup translation cache clear', () => {
    it('只接受后台明确确认的成功响应', async () => {
        const sendMessage = vi.fn(async () => ({success: true}));
        await expect(requestTranslationCacheClear(sendMessage)).resolves.toBeUndefined();
        expect(sendMessage).toHaveBeenCalledWith({type: 'clearTranslationCache'});
    });

    it('保留后台错误并拒绝空响应或发送失败', async () => {
        await expect(requestTranslationCacheClear(async () => ({success: false, error: 'IndexedDB blocked'})))
            .rejects.toThrow('IndexedDB blocked');
        await expect(requestTranslationCacheClear(async () => undefined))
            .rejects.toThrow('后台未确认缓存清理成功');
        await expect(requestTranslationCacheClear(async () => { throw new Error('worker stopped'); }))
            .rejects.toThrow('worker stopped');
        await expect(requestTranslationCacheClear(async () => ({success: false, error: 500})))
            .rejects.toThrow('后台未确认缓存清理成功');
    });
});
