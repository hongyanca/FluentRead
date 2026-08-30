import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    abortErrorFromSignal,
    createRuntimeAbortContext,
    runtimeFetch,
    setRuntimeFetch,
} from '@/src/platform/http/runtime';

describe('runtime HTTP transport', () => {
    afterEach(() => setRuntimeFetch());

    it('uses an installed fetch-compatible transport', async () => {
        const response = new Response('{"ok":true}', {
            status: 201,
            headers: {'content-type': 'application/json'},
        });
        const transport = vi.fn(async () => response);
        setRuntimeFetch(transport);

        const result = await runtimeFetch('https://example.com/translate', {
            method: 'POST',
            body: 'hello',
        });

        expect(transport).toHaveBeenCalledWith('https://example.com/translate', {
            method: 'POST',
            body: 'hello',
        });
        expect(result.status).toBe(201);
        expect(await result.json()).toEqual({ok: true});
    });

    it('reset 后恢复调用运行环境的原生 fetch', async () => {
        const originalFetch = globalThis.fetch;
        const nativeFetch = vi.fn(async () => new Response('native'));
        globalThis.fetch = nativeFetch;
        setRuntimeFetch();

        try {
            const response = await runtimeFetch(new URL('https://example.com/native'));
            expect(await response.text()).toBe('native');
            expect(nativeFetch).toHaveBeenCalledOnce();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('局部 timeout 到期后中止合并 signal，并标记为超时来源', async () => {
        vi.useFakeTimers();
        const context = createRuntimeAbortContext(500);
        expect(context.signal.aborted).toBe(false);
        expect(context.didTimeout()).toBe(false);

        await vi.advanceTimersByTimeAsync(500);
        expect(context.signal.aborted).toBe(true);
        expect(context.didTimeout()).toBe(true);
        context.cleanup();
        vi.useRealTimers();
    });

    it('透传调用方的 Error 取消原因，cleanup 后移除监听', () => {
        const caller = new AbortController();
        const context = createRuntimeAbortContext(1_000, caller.signal);
        const reason = new Error('caller deadline');
        caller.abort(reason);

        expect(context.signal.aborted).toBe(true);
        expect(context.didTimeout()).toBe(false);
        expect(abortErrorFromSignal(context.signal)).toBe(reason);
        context.cleanup();

        const detachedCaller = new AbortController();
        const detached = createRuntimeAbortContext(1_000, detachedCaller.signal);
        detached.cleanup();
        detachedCaller.abort(new Error('too late'));
        expect(detached.signal.aborted).toBe(false);
    });

    it('调用前已取消且原因非 Error 时统一生成标准 AbortError', () => {
        const caller = new AbortController();
        caller.abort('stop');
        const context = createRuntimeAbortContext(1_000, caller.signal);

        expect(context.signal.aborted).toBe(true);
        expect(abortErrorFromSignal(context.signal)).toMatchObject({name: 'AbortError'});
        context.cleanup();
    });
});
