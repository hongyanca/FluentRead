/**
 * @file src/platform/storage/learningMemoryRepository.ts
 * 文件职责：在扩展私有 IndexedDB 中保存用户主动确认的长期学习笔记。
 * 主要内容：提供最多 200 条记忆的原子新增、编辑、删除、清空与列表；精确重复创建幂等，持久代次拒绝删除或清空前的迟到写入。
 * 模块边界：只存白名单字段，不读模型密钥、网页或配置；不自动总结、合并或过期删除用户记忆。
 */
import Dexie, {type Table} from 'dexie';
import {LEARNING_MEMORY_LIMIT, LearningMemoryError, validateLearningMemoryId, validateLearningMemoryInput, type LearningMemory, type LearningMemoryInput, type LearningMemoryStore} from '@/src/services/harness/learningMemory';

export const LEARNING_MEMORY_DATABASE_NAME = 'FluentReadLearningMemories';
interface MemoryMetadata {key: 'generation'; value: number}
export class FluentReadLearningMemoryDatabase extends Dexie {
    memories!: Table<LearningMemory, string>;
    metadata!: Table<MemoryMetadata, string>;
    constructor(name = LEARNING_MEMORY_DATABASE_NAME) {
        super(name);
        this.version(1).stores({memories: '&id, updatedAt, &[kind+content]', metadata: '&key'});
    }
}
function publicMemory(memory: LearningMemory): LearningMemory {
    return {id: memory.id, content: memory.content, kind: memory.kind, createdAt: memory.createdAt, updatedAt: memory.updatedAt};
}
export class LearningMemoryRepository implements LearningMemoryStore {
    constructor(
        readonly database = new FluentReadLearningMemoryDatabase(),
        private readonly options: {now?: () => number; id?: () => string} = {},
    ) {}

    async captureGeneration(): Promise<number> {
        return (await this.database.metadata.get('generation'))?.value ?? 0;
    }

    async list(): Promise<LearningMemory[]> {
        return this.database.transaction('r', this.database.memories, async () => {
            const memories = await this.database.memories.orderBy('updatedAt').reverse().toArray();
            return memories.map(publicMemory);
        });
    }

    async save(input: LearningMemoryInput, expectedGeneration?: number): Promise<LearningMemory> {
        const valid = validateLearningMemoryInput(input);
        const generation = expectedGeneration ?? await this.captureGeneration();
        return this.database.transaction('rw', this.database.memories, this.database.metadata, async () => {
            if (!Number.isSafeInteger(generation) || generation < 0 || generation !== await this.captureGeneration()) {
                throw new LearningMemoryError('学习笔记已变更，请重新保存');
            }
            const existing = valid.id ? await this.database.memories.get(valid.id) : undefined;
            if (valid.id && !existing) throw new LearningMemoryError('这条学习笔记已被删除，请重新添加');
            const duplicate = await this.database.memories.where('[kind+content]').equals([valid.kind, valid.content]).first();
            if (duplicate) {
                if (!valid.id || duplicate.id === valid.id) return publicMemory(duplicate);
                throw new LearningMemoryError('已有相同内容的学习笔记，请保留其中一条');
            }
            if (!existing && await this.database.memories.count() >= LEARNING_MEMORY_LIMIT) {
                throw new LearningMemoryError(`最多保存 ${LEARNING_MEMORY_LIMIT} 条学习笔记，请先删除不需要的内容`);
            }
            const timestamp = (this.options.now ?? Date.now)();
            if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new LearningMemoryError('无法确定学习笔记保存时间');
            const id = valid.id ?? validateLearningMemoryId((this.options.id ?? (() => crypto.randomUUID()))());
            if (!existing && await this.database.memories.get(id)) throw new LearningMemoryError('学习笔记标识冲突，请重新保存');
            const memory: LearningMemory = {
                id, content: valid.content, kind: valid.kind,
                createdAt: existing?.createdAt ?? timestamp,
                updatedAt: Math.max(existing?.updatedAt ?? 0, timestamp),
            };
            if (existing) await this.database.memories.put(memory);
            else await this.database.memories.add(memory);
            return publicMemory(memory);
        });
    }

    async delete(id: string): Promise<void> {
        const valid = validateLearningMemoryId(id);
        await this.database.transaction('rw', this.database.memories, this.database.metadata, async () => {
            await this.database.metadata.put({key: 'generation', value: await this.captureGeneration() + 1});
            await this.database.memories.delete(valid);
        });
    }

    async clear(): Promise<void> {
        await this.database.transaction('rw', this.database.memories, this.database.metadata, async () => {
            await this.database.metadata.put({key: 'generation', value: await this.captureGeneration() + 1});
            await this.database.memories.clear();
        });
    }
}
export const learningMemoryRepository = new LearningMemoryRepository();
