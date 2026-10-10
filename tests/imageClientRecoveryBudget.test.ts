/**
 * 通过真实客户端公开入口验证图片和漫画的总恢复预算；仅控制 runtime 端口与两种时钟。
 * 定时器与单调时钟同步推进，墙钟跳变单独设置，不将系统时间调整当作真实耗时。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {translateImageInExtension} from '@/src/features/image-translation/services/client';
import {IMAGE_PROGRESS_MESSAGE_TYPE} from '@/src/features/image-translation/progress';

type Message = {type: string; requestId: string; timeoutMs?: number; manga?: boolean};
type ProgressListener = (message: unknown) => void;
type Outcome = {state: 'pending'} | {state: 'resolved'; value: unknown} | {state: 'rejected'; error: unknown};
const WALL_START = 1_700_000_000_000;
const DISCONNECTED = 'The message port closed before a response was received.';

function deferred() {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}

let elapsed: number;
let first: ReturnType<typeof deferred>;
let retry: ReturnType<typeof deferred>;
let control: AbortController;
let signalListeners: Set<unknown>;
let progressListeners: Set<ProgressListener>;
let requests: Message[];
let send: ReturnType<typeof vi.fn>;
let onCancel: ((message: Message) => void) | undefined;
let observations: Promise<void>[];

function observe(promise: ReturnType<typeof translateImageInExtension>) {
    const result: {value: Outcome} = {value: {state: 'pending'}};
    observations.push(promise.then(
        value => {result.value = {state: 'resolved', value};},
        error => {result.value = {state: 'rejected', error};},
    ));
    return result;
}

async function advance(ms: number) {
    elapsed += ms;
    await vi.advanceTimersByTimeAsync(ms);
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout']});
    vi.setSystemTime(WALL_START);
    elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    first = deferred();
    retry = deferred();
    control = new AbortController();
    signalListeners = new Set();
    progressListeners = new Set();
    requests = [];
    observations = [];
    onCancel = undefined;
    const add = control.signal.addEventListener.bind(control.signal);
    const remove = control.signal.removeEventListener.bind(control.signal);
    vi.spyOn(control.signal, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') signalListeners.add(listener);
        add(type, listener, options);
    });
    vi.spyOn(control.signal, 'removeEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') signalListeners.delete(listener);
        remove(type, listener, options);
    });
    send = vi.fn((message: Message) => {
        if (message.type === 'fluentReadImageCancel') {
            onCancel?.(message);
            return Promise.resolve({success: true});
        }
        if (message.type !== 'fluentReadImageTranslate') throw new Error(`Unexpected message: ${message.type}`);
        requests.push(message);
        if (requests.length > 2) return Promise.reject(new Error('Unexpected extra translation attempt'));
        return requests.length === 1 ? first.promise : retry.promise;
    });
    vi.stubGlobal('browser', {runtime: {
        sendMessage: send,
        onMessage: {
            addListener: (listener: ProgressListener) => progressListeners.add(listener),
            removeListener: (listener: ProgressListener) => progressListeners.delete(listener),
        },
    }});
});

afterEach(async () => {
    try {
        // 旧实现断言失败时也取消唯一任务并结束受控端口，避免未完成请求跨用例残留。
        control.abort();
        first.resolve({success: true, image: 'late fixture', lines: []});
        retry.resolve({success: true, image: 'late fixture', lines: []});
        await flush();
        await Promise.all(observations);
        expect(progressListeners.size).toBe(0);
        expect(signalListeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    } finally {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    }
});

// 真实模块没有 translateImagePixels/translateMangaPixels 导出，漫画复用同一公开入口的 manga 选项。
describe.each([{kind: 'image', manga: false}, {kind: 'manga', manga: true}])(
    'image client monotonic recovery budget: $kind', ({manga}) => {
        it.each([-300_000, 300_000])('keeps the 1s total budget after a %sms wall-clock jump', async jump => {
            const progress = vi.fn();
            const result = observe(translateImageInExtension('source fixture', 'en', 'Budget fixture', {
                manga, requestId: 'budget-original', timeoutMs: 1_000, signal: control.signal, onProgress: progress,
            }));
            const oldProgress = [...progressListeners][0];
            expect(requests[0]).toMatchObject({requestId: 'budget-original', timeoutMs: 1_000});
            expect(requests[0].manga).toBe(manga ? true : undefined);
            await advance(400);
            vi.setSystemTime(Date.now() + jump);
            first.resolve({success: false, error: DISCONNECTED});
            await flush();
            expect(send.mock.calls.map(([message]) => message.type)).toEqual([
                'fluentReadImageTranslate', 'fluentReadImageCancel', 'fluentReadImageTranslate',
            ]);
            expect(send.mock.calls[1][0]).toEqual({type: 'fluentReadImageCancel', requestId: 'budget-original'});
            expect(requests[1]).toMatchObject({timeoutMs: 600});
            expect(requests[1].requestId).not.toBe('budget-original');
            const currentProgress = [...progressListeners][0];
            oldProgress({type: IMAGE_PROGRESS_MESSAGE_TYPE, requestId: 'budget-original', stage: 'rendering', progress: 80});
            currentProgress({type: IMAGE_PROGRESS_MESSAGE_TYPE, requestId: 'budget-original', stage: 'rendering', progress: 80});
            expect(progress).not.toHaveBeenCalled();
            currentProgress({type: IMAGE_PROGRESS_MESSAGE_TYPE, requestId: requests[1].requestId, stage: 'recognizing', progress: 37.9});
            expect(progress).toHaveBeenCalledTimes(1);
            expect(progress).toHaveBeenLastCalledWith('recognizing', 37);
            await advance(599);
            expect(result.value.state).toBe('pending');
            expect(vi.getTimerCount()).toBe(1);
            await advance(1);
            expect(result.value).toEqual({state: 'rejected', error: expect.objectContaining({name: 'TimeoutError', message: '图片翻译超时'})});
            expect(send.mock.calls[3][0]).toEqual({type: 'fluentReadImageCancel', requestId: requests[1].requestId});
            expect(send).toHaveBeenCalledTimes(4);
            expect(progressListeners.size).toBe(0);
            expect(signalListeners.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
            retry.reject(new Error('late controlled recovery rejection'));
            currentProgress({type: IMAGE_PROGRESS_MESSAGE_TYPE, requestId: requests[1].requestId, stage: 'rendering', progress: 100});
            await flush();
            expect(progress).toHaveBeenCalledTimes(1);
            expect(send).toHaveBeenCalledTimes(4);
        });

        it.each(['first reply', 'cancel notification'] as const)('does not restart a spent elapsed budget at %s', async phase => {
            const result = observe(translateImageInExtension('source fixture', 'en', 'Budget fixture', {
                manga, requestId: 'spent-original', timeoutMs: 1_000, signal: control.signal, onProgress: vi.fn(),
            }));
            await advance(200);
            // 模拟主线程回调占用时间；不运行过期定时器，让真实恢复分支独立检查总预算。
            if (phase === 'first reply') elapsed = 1_001;
            else onCancel = () => {elapsed = 1_001;};
            vi.setSystemTime(Date.now() - 300_000);
            first.reject(new Error(DISCONNECTED));
            await flush();
            expect(result.value).toEqual({state: 'rejected', error: expect.objectContaining({name: 'TimeoutError', message: '图片翻译超时'})});
            expect(requests).toHaveLength(1);
            expect(send.mock.calls.map(([message]) => message.type)).toEqual(phase === 'first reply'
                ? ['fluentReadImageTranslate'] : ['fluentReadImageTranslate', 'fluentReadImageCancel']);
            expect(progressListeners.size).toBe(0);
            expect(signalListeners.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('preserves a successful recovery and its image or manga response', async () => {
            const result = observe(translateImageInExtension('source fixture', 'en', 'Budget fixture', {
                manga, requestId: 'success-original', timeoutMs: 1_000, signal: control.signal, onProgress: vi.fn(),
            }));
            await advance(250);
            first.reject(new Error(DISCONNECTED));
            await flush();
            expect(requests[1]).toMatchObject({timeoutMs: 750});
            const mangaPatches = {width: 20, height: 20, patches: [{x: 0, y: 0, width: 20, height: 20, image: 'data:image/png;base64,AQID'}]};
            const value = manga ? {image: '', lines: [], mangaPatches} : {image: 'translated fixture', lines: []};
            retry.resolve({success: true, ...value});
            await flush();
            expect(result.value).toEqual({state: 'resolved', value});
            expect(send.mock.calls.map(([message]) => message.type)).toEqual([
                'fluentReadImageTranslate', 'fluentReadImageCancel', 'fluentReadImageTranslate',
            ]);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('normalizes the second disconnection without a third attempt', async () => {
            const result = observe(translateImageInExtension('source fixture', 'en', 'Budget fixture', {
                manga, requestId: 'twice-original', timeoutMs: 1_000, signal: control.signal, onProgress: vi.fn(),
            }));
            await advance(200);
            first.reject(new Error(DISCONNECTED));
            await flush();
            expect(requests[1]).toMatchObject({timeoutMs: 800});
            retry.resolve({success: false, error: 'Could not establish connection. Receiving end does not exist.'});
            await flush();
            expect(result.value).toEqual({state: 'rejected', error: expect.objectContaining({
                name: 'Error', message: '图片翻译连接中断，请重试；如果仍然失败，请刷新页面后再试',
            })});
            expect(requests).toHaveLength(2);
            expect(send).toHaveBeenCalledTimes(3);
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each(['resolve', 'reject'] as const)('cancels the current retry and consumes its late %s', async late => {
            const progress = vi.fn();
            const result = observe(translateImageInExtension('source fixture', 'en', 'Budget fixture', {
                manga, requestId: 'abort-original', timeoutMs: 1_000, signal: control.signal, onProgress: progress,
            }));
            await advance(200);
            first.reject(new Error(DISCONNECTED));
            await flush();
            const currentProgress = [...progressListeners][0];
            const retryId = requests[1].requestId;
            control.abort();
            await flush();
            const cancelled = {state: 'rejected', error: expect.objectContaining({name: 'AbortError', message: '图片 OCR 请求已取消'})};
            expect(result.value).toEqual(cancelled);
            expect(send.mock.calls[3][0]).toEqual({type: 'fluentReadImageCancel', requestId: retryId});
            expect(progressListeners.size).toBe(0);
            expect(signalListeners.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
            if (late === 'resolve') retry.resolve({success: true, image: 'late fixture', lines: []});
            else retry.reject(new Error('late controlled aborted rejection'));
            currentProgress({type: IMAGE_PROGRESS_MESSAGE_TYPE, requestId: retryId, stage: 'rendering', progress: 100});
            await flush();
            expect(result.value).toEqual(cancelled);
            expect(progress).not.toHaveBeenCalled();
            expect(requests).toHaveLength(2);
            expect(send).toHaveBeenCalledTimes(4);
        });
    },
);
