/**
 * @file tests/learningMemoryRepository.test.ts
 * 文件职责：验证长期学习笔记的字段、真实 IndexedDB 事务和迟到写入边界。
 * 主要内容：覆盖幂等、编辑、容量、并发、标识冲突、白名单、跨连接持久代次及清空后防复活。
 * 模块边界：使用隔离 fake-indexeddb，不启动模型、浏览器或远程服务。
 */
import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it} from 'vitest';
import {FluentReadLearningMemoryDatabase, LearningMemoryRepository} from '@/src/platform/storage/learningMemoryRepository';
import {LEARNING_MEMORY_LIMIT, validateLearningMemoryId, validateLearningMemoryInput, type LearningMemoryInput} from '@/src/services/harness/learningMemory';

let sequence = 0;
const databases: FluentReadLearningMemoryDatabase[] = [];
const firstId = 'a0000000-0000-4000-8000-000000000001';
function repository(options: {now?: () => number; id?: () => string} = {}, name = `LearningMemory-test-${++sequence}`) {
    const database = new FluentReadLearningMemoryDatabase(name);
    databases.push(database);
    return new LearningMemoryRepository(database, options);
}
const input = (content = '先解释句子主干，再解释从句'): LearningMemoryInput => ({content, kind: 'preference'});
afterEach(async () => {
    const current = databases.splice(0);
    current.forEach(database => database.close());
    for (const name of new Set(current.map(database => database.name))) await new FluentReadLearningMemoryDatabase(name).delete();
});

describe('learning memory input boundary', () => {
    it('keeps only declared fields, trims text, and normalizes valid UUID casing', () => {
        expect(validateLearningMemoryInput({...input('  内容  '), id: firstId.toUpperCase(), token: 'secret'})).toEqual({...input('内容'), id: firstId});
        expect(validateLearningMemoryInput({content: 'a'.repeat(2000), kind: 'lesson'}).content).toHaveLength(2000);
        expect(validateLearningMemoryInput({content: '笔记', kind: 'note'})).toEqual({content: '笔记', kind: 'note'});
    });
    it('rejects absent, blank, oversized or invalid fields without truncating', () => {
        for (const invalid of [null, undefined, [], '', {}, {content: 'x', kind: 'unknown'}, {content: 3, kind: 'note'}, {content: ' \n ', kind: 'note'}, input('a'.repeat(2001)), {...input(), id: 'not-a-uuid'}]) {
            expect(() => validateLearningMemoryInput(invalid)).toThrow();
        }
        for (const id of [null, 2, '', 'a0000000-0000-4000-1000-000000000001']) expect(() => validateLearningMemoryId(id)).toThrow('标识无效');
    });
});

describe('learning memory repository', () => {
    it('persists whitelist fields across connections and keeps exact duplicate creation idempotent', async () => {
        const store = repository({id: () => firstId, now: () => 100});
        const first = await store.save({...input(), token: 'secret'} as LearningMemoryInput);
        expect(first).toEqual({...input(), id: firstId, createdAt: 100, updatedAt: 100});
        const duplicate = await store.save(input(` ${first.content} `));
        expect(duplicate).toEqual(first);
        duplicate.content = 'external mutation';
        const other = repository({}, store.database.name);
        expect(await other.list()).toEqual([first]);
        expect(await store.database.memories.get(firstId)).not.toHaveProperty('token');
        await store.delete(firstId);
        expect(await other.list()).toEqual([]);
        await store.delete(firstId);
    });
    it('updates existing entries, preserves creation time and monotonic recency, and returns a copy', async () => {
        let now = 100;
        const store = repository({now: () => now});
        const first = await store.save(input());
        now = 200;
        const second = await store.save({content: '练习连词', kind: 'lesson'});
        now = 300;
        const updated = await store.save({id: first.id, content: '先解释作用，再给术语', kind: 'note'});
        expect(updated).toMatchObject({id: first.id, createdAt: 100, updatedAt: 300, kind: 'note'});
        expect((await store.list()).map(memory => memory.id)).toEqual([first.id, second.id]);
        expect(await store.save({id: updated.id, content: updated.content, kind: updated.kind})).toEqual(updated);
        now = 50;
        expect((await store.save({id: first.id, content: '调整说明', kind: 'note'})).updatedAt).toBe(300);
        const list = await store.list(); list[0].content = 'changed';
        expect((await store.list())[0].content).toBe('调整说明');
        await store.clear();
        expect(await store.list()).toEqual([]);
    });
    it('never overwrites an existing entry on generated ID collision or duplicate update', async () => {
        const store = repository({id: () => firstId});
        const first = await store.save(input('first'));
        await expect(store.save(input('second'))).rejects.toThrow('标识冲突');
        expect(await store.list()).toEqual([first]);
        const other = repository({}, store.database.name);
        const second = await other.save(input('second'));
        await expect(other.save({id: second.id, ...input('first')})).rejects.toThrow('已有相同内容');
        expect(await other.list()).toHaveLength(2);
        await expect(store.save({id: 'a0000000-0000-4000-8000-000000000099', ...input('missing')})).rejects.toThrow('已被删除');
    });
    it('does not merge similar content or different categories', async () => {
        const store = repository();
        await store.save(input('explain grammar'));
        await store.save(input('explain Grammar'));
        await store.save({content: 'explain grammar', kind: 'lesson'});
        expect(await store.list()).toHaveLength(3);
    });
    it('serializes concurrent duplicate creation and capacity checks across connections', async () => {
        const store = repository();
        const other = repository({}, store.database.name);
        const repeated = await Promise.all(Array.from({length: 6}, (_, index) => (index % 2 ? store : other).save(input())));
        expect(new Set(repeated.map(memory => memory.id)).size).toBe(1);
        await store.clear();
        const writes = await Promise.allSettled(Array.from({length: LEARNING_MEMORY_LIMIT + 1}, (_, index) => (index % 2 ? store : other).save(input(`note-${index}`))));
        expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(LEARNING_MEMORY_LIMIT);
        expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1);
        const saved = await store.list();
        expect(saved).toHaveLength(LEARNING_MEMORY_LIMIT);
        await expect(store.save({id: saved[0].id, ...input('edited at capacity')})).resolves.toMatchObject({content: 'edited at capacity'});
        await expect(store.save(input('edited at capacity'))).resolves.toMatchObject({id: saved[0].id});
        await expect(store.save(input('one too many'))).rejects.toThrow('最多保存 200');
    });
    it('rejects generations captured before delete or clear, including another connection and reopen', async () => {
        const store = repository();
        const first = await store.save(input());
        const generation = await store.captureGeneration();
        const other = repository({}, store.database.name);
        await other.delete(first.id);
        await expect(store.save(input('late creation'), generation)).rejects.toThrow('已变更');
        await expect(store.save({id: first.id, ...input('late edit')})).rejects.toThrow('已被删除');
        const beforeClear = await other.captureGeneration();
        await other.save(input('new'));
        await other.clear();
        store.database.close();
        await store.database.open();
        await expect(store.save(input('late after reopen'), beforeClear)).rejects.toThrow('已变更');
        expect(await store.list()).toEqual([]);
        await expect(store.save(input('intentional new'))).resolves.toMatchObject({content: 'intentional new'});
        for (const token of [NaN, -1, 0]) await expect(store.save(input('invalid generation'), token)).rejects.toThrow('已变更');
    });
    it('rolls back deletion and generation together when a transaction fails', async () => {
        const store = repository();
        const first = await store.save(input());
        const generation = await store.captureGeneration();
        await expect(store.database.transaction('rw', store.database.memories, store.database.metadata, async () => {
            await store.clear();
            throw new Error('transaction rollback');
        })).rejects.toThrow('transaction rollback');
        expect(await store.captureGeneration()).toBe(generation);
        expect(await store.list()).toEqual([first]);
        await expect(store.save(input('after rollback'), generation)).resolves.toMatchObject({content: 'after rollback'});
    });
    it('rejects invalid clocks, generated IDs and delete IDs without mutating records', async () => {
        for (const now of [-1, NaN, 1.5]) await expect(repository({now: () => now}).save(input())).rejects.toThrow('保存时间');
        const store = repository({id: () => 'invalid'});
        await expect(store.save(input())).rejects.toThrow('标识无效');
        await expect(store.delete('invalid')).rejects.toThrow('标识无效');
        expect(await store.list()).toEqual([]);
    });
});
