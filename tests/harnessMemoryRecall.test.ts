import {describe, expect, it, vi} from 'vitest';
import {createLearningMemoryRecall} from '@/src/services/harness/memoryRecall';
import type {LearningMemory} from '@/src/services/harness/learningMemory';

const now = Date.now();
const entry = (id: string, content: string, kind: LearningMemory['kind'] = 'lesson', updatedAt = now): LearningMemory => ({id, content, kind, createdAt: now, updatedAt});

describe('learning memory browser adapter', () => {
    it('recalls relevant lessons across calls and preserves only the latest general learning preference', async () => {
        const entries = [entry('old', 'Please use advanced terms', 'preference', now - 10), entry('new', 'Please use short examples', 'preference'), entry('a', 'Practice helps improve grammar'), entry('b', 'Practice grammar with a short sentence'), entry('c', 'Grammar improves with practice'), entry('d', 'Unrelated shopping list')];
        const store = {list: vi.fn(async () => entries)};
        const recall = createLearningMemoryRecall(store);
        const result = await recall('practice grammar');
        expect(result).toHaveLength(3); expect(result[0].id).toBe('new');
        expect(result.slice(1).map(item => item.id)).not.toContain('d');
        expect(await recall('ok了吗')).toEqual([entries[1]]);
        expect(store.list).toHaveBeenCalledTimes(2);
    });
    it('returns no unrelated facts, deduplicates matching preferences, and reloads after edits/deletion', async () => {
        const entries = [entry('a', 'grammar practice preference', 'preference')];
        const recall = createLearningMemoryRecall({list: async () => entries});
        expect(await recall('grammar')).toEqual(entries);
        entries.splice(0, 1, entry('b', 'vocabulary flashcards'));
        expect(await recall('unrelated sentence')).toEqual([]);
        expect(await recall('vocabulary')).toEqual(entries);
        entries.splice(0); expect(await recall('vocabulary')).toEqual([]);
        expect(await recall('')).toEqual([]);
    });
    it('lets runtime report repository failures without treating failed storage as an empty successful recall', async () => {
        await expect(createLearningMemoryRecall({list: async () => {throw new Error('storage');}})('practice')).rejects.toThrow('storage');
    });
});
