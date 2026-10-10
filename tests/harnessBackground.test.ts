import {afterEach, describe, expect, it, vi} from 'vitest';
import {createReadingAssistantHandler, type ReadingHandlerDependencies, type ReadingSender} from '@/src/features/reading-assistant/background';
import type {ReadingRequest, ReadingResponse} from '@/src/features/reading-assistant/types';

interface Deferred<T> {promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void}
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return {promise, resolve, reject};
}
function sender(tabId = 1, frameId = 0, documentId = 'doc-a'): ReadingSender {
    return {id: 'extension-id', tab: {id: tabId, url: `https://site${tabId}.test/`}, frameId, documentId};
}
function request(requestId: string): ReadingRequest {
    return {type: 'fluentReadHarness', action: 'run', requestId, selection: {text: 'selected', context: '', sentence: ''}, intent: 'meaning', question: '', history: []};
}
const answer = (model: string): ReadingResponse => ({success: true, text: `answer-${model}`, service: 'openai', model});
async function tick(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

function setup(options: Partial<ReadingHandlerDependencies> = {}) {
    const ready = deferred<void>();
    const runs: Deferred<ReadingResponse>[] = [];
    const deps: ReadingHandlerDependencies = {
        extensionId: 'extension-id', ready: ready.promise, eligibility: () => undefined,
        run: vi.fn(() => { const work = deferred<ReadingResponse>(); runs.push(work); return work.promise; }),
        ...options,
    };
    return {ready, runs, deps, handler: createReadingAssistantHandler(deps)};
}

describe('reading assistant background ownership', () => {
    afterEach(() => vi.useRealTimers());

    it('rejects invalid sender and malformed requests', async () => {
        const {handler} = setup();
        expect(await handler.handle(request('r'), {...sender(), id: 'other'})).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('bad id'), requestId: 'bad id'}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('r'), studyMode: 'random'}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('r'), selection: undefined}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('r'), sessionId: 'bad id'}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('r'), sessionId: 4}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('r'), anchorTurnId: 'bad id'}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({...request('r'), anchorTurnId: 4}, sender())).toEqual({success: false, error: '无效的阅读请求'});
        expect(await handler.handle({type: 'fluentReadHarness', action: 'cancel', requestId: 'unknown'}, sender())).toMatchObject({cancelled: true});
    });

    it('publishes only while the streaming request still owns an eligible document', async () => {
        let blocked = false;
        const {handler, ready, runs, deps} = setup({eligibility: () => blocked ? 'blocked' : undefined});
        ready.resolve();
        const progress = vi.fn();
        const pending = handler.handle({...request('stream'), sessionId: 'valid', anchorTurnId: 'turn-1'}, sender(), progress);
        await tick();
        const publish = vi.mocked(deps.run).mock.calls[0][2]!;
        publish({kind: 'text', text: 'first'});
        blocked = true; publish({kind: 'text', text: 'blocked'}); blocked = false;
        handler.cancelAll(); publish({kind: 'text', text: 'late'});
        runs[0].resolve(answer('late'));
        await pending;
        expect(progress.mock.calls).toEqual([[{kind: 'text', text: 'first'}]]);
        expect(vi.mocked(deps.run).mock.calls[0][3]).toEqual(sender());
        expect(vi.mocked(deps.run).mock.calls[0][0].anchorTurnId).toBe('turn-1');
    });

    it('supports cancel-before-ready and rejects duplicate request ids', async () => {
        const {handler, ready, runs} = setup();
        const pending = handler.handle(request('r'), sender());
        expect(await handler.handle({type: 'fluentReadHarness', action: 'cancel', requestId: 'r'}, sender())).toMatchObject({cancelled: true});
        ready.resolve();
        expect(await pending).toMatchObject({cancelled: true});
        expect(runs).toHaveLength(0);
        ready.resolve();
        const first = handler.handle(request('same'), sender());
        await tick();
        expect(await handler.handle(request('same'), sender())).toEqual({success: false, error: '这个请求正在处理中'});
        runs[0].resolve(answer('same'));
        await first;
    });

    it('scopes cancellation to tab/frame/document ownership', async () => {
        const {handler, ready, runs} = setup();
        ready.resolve();
        const one = handler.handle(request('shared'), sender(1, 0, 'a'));
        const two = handler.handle(request('shared'), sender(2, 0, 'b'));
        await tick();
        expect(runs).toHaveLength(2);
        expect(await handler.handle({type: 'fluentReadHarness', action: 'cancel', requestId: 'shared'}, sender(2, 1, 'b'))).toMatchObject({cancelled: true});
        runs[0].resolve(answer('one'));
        expect(await one).toEqual(answer('one'));
        expect(await handler.handle({type: 'fluentReadHarness', action: 'cancel', requestId: 'shared'}, sender(2, 0, 'b'))).toMatchObject({cancelled: true});
        runs[1].resolve(answer('two'));
        expect(await two).toMatchObject({cancelled: true});
        const frame = handler.handle(request('frame'), sender(1, 2, 'a'));
        await tick();
        handler.cancelTab(1);
        runs[2].resolve(answer('frame'));
        expect(await frame).toMatchObject({cancelled: true});
    });

    it('replaces an active request for the same owner and rejects late output', async () => {
        const {handler, ready, runs} = setup();
        ready.resolve();
        const old = handler.handle(request('old'), sender());
        await tick();
        const fresh = handler.handle(request('fresh'), sender());
        await tick();
        runs[0].resolve(answer('old-late'));
        runs[1].resolve(answer('fresh'));
        expect(await old).toMatchObject({cancelled: true});
        expect(await fresh).toEqual(answer('fresh'));
    });

    it('cancels by disallowed sender and by dispose', async () => {
        let blocked = false;
        const {handler, ready, runs} = setup({eligibility: () => blocked ? '网站已禁用' : undefined});
        ready.resolve();
        const first = handler.handle(request('first'), sender());
        await tick();
        blocked = true;
        handler.cancelDisallowed();
        runs[0].resolve(answer('late'));
        expect(await first).toMatchObject({cancelled: true});
        blocked = false;
        const second = handler.handle(request('second'), sender());
        await tick();
        handler.dispose();
        runs[1].resolve(answer('late-2'));
        expect(await second).toMatchObject({cancelled: true});
        expect(await handler.handle(request('after'), sender())).toEqual({success: false, error: '无效的阅读请求'});
    });

    it('rejects an initially disallowed page and reports non-cancellation failures', async () => {
        const blocked = setup({eligibility: () => '当前网站已禁用'});
        blocked.ready.resolve();
        expect(await blocked.handler.handle(request('blocked'), sender())).toEqual({success: false, error: '当前网站已禁用'});
        const failed = setup({ready: Promise.resolve(), run: async () => { throw new Error('provider failed'); }});
        expect(await failed.handler.handle(request('failed'), sender())).toEqual({success: false, error: '理解请求未完成，请重试'});
    });

    it('uses sender fallbacks and rejects a completed request id', async () => {
        const {handler, ready, runs} = setup();
        ready.resolve();
        const fallbackSender: ReadingSender = {id: 'extension-id', tab: {id: 21, url: 'https://fallback.test/'}, url: 'https://fallback.test/'};
        const pending = handler.handle(request('fallback'), fallbackSender);
        await tick();
        runs[0].resolve(answer('fallback'));
        expect(await pending).toEqual(answer('fallback'));
        expect(await handler.handle(request('fallback'), fallbackSender)).toMatchObject({cancelled: true});
        const emptyFallback: ReadingSender = {id: 'extension-id', tab: {id: 22}};
        const second = handler.handle(request('empty'), emptyFallback);
        await tick();
        runs[1].resolve(answer('empty'));
        expect(await second).toEqual(answer('empty'));
    });

    it('covers no-op cancellation predicates and evicts the oldest seen key', async () => {
        const {handler, ready} = setup({ready: Promise.resolve(), run: async requestValue => answer(requestValue.requestId)});
        ready.resolve();
        handler.cancelTab(999);
        handler.cancelDisallowed();
        for (let index = 0; index < 129; index += 1) {
            expect(await handler.handle(request(`evict-${index}`), sender(30 + index))).toEqual(answer(`evict-${index}`));
        }
        expect(await handler.handle(request('evict-0'), sender(30))).toEqual(answer('evict-0'));
    });

    it('cancelAll aborts every active owner', async () => {
        const {handler, ready, runs} = setup();
        ready.resolve();
        const first = handler.handle(request('all-a'), sender(10));
        const second = handler.handle(request('all-b'), sender(11));
        await tick();
        handler.cancelAll();
        runs[0].resolve(answer('late-a'));
        runs[1].resolve(answer('late-b'));
        expect(await first).toMatchObject({cancelled: true});
        expect(await second).toMatchObject({cancelled: true});
    });

    it('rejects a result when navigation makes the sender ineligible', async () => {
        let navigated = false;
        const {handler, ready, runs} = setup({eligibility: () => navigated ? '当前页面已变化' : undefined});
        ready.resolve();
        const pending = handler.handle(request('nav'), sender());
        await tick();
        navigated = true;
        runs[0].resolve(answer('late-navigation'));
        expect(await pending).toEqual({success: false, error: '当前页面已变化'});
    });

    it('enforces four concurrent requests and releases the slot after completion', async () => {
        const {handler, ready, runs} = setup();
        ready.resolve();
        const pending = Array.from({length: 4}, (_, index) => handler.handle(request(`r${index}`), sender(index + 1)));
        await tick();
        expect(runs).toHaveLength(4);
        expect(await handler.handle(request('r4'), sender(9))).toEqual({success: false, error: '正在处理其他阅读请求，请稍后再试'});
        for (const [index, work] of runs.entries()) work.resolve(answer(String(index)));
        await Promise.all(pending);
        const fifth = handler.handle(request('r5'), sender(9));
        await tick();
        runs[4].resolve(answer('fifth'));
        expect(await fifth).toEqual(answer('fifth'));
    });

    it('uses a hard total timeout even when run ignores AbortSignal', async () => {
        vi.useFakeTimers();
        const ready = Promise.resolve();
        const never = new Promise<ReadingResponse>(() => undefined);
        const deps: ReadingHandlerDependencies = {extensionId: 'extension-id', ready, eligibility: () => undefined, run: () => never};
        const handler = createReadingAssistantHandler(deps);
        const pending = handler.handle(request('timeout'), sender());
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(pending).resolves.toMatchObject({cancelled: true});
    });

    it('handles synchronous abort before the run promise is wrapped', async () => {
        let handler: ReturnType<typeof createReadingAssistantHandler> | undefined;
        const deps: ReadingHandlerDependencies = {
            extensionId: 'extension-id', ready: Promise.resolve(), eligibility: () => undefined,
            run: () => { handler?.cancelAll(); return Promise.resolve(answer('late')); },
        };
        handler = createReadingAssistantHandler(deps);
        await expect(handler.handle(request('sync-abort'), sender())).resolves.toMatchObject({cancelled: true});
    });

    it('does not let cleanup delete a replacement that dispose already removed', async () => {
        let handler: ReturnType<typeof createReadingAssistantHandler> | undefined;
        const deps: ReadingHandlerDependencies = {
            extensionId: 'extension-id', ready: Promise.resolve(), eligibility: () => undefined,
            run: () => { handler?.dispose(); return Promise.resolve(answer('late')); },
        };
        handler = createReadingAssistantHandler(deps);
        await expect(handler.handle(request('disposed-during-run'), sender(23))).resolves.toMatchObject({cancelled: true});
    });

    it('observes cancellation between ready resolution and the eligibility check', async () => {
        let handler: ReturnType<typeof createReadingAssistantHandler> | undefined;
        const ready = {then(resolve: (value: void) => void) { resolve(); queueMicrotask(() => handler?.cancelAll()); }} as unknown as Promise<void>;
        const deps: ReadingHandlerDependencies = {extensionId: 'extension-id', ready, eligibility: () => undefined, run: async () => answer('late')};
        handler = createReadingAssistantHandler(deps);
        await expect(handler.handle(request('ready-race'), sender(24))).resolves.toMatchObject({cancelled: true});
    });

    it('rejects a late non-abort result when ownership has been replaced', async () => {
        const originalAbort = AbortController.prototype.abort;
        AbortController.prototype.abort = function abortNoop() { return undefined; };
        try {
            const {handler, ready, runs} = setup();
            ready.resolve();
            const old = handler.handle(request('owned-old'), sender(40));
            await tick();
            const fresh = handler.handle(request('owned-fresh'), sender(40));
            await tick();
            runs[0].resolve(answer('old-late'));
            runs[1].resolve(answer('fresh'));
            expect(await old).toMatchObject({cancelled: true});
            expect(await fresh).toEqual(answer('fresh'));
        } finally {
            AbortController.prototype.abort = originalAbort;
        }
    });
});
