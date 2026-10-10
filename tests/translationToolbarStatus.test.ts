import {describe, expect, it} from 'vitest';
import {countFullPageTranslationWork, normalizeTranslationToolbarStatus, resolveTranslationToolbarStatus} from '@/src/features/full-page-translation/toolbarStatus';
describe('工具栏真实翻译结果', () => {
    it('未知或旧版本状态不能变成成功', () => {
        for (const value of [null, undefined, true, {}, 'success', 'idle']) expect(normalizeTranslationToolbarStatus(value)).toBe('idle');
        for (const value of ['translated', 'translating', 'error']) expect(normalizeTranslationToolbarStatus(value)).toBe(value);
    });
    it('队列和重试等待优先，部分失败保留错误，空页面没有成功勾', () => {
        expect(resolveTranslationToolbarStatus(true, ['translated'])).toBe('translating');
        expect(resolveTranslationToolbarStatus(false, ['error', 'loading'])).toBe('translating');
        expect(resolveTranslationToolbarStatus(false, ['translated', 'error'])).toBe('error');
        expect(resolveTranslationToolbarStatus(false, ['error'])).toBe('error');
        expect(resolveTranslationToolbarStatus(false, ['', 'translated'])).toBe('translated');
        expect(resolveTranslationToolbarStatus(false, [])).toBe('idle');
    });
    it('同 key 新候选不会被旧在途请求扣除，离屏与排队计数互斥', () => {
        const old = {}, next = {};
        expect(countFullPageTranslationWork(new Map([[1, old]]), new Map([[1, old], [2, next]]), 0)).toEqual({running: 1, queued: 0, offscreen: 1});
        expect(countFullPageTranslationWork(new Map([[1, old]]), new Map([[1, next]]), 1)).toEqual({running: 1, queued: 1, offscreen: 0});
        expect(countFullPageTranslationWork(new Map([[1, old]]), new Map(), 1)).toEqual({running: 1, queued: 0, offscreen: 0});
    });
});
