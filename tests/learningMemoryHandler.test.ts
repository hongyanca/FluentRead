/**
 * @file tests/learningMemoryHandler.test.ts
 * 文件职责：验证长期学习笔记消息的发送者、隐私、管理权限及错误边界。
 * 主要内容：覆盖可信设置页 CRUD、内容脚本仅新增、禁用仍可管理、异步准备期间的代次与隐私变更。
 * 模块边界：注入内存仓库替身，不启动浏览器、不发送模型请求。
 */
import {describe, expect, it, vi} from 'vitest';
import {createLearningMemoryHandler} from '@/src/features/reading-assistant/memoryHandler';
import {LearningMemoryError, type LearningMemoryStore} from '@/src/services/harness/learningMemory';

const id = 'a0000000-0000-4000-8000-000000000001';
const memory = {id, content: '先解释主干', kind: 'preference' as const, createdAt: 1, updatedAt: 1};
const input = {content: memory.content, kind: memory.kind};
const options = {id: 'ext', url: 'chrome-extension://ext/options.html#settings-vocabulary'};
const content = {id: 'ext', url: 'https://article.test/', tab: {id: 3, url: 'https://article.test/'}};
const message = (action: string, extra: object = {}) => ({type: 'fluentReadHarness', action, ...extra});
function setup() {
    const store = {
        captureGeneration: vi.fn().mockResolvedValue(7), list: vi.fn().mockResolvedValue([memory]),
        save: vi.fn().mockResolvedValue(memory), delete: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined),
    } satisfies LearningMemoryStore;
    const deps = {store, extensionId: 'ext', optionsUrl: 'chrome-extension://ext/options.html', ready: Promise.resolve(), eligibility: vi.fn((): string | undefined => undefined), privateContext: vi.fn(() => false), cancelActive: vi.fn()};
    return {store, deps, handle: createLearningMemoryHandler(deps)};
}

describe('learning memory message permissions', () => {
    it('lets trusted settings list/create/update/delete/clear while disabled and cancels old reading requests after writes', async () => {
        const {store, deps, handle} = setup();
        deps.eligibility.mockReturnValue('功能关闭');
        expect(await handle(message('memory-list'), options)).toEqual({success: true, memories: [memory]});
        expect(await handle(message('memory-save', {input}), {...options, url: 'chrome-extension://ext/options.html?tab=memory'})).toEqual({success: true, memory});
        expect(store.save).toHaveBeenLastCalledWith(input, 7);
        await handle(message('memory-save', {input: {...input, id}}), options);
        expect(store.save).toHaveBeenLastCalledWith({...input, id}, 7);
        expect(await handle(message('memory-delete', {id}), options)).toEqual({success: true});
        expect(store.delete).toHaveBeenCalledWith(id);
        expect(await handle(message('memory-clear'), options)).toEqual({success: true});
        expect(store.clear).toHaveBeenCalledOnce();
        expect(deps.cancelActive).toHaveBeenCalledTimes(4);
        expect(deps.eligibility).not.toHaveBeenCalled();
    });
    it('permits explicit new memories from eligible content scripts but forbids reading or mutating old personal memories', async () => {
        const {handle, store, deps} = setup();
        expect(await handle(message('memory-save', {input: {...input, token: 'secret'}}), content)).toEqual({success: true, memory});
        expect(store.save).toHaveBeenCalledWith(input, 7);
        expect(await handle(message('memory-save', {input}), {...content, url: 'file:///tmp/article.html'})).toMatchObject({success: true});
        for (const request of [message('memory-list'), message('memory-delete', {id}), message('memory-clear'), message('memory-save', {input: {...input, id}}), message('memory-save', {input: null})]) {
            expect(await handle(request, content)).toEqual({success: false, error: '无法访问学习笔记'});
        }
        expect(store.list).not.toHaveBeenCalled(); expect(store.delete).not.toHaveBeenCalled(); expect(store.clear).not.toHaveBeenCalled();
        expect(store.save).toHaveBeenCalledTimes(2);
        deps.eligibility.mockReturnValue('当前网站已禁用');
        expect(await handle(message('memory-save', {input}), content)).toMatchObject({success: false});
        expect(store.save).toHaveBeenCalledTimes(2);
    });
    it('rejects forged extension senders, wrong documents, invalid messages and all incognito sources before touching storage', async () => {
        const {handle, store, deps} = setup();
        for (const sender of [
            {}, {...options, id: 'foreign'}, {...options, url: 'chrome-extension://ext/options.html.evil'},
            {...content, tab: {id: -1}}, {...content, tab: {id: 1.5}}, {...content, tab: undefined}, {...content, url: undefined},
            {...content, url: 'chrome-extension://ext/options.html.evil'}, {...options, tab: {incognito: true}}, {...content, tab: {id: 3, incognito: true}},
        ]) expect(await handle(message('memory-save', {input}), sender)).toMatchObject({success: false});
        for (const request of [null, [], 1, {}, {type: 'other', action: 'memory-save', input}, message('unknown')]) expect(await handle(request, options)).toMatchObject({success: false});
        deps.privateContext.mockReturnValue(true);
        for (const action of ['memory-list', 'memory-save', 'memory-delete', 'memory-clear']) expect(await handle(message(action, {input, id}), options)).toMatchObject({success: false});
        for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled();
    });
    it('validates input and IDs before storage, and reports only safe input or generic storage errors', async () => {
        const {handle, store, deps} = setup();
        expect(await handle(message('memory-save', {input: {...input, content: 'x'.repeat(2001)}}), options)).toMatchObject({success: false, error: expect.stringContaining('2000')});
        expect(await handle(message('memory-delete', {id: 'bad'}), options)).toMatchObject({success: false, error: '学习笔记标识无效'});
        expect(store.captureGeneration).not.toHaveBeenCalled();
        store.save.mockRejectedValueOnce(new LearningMemoryError('最多保存 200 条学习笔记'));
        expect(await handle(message('memory-save', {input}), options)).toEqual({success: false, error: '最多保存 200 条学习笔记'});
        store.list.mockRejectedValueOnce(new Error('PRIVATE DATABASE DETAILS'));
        expect(await handle(message('memory-list'), options)).toEqual({success: false, error: '学习笔记操作未完成，请稍后重试'});
        store.captureGeneration.mockRejectedValueOnce(new Error('generation read error'));
        expect(await handle(message('memory-save', {input}), options)).toMatchObject({success: false, error: '学习笔记操作未完成，请稍后重试'});
        expect(deps.cancelActive).not.toHaveBeenCalled();
        const ready = Promise.reject(new Error('config error'));
        expect(await createLearningMemoryHandler({...deps, ready})(message('memory-list'), options)).toMatchObject({success: false});
    });
    it('captures the write generation before readiness so clear cannot be undone by late saves', async () => {
        const {store, deps} = setup();
        let resolveReady!: () => void;
        const ready = new Promise<void>(resolve => {resolveReady = resolve;});
        const handle = createLearningMemoryHandler({...deps, ready});
        const pending = handle(message('memory-save', {input}), options);
        await Promise.resolve();
        expect(store.captureGeneration).toHaveBeenCalledOnce();
        expect(store.save).not.toHaveBeenCalled();
        store.captureGeneration.mockResolvedValue(8);
        store.save.mockRejectedValueOnce(new LearningMemoryError('学习笔记已变更，请重新保存'));
        resolveReady();
        expect(await pending).toEqual({success: false, error: '学习笔记已变更，请重新保存'});
        expect(store.save).toHaveBeenCalledWith(input, 7);
        expect(deps.cancelActive).not.toHaveBeenCalled();
    });
    it('checks privacy again after asynchronous readiness before reading or saving', async () => {
        for (const request of [message('memory-list'), message('memory-save', {input})]) {
            const {store, deps} = setup();
            let resolveReady!: () => void;
            const ready = new Promise<void>(resolve => {resolveReady = resolve;});
            const handle = createLearningMemoryHandler({...deps, ready});
            const pending = handle(request, options);
            await Promise.resolve();
            deps.privateContext.mockReturnValue(true); resolveReady();
            expect(await pending).toMatchObject({success: false});
            expect(store.list).not.toHaveBeenCalled(); expect(store.save).not.toHaveBeenCalled();
        }
    });
});
