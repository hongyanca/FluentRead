/**
 * @file tests/documentHistory.test.ts
 * 文件职责：验证“最近翻译”的本地存取：稳定标识、摘要列表、恢复、淘汰与存储不可用时的安静降级。
 * 主要内容：使用内存 IndexedDB 真实执行读写；检查列表不含文件字节并按最近更新时间排序，保存的是调用方数据的副本，条数与总字节超限时淘汰最旧记录，过大或没有标识的记录不保存，数据库缺失或出错时返回空结果而不抛出。
 * 模块边界：只测试历史存储服务，不挂载页面、不解析文档、不发起翻译。
 */
import {IDBFactory} from 'fake-indexeddb';
import {describe, expect, it} from 'vitest';
import {createDocumentHistory, documentHistoryId, DOCUMENT_HISTORY_MAX_BYTES, DOCUMENT_HISTORY_MAX_ENTRIES, type DocumentHistoryRecord} from '@/src/features/document-translation/services/history';

const record = (id: string, updatedAt: number, extra: Partial<DocumentHistoryRecord> = {}): DocumentHistoryRecord => ({id, name: `${id}.pdf`, format: 'pdf', size: 3, total: 4, completed: 2, updatedAt,
    bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf', translations: ['甲', '', '丙', ''], fingerprint: 'fp', ...extra});

describe('document history identity', () => {
    it('derives the same short identifier from the same bytes and a different one from different bytes', async () => {
        const first = await documentHistoryId(new Uint8Array([1, 2, 3]));
        expect(first).toMatch(/^[0-9a-f]{32}$/u);
        expect(await documentHistoryId(new Uint8Array([1, 2, 3]))).toBe(first);
        expect(await documentHistoryId(new Uint8Array([1, 2, 4]))).not.toBe(first);
    });
    it('returns an empty identifier when hashing is unavailable or fails', async () => {
        expect(await documentHistoryId(new Uint8Array([1]), null as never)).toBe('');
        expect(await documentHistoryId(new Uint8Array([1]), {digest: async () => {throw new Error('blocked');}})).toBe('');
    });
});

describe('document history storage', () => {
    it('lists summaries newest first without file bytes and restores a full independent copy', async () => {
        const history = createDocumentHistory(new IDBFactory());
        expect(await history.list()).toEqual([]); expect(await history.load('missing')).toBeNull();
        const bytes = new Uint8Array([9, 8, 7]); const translations = ['甲', '乙'];
        expect(await history.save(record('old', 100))).toBe(true);
        expect(await history.save(record('new', 200, {bytes, translations, sourceUrl: 'https://arxiv.org/pdf/1706.03762', total: 2, completed: 2}))).toBe(true);
        bytes[0] = 0; translations[0] = '改';
        const list = await history.list();
        expect(list.map(entry => entry.id)).toEqual(['new', 'old']);
        expect(list[0]).toEqual({id: 'new', name: 'new.pdf', format: 'pdf', size: 3, sourceUrl: 'https://arxiv.org/pdf/1706.03762', total: 2, completed: 2, updatedAt: 200});
        expect(list[1]).not.toHaveProperty('sourceUrl'); expect(list.every(entry => !('bytes' in entry) && !('translations' in entry))).toBe(true);
        const loaded = await history.load('new');
        expect(Array.from(loaded!.bytes)).toEqual([9, 8, 7]); expect(loaded!.translations).toEqual(['甲', '乙']); expect(loaded!.fingerprint).toBe('fp');
    });
    it('updates an existing record in place, removes single records and clears everything', async () => {
        const history = createDocumentHistory(new IDBFactory());
        await history.save(record('a', 1)); await history.save(record('b', 2)); await history.save(record('a', 3, {completed: 4}));
        expect((await history.list()).map(entry => [entry.id, entry.completed])).toEqual([['a', 4], ['b', 2]]);
        await history.remove('a'); expect((await history.list()).map(entry => entry.id)).toEqual(['b']);
        await history.clear(); expect(await history.list()).toEqual([]);
    });
    it('evicts the oldest records beyond the entry limit', async () => {
        const history = createDocumentHistory(new IDBFactory());
        for (let index = 0; index < DOCUMENT_HISTORY_MAX_ENTRIES + 3; index += 1) await history.save(record(`doc-${index}`, index));
        const ids = (await history.list()).map(entry => entry.id);
        expect(ids).toHaveLength(DOCUMENT_HISTORY_MAX_ENTRIES);
        expect(ids[0]).toBe(`doc-${DOCUMENT_HISTORY_MAX_ENTRIES + 2}`); expect(ids).not.toContain('doc-0'); expect(ids).not.toContain('doc-2'); expect(ids).toContain('doc-3');
    });
    it('evicts older records when the total stored bytes exceed the budget and refuses oversized or anonymous records', async () => {
        const history = createDocumentHistory(new IDBFactory());
        const half = Math.floor(DOCUMENT_HISTORY_MAX_BYTES / 2);
        expect(await history.save(record('first', 1, {bytes: new Uint8Array(half)}))).toBe(true);
        expect(await history.save(record('second', 2, {bytes: new Uint8Array(half)}))).toBe(true);
        expect(await history.save(record('third', 3, {bytes: new Uint8Array(half)}))).toBe(true);
        expect((await history.list()).map(entry => entry.id)).toEqual(['third', 'second']);
        expect(await history.save(record('huge', 4, {bytes: new Uint8Array(DOCUMENT_HISTORY_MAX_BYTES + 1)}))).toBe(false);
        expect(await history.save(record('', 5))).toBe(false);
        expect((await history.list()).map(entry => entry.id)).toEqual(['third', 'second']);
    });
    it('releases its connection when another tab upgrades or deletes the database and reopens on the next use', async () => {
        const factory = new IDBFactory(); const history = createDocumentHistory(factory);
        await history.save(record('a', 1));
        // 另一个标签页删除数据库：本连接收到 versionchange 后关闭，删除得以完成而不被阻塞。
        await new Promise<void>((resolve, reject) => {const removal = factory.deleteDatabase('FluentReadDocumentHistory'); removal.onsuccess = () => resolve(); removal.onerror = () => reject(removal.error); removal.onblocked = () => reject(new Error('blocked'));});
        expect(await history.list()).toEqual([]);
        expect(await history.save(record('b', 2))).toBe(true); expect((await history.list()).map(entry => entry.id)).toEqual(['b']);
    });
    it('degrades to empty results when IndexedDB is missing, refuses to open or fails mid-request, and can recover afterwards', async () => {
        const absent = createDocumentHistory(null as never);
        expect(await absent.list()).toEqual([]); expect(await absent.load('a')).toBeNull(); expect(await absent.save(record('a', 1))).toBe(false);
        await expect(absent.remove('a')).resolves.toBeUndefined(); await expect(absent.clear()).resolves.toBeUndefined();
        const real = new IDBFactory(); let blocked = true;
        const flaky = {open: (name: string, version?: number) => {
            if (!blocked) return real.open(name, version);
            const failed = {error: new Error('denied')} as unknown as IDBOpenDBRequest;
            queueMicrotask(() => failed.onerror?.(new Event('error')));
            return failed;
        }} as unknown as IDBFactory;
        const history = createDocumentHistory(flaky);
        expect(await history.list()).toEqual([]); expect(await history.save(record('a', 1))).toBe(false);
        blocked = false;
        expect(await history.save(record('a', 1))).toBe(true); expect((await history.list()).map(entry => entry.id)).toEqual(['a']);
        // 数据库能打开但单次请求失败（例如配额不足）：同样退化为空结果。
        const failing = () => {const pending = {error: new Error('quota')} as unknown as IDBRequest; queueMicrotask(() => pending.onerror?.(new Event('error'))); return pending;};
        const rejecting = createDocumentHistory({open: () => {
            const opened = {result: {transaction: () => ({objectStore: () => ({getAll: failing, get: failing, put: failing, delete: failing, clear: failing})})}} as unknown as IDBOpenDBRequest;
            queueMicrotask(() => opened.onsuccess?.(new Event('success')));
            return opened;
        }} as unknown as IDBFactory);
        expect(await rejecting.list()).toEqual([]); expect(await rejecting.load('a')).toBeNull(); expect(await rejecting.save(record('a', 1))).toBe(false);
        await expect(rejecting.remove('a')).resolves.toBeUndefined(); await expect(rejecting.clear()).resolves.toBeUndefined();
        // 被其他标签页占用：打开请求被阻塞或一直没有结果，都在时限内退化为空结果，之后可以恢复。
        const blockedFactory = {open: () => {const pending = {} as unknown as IDBOpenDBRequest; queueMicrotask(() => pending.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)); return pending;}} as unknown as IDBFactory;
        expect(await createDocumentHistory(blockedFactory).list()).toEqual([]);
        let silent = true; const later = new IDBFactory();
        const hanging = createDocumentHistory({open: (name: string, version?: number) => silent ? {} as IDBOpenDBRequest : later.open(name, version)} as unknown as IDBFactory, 20);
        const started = Date.now();
        expect(await hanging.load('a')).toBeNull(); expect(await hanging.save(record('a', 1))).toBe(false); expect(Date.now() - started).toBeLessThan(1000);
        silent = false;
        expect(await hanging.save(record('a', 1))).toBe(true); expect((await hanging.list()).map(entry => entry.id)).toEqual(['a']);
        const broken = createDocumentHistory({open: () => {throw new Error('unavailable');}} as unknown as IDBFactory);
        expect(await broken.list()).toEqual([]); expect(await broken.load('a')).toBeNull();
    });
});
