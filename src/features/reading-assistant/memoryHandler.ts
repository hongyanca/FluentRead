/**
 * @file src/features/reading-assistant/memoryHandler.ts
 * 文件职责：校验长期学习笔记消息的来源，限制个人记忆的读取、编辑和删除边界。
 * 主要内容：仅可信设置页可管理全部记忆，获准内容脚本只可主动新增；隐私窗口拒绝全部读写，删除代次保护等待配置期间的迟到保存。
 * 模块边界：不读网页或模型，不通过开关阻止用户管理已有数据；配置准备、网站资格、仓库和请求取消由组合根注入。
 */
import {LearningMemoryError, validateLearningMemoryId, validateLearningMemoryInput, type LearningMemoryStore} from '@/src/services/harness/learningMemory';
import type {ReadingSender} from './background';

interface LearningMemoryHandlerDependencies {
    store: LearningMemoryStore;
    extensionId: string;
    optionsUrl: string;
    ready: Promise<unknown>;
    eligibility(sender: ReadingSender): string | undefined;
    privateContext(): boolean;
    cancelActive(): void;
}
const DENIED = {success: false, error: '无法访问学习笔记'} as const;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function createLearningMemoryHandler(deps: LearningMemoryHandlerDependencies) {
    return async (message: unknown, sender: ReadingSender) => {
        if (sender.id !== deps.extensionId || deps.privateContext() || sender.tab?.incognito || !isRecord(message) || message.type !== 'fluentReadHarness') return DENIED;
        const optionsPage = sender.url?.split(/[?#]/u)[0] === deps.optionsUrl;
        const contentPage = Number.isSafeInteger(sender.tab?.id) && sender.tab!.id! >= 0 && /^(?:https?|file):/u.test(sender.url || '');
        if (!optionsPage && (!contentPage || message.action !== 'memory-save' || !isRecord(message.input) || message.input.id !== undefined)) return DENIED;
        try {
            // 在任何异步准备之前校验字段并抓取持久代次；晚到的创建不能复活清空前的数据。
            const input = message.action === 'memory-save' ? validateLearningMemoryInput(message.input) : undefined;
            const id = message.action === 'memory-delete' ? validateLearningMemoryId(message.id) : undefined;
            if (!['memory-list', 'memory-save', 'memory-delete', 'memory-clear'].includes(String(message.action))) return DENIED;
            const generation = input ? await deps.store.captureGeneration() : undefined;
            await deps.ready;
            if (deps.privateContext() || sender.tab?.incognito || (!optionsPage && deps.eligibility(sender))) return DENIED;
            if (message.action === 'memory-list') return {success: true, memories: await deps.store.list()};
            if (input) {
                const memory = await deps.store.save(input, generation);
                deps.cancelActive();
                return {success: true, memory};
            }
            if (id) await deps.store.delete(id);
            else await deps.store.clear();
            deps.cancelActive();
            return {success: true};
        } catch (error) {
            return {success: false, error: error instanceof LearningMemoryError ? error.message : '学习笔记操作未完成，请稍后重试'};
        }
    };
}
