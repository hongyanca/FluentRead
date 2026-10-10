/**
 * @file src/services/harness/learningMemory.ts
 * 文件职责：定义用户主动保存的长期学习笔记及本机仓库契约。
 * 主要内容：校验记忆分类、非空正文、长度与 UUID，提供可展示的中文输入错误及稳定 CRUD 类型。
 * 模块边界：不读取配置、不访问浏览器或模型，不从对话自动提取记忆，也不决定召回策略。
 */
export const LEARNING_MEMORY_LIMIT = 200;
export const LEARNING_MEMORY_CONTENT_LIMIT = 2000;
export type LearningMemoryKind = 'preference' | 'lesson' | 'note';
export interface LearningMemory {
    id: string;
    content: string;
    kind: LearningMemoryKind;
    createdAt: number;
    updatedAt: number;
}
export interface LearningMemoryInput {
    id?: string;
    content: string;
    kind: LearningMemoryKind;
}
export interface LearningMemoryStore {
    captureGeneration(): Promise<number>;
    list(): Promise<LearningMemory[]>;
    save(input: LearningMemoryInput, generation?: number): Promise<LearningMemory>;
    delete(id: string): Promise<void>;
    clear(): Promise<void>;
}
export class LearningMemoryError extends Error {}

export function validateLearningMemoryId(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
        throw new LearningMemoryError('学习笔记标识无效');
    }
    return value.toLowerCase();
}

export function validateLearningMemoryInput(value: unknown): LearningMemoryInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LearningMemoryError('学习笔记内容无效');
    const input = value as Record<string, unknown>;
    if (input.kind !== 'preference' && input.kind !== 'lesson' && input.kind !== 'note') throw new LearningMemoryError('请选择有效的学习笔记分类');
    if (typeof input.content !== 'string' || !input.content.trim()) throw new LearningMemoryError('请填写学习笔记内容');
    const content = input.content.trim();
    if (content.length > LEARNING_MEMORY_CONTENT_LIMIT) throw new LearningMemoryError(`学习笔记不能超过 ${LEARNING_MEMORY_CONTENT_LIMIT} 个字符`);
    return {content, kind: input.kind, ...(input.id === undefined ? {} : {id: validateLearningMemoryId(input.id)})};
}
