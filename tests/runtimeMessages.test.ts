/**
 * @file tests/runtimeMessages.test.ts
 * 文件职责：验证消息监听在扩展重载后仍可安全注销，以及发送异常统一进入 Promise 拒绝链。
 * 主要内容：覆盖监听身份和响应语义、事件捕获、缺失事件、重复注销及同步与异步发送失败。
 * 模块边界：使用消息事件夹具，不连接真实浏览器或外部翻译服务。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    browser: {runtime: undefined as {sendMessage: ReturnType<typeof vi.fn>} | undefined},
}));
vi.mock('webextension-polyfill', () => ({default: mocks.browser}));

import {addRuntimeMessageListener, sendRuntimeMessage} from '@/src/platform/browser/runtimeMessages';

afterEach(() => { mocks.browser.runtime = undefined; });

describe('runtime message listener lifecycle', () => {
    it('preserves listener identity, receiver, arguments and synchronous or Promise responses', async () => {
        const listeners = new Set<(...args: any[]) => any>();
        const event = {
            addListener: vi.fn(function (this: unknown, listener: (...args: any[]) => any) {
                expect(this).toBe(event);
                listeners.add(listener);
            }),
            removeListener: vi.fn(function (this: unknown, listener: (...args: any[]) => any) {
                expect(this).toBe(event);
                listeners.delete(listener);
            }),
        };
        const listener = vi.fn().mockReturnValueOnce(true).mockResolvedValueOnce({success: true});
        const unsubscribe = addRuntimeMessageListener({onMessage: event}, listener);
        expect([...listeners]).toEqual([listener]);
        const message = {type: 'state'}, sender = {id: 'extension'}, respond = vi.fn();
        expect([...listeners][0](message, sender, respond)).toBe(true);
        await expect([...listeners][0](message, sender, respond)).resolves.toEqual({success: true});
        expect(listener).toHaveBeenLastCalledWith(message, sender, respond);
        unsubscribe(); unsubscribe();
        expect(event.removeListener).toHaveBeenCalledTimes(1);
        expect(event.removeListener).toHaveBeenCalledWith(listener);
        expect(listeners.size).toBe(0);
    });

    it('captures the original event and never rereads the runtime or a revoked event getter on unsubscribe', () => {
        const event = {addListener: vi.fn(), removeListener: vi.fn()};
        const runtime = {onMessage: event};
        const listener = vi.fn();
        const unsubscribe = addRuntimeMessageListener(runtime, listener);
        Object.defineProperty(runtime, 'onMessage', {get() { throw new Error('Extension context invalidated.'); }});
        expect(() => { unsubscribe(); unsubscribe(); }).not.toThrow();
        expect(event.removeListener).toHaveBeenCalledTimes(1);
        expect(event.removeListener).toHaveBeenCalledWith(listener);
    });

    it('unsubscribes from the original event after runtime replacement or removal', () => {
        const original = {addListener: vi.fn(), removeListener: vi.fn()};
        const replacement = {addListener: vi.fn(), removeListener: vi.fn()};
        const source: {runtime?: {onMessage?: typeof original}} = {runtime: {onMessage: original}};
        const listener = vi.fn();
        const unsubscribe = addRuntimeMessageListener(source.runtime, listener);
        source.runtime!.onMessage = replacement;
        Reflect.deleteProperty(source, 'runtime');
        unsubscribe();
        expect(original.removeListener).toHaveBeenCalledTimes(1);
        expect(original.removeListener).toHaveBeenCalledWith(listener);
        expect(replacement.removeListener).not.toHaveBeenCalled();
    });

    it.each([undefined, null, {}])('returns a reusable no-op when runtime/event is absent: %s', runtime => {
        const unsubscribe = addRuntimeMessageListener(runtime, vi.fn());
        expect(() => { unsubscribe(); unsubscribe(); }).not.toThrow();
    });

    it('keeps throwing removals idempotent and allows later resource cleanup', () => {
        const listener = vi.fn();
        const event = {addListener: vi.fn(), removeListener: vi.fn(() => { throw new Error('Extension context invalidated.'); })};
        const unsubscribe = addRuntimeMessageListener({onMessage: event}, listener);
        const cleanupDom = vi.fn();
        expect(() => { unsubscribe(); cleanupDom(); unsubscribe(); }).not.toThrow();
        expect(event.removeListener).toHaveBeenCalledTimes(1);
        expect(event.removeListener).toHaveBeenCalledWith(listener);
        expect(cleanupDom).toHaveBeenCalledOnce();
    });

    it('is idempotent even when removal reenters the unsubscribe callback', () => {
        let unsubscribe!: () => void;
        const event = {addListener: vi.fn(), removeListener: vi.fn(() => unsubscribe())};
        unsubscribe = addRuntimeMessageListener({onMessage: event}, vi.fn());
        unsubscribe();
        expect(event.removeListener).toHaveBeenCalledOnce();
    });

    it('preserves registration failures instead of returning a misleading subscription', () => {
        const error = new Error('registration failed');
        const event = {addListener: vi.fn(() => { throw error; }), removeListener: vi.fn()};
        expect(() => addRuntimeMessageListener({onMessage: event}, vi.fn())).toThrow(error);
        expect(event.removeListener).not.toHaveBeenCalled();
    });
});

describe('sendRuntimeMessage', () => {
    it('forwards the message with the original runtime receiver and resolves its response', async () => {
        const message = {type: 'state'}, response = {success: true};
        const runtime = {sendMessage: vi.fn(function (this: unknown) {
            expect(this).toBe(runtime);
            return Promise.resolve(response);
        })};
        mocks.browser.runtime = runtime;
        await expect(sendRuntimeMessage(message)).resolves.toBe(response);
        expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(runtime.sendMessage).toHaveBeenCalledWith(message);
    });

    it('preserves a rejected Promise and its error', async () => {
        const error = new Error('receiver unavailable');
        mocks.browser.runtime = {sendMessage: vi.fn().mockRejectedValue(error)};
        await expect(sendRuntimeMessage({type: 'state'})).rejects.toBe(error);
    });

    it('turns synchronously thrown context invalidation into a catchable rejection', async () => {
        const error = new Error('Extension context invalidated.');
        mocks.browser.runtime = {sendMessage: vi.fn(() => { throw error; })};
        const caught = vi.fn();
        let pending!: Promise<unknown>;
        expect(() => { pending = sendRuntimeMessage({type: 'state'}).catch(caught); }).not.toThrow();
        await pending;
        expect(caught).toHaveBeenCalledTimes(1);
        expect(caught).toHaveBeenCalledWith(error);
    });

    it('rejects rather than throwing synchronously when runtime is missing', async () => {
        mocks.browser.runtime = undefined;
        let pending!: Promise<unknown>;
        expect(() => { pending = sendRuntimeMessage({type: 'state'}); }).not.toThrow();
        await expect(pending).rejects.toBeInstanceOf(TypeError);
    });
});
