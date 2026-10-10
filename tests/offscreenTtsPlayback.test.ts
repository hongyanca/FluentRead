import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {SpeechProgress} from '@/src/core/tts/speechProgress';
import {
    createSelectionTtsPlayer,
    parseSelectionTtsPlaybackRequest,
    type SelectionAudioPort,
    type SelectionTtsPlaybackRequest,
} from '@/src/app/offscreen/ttsPlayback';

class FakeAudio implements SelectionAudioPort {
    currentTime: number | undefined = 0;
    duration: number | undefined = 4;
    preload = '';
    src = '';
    onended: ((event: Event) => void) | null = null;
    onerror: ((event: Event | string) => void) | null = null;
    pause = vi.fn();
    load = vi.fn();
    play = vi.fn(async (): Promise<void> => undefined);
    removeAttribute = vi.fn((name: string) => {
        if (name === 'src') this.src = '';
    });
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return {promise, reject, resolve};
}

function route(clientRequestId: string, tabId = 1) {
    return {tabId, clientRequestId};
}

const players: ReturnType<typeof createSelectionTtsPlayer>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    for (const player of players.splice(0)) player.dispose();
    vi.useRealTimers();
});

function fixture(progressEnabled = true) {
    const audios: FakeAudio[] = [];
    const notifications: Array<{request: SelectionTtsPlaybackRequest; state: string; error?: unknown}> = [];
    const progressNotifications: Array<{request: SelectionTtsPlaybackRequest; progress: SpeechProgress}> = [];
    const notifyProgress = vi.fn((request: SelectionTtsPlaybackRequest, progress: SpeechProgress) => {
        progressNotifications.push({request, progress});
    });
    const decodeBase64 = vi.fn(() => new Uint8Array([1, 2, 3]));
    const createObjectUrl = vi.fn(() => `blob:${audios.length}`);
    const revokeObjectUrl = vi.fn();
    const defaultCreateAudio = () => {
            const audio = new FakeAudio();
            audios.push(audio);
            return audio;
    };
    let createAudio = defaultCreateAudio;
    const player = createSelectionTtsPlayer({
        createAudio: () => createAudio(),
        decodeBase64,
        createObjectUrl,
        revokeObjectUrl,
        notify: (request, state, error) => notifications.push({request, state, error}),
        ...(progressEnabled ? {notifyProgress} : {}),
    });
    players.push(player);
    return {
        audios,
        createObjectUrl,
        decodeBase64,
        notifications,
        notifyProgress,
        progressNotifications,
        player,
        revokeObjectUrl,
        setCreateAudio: (next: (() => FakeAudio) | undefined) => { createAudio = next ?? defaultCreateAudio; },
    };
}

describe('Offscreen 划词 TTS 播放状态机', () => {
    it('严格校验请求对象、音频来源和自描述路由', () => {
        expect(parseSelectionTtsPlaybackRequest({sourceUrl: ' https://audio ', tabId: 0, clientRequestId: 'request-1'}))
            .toEqual({sourceUrl: ' https://audio ', audioBase64: undefined, contentType: undefined, tabId: 0, clientRequestId: 'request-1'});
        expect(parseSelectionTtsPlaybackRequest({audioBase64: 'YQ==', contentType: 'audio/mp3', tabId: 2, clientRequestId: 'request-3'}))
            .toMatchObject({audioBase64: 'YQ==', contentType: 'audio/mp3', tabId: 2, clientRequestId: 'request-3'});
        expect(() => parseSelectionTtsPlaybackRequest(null)).toThrow('必须是对象');
        expect(() => parseSelectionTtsPlaybackRequest([])).toThrow('必须是对象');
        expect(() => parseSelectionTtsPlaybackRequest({...route('request-2')})).toThrow('必须且只能提供一种');
        expect(() => parseSelectionTtsPlaybackRequest({sourceUrl: 'x', audioBase64: 'y', ...route('request-2')}))
            .toThrow('必须且只能提供一种');
        expect(() => parseSelectionTtsPlaybackRequest({sourceUrl: ' ', ...route('request-2')})).toThrow('sourceUrl');
        expect(() => parseSelectionTtsPlaybackRequest({audioBase64: 'x', contentType: 1, ...route('request-2')}))
            .toThrow('contentType');
        for (const tabId of ['0', -1, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => parseSelectionTtsPlaybackRequest({sourceUrl: 'x', tabId, clientRequestId: 'request-2'})).toThrow('tabId');
        }
        expect(() => parseSelectionTtsPlaybackRequest({sourceUrl: 'x', tabId: 0, clientRequestId: 1.5})).toThrow('clientRequestId');
    });

    it('播放 URL 音频并在 ended 后完整释放且只通知一次', async () => {
        const state = fixture();
        await state.player.play({sourceUrl: 'https://audio.test/a.mp3', ...route('request-7', 0)});
        const audio = state.audios[0];
        expect(audio.preload).toBe('auto');
        expect(audio.src).toBe('https://audio.test/a.mp3');
        expect(audio.play).toHaveBeenCalledOnce();

        audio.onended?.(new Event('ended'));
        expect(audio.pause).toHaveBeenCalledOnce();
        expect(audio.removeAttribute).toHaveBeenCalledWith('src');
        expect(audio.load).toHaveBeenCalledOnce();
        expect(state.notifications.map(({state: value}) => value)).toEqual(['ended']);
        expect(state.player.stop(route('request-7', 0))).toBe(false);
        expect(state.revokeObjectUrl).not.toHaveBeenCalled();
    });

    it('Base64 使用默认或显式 MIME 创建 Blob URL，并按跨 worker 路由停止', async () => {
        const state = fixture();
        await state.player.play({audioBase64: 'YQ==', ...route('request-11')});
        expect(state.decodeBase64).toHaveBeenCalledWith('YQ==');
        expect(state.createObjectUrl).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'audio/mpeg');
        expect(state.player.stop(route('request-10'))).toBe(false);
        expect(state.player.stop(route('request-11', 2))).toBe(false);
        expect(state.player.stop(route('request-11'))).toBe(true);
        expect(state.revokeObjectUrl).toHaveBeenCalledWith('blob:1');
        expect(state.notifications.map(({state: value}) => value)).toEqual(['stopped']);

        await state.player.play({audioBase64: 'Yg==', contentType: 'audio/ogg', ...route('request-12')});
        expect(state.createObjectUrl).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]), 'audio/ogg');
        state.player.dispose();
        expect(state.notifications.map(({state: value}) => value)).toEqual(['stopped']);
    });

    it('新资源准备失败不停止当前播放，并回收已创建但未采用的 URL', async () => {
        const state = fixture();
        await state.player.play({sourceUrl: 'https://audio.test/current', ...route('request-1')});
        state.decodeBase64.mockImplementationOnce(() => { throw new Error('bad base64'); });
        await expect(state.player.play({audioBase64: 'bad', ...route('request-2')})).rejects.toThrow('bad base64');
        expect(state.audios[0].pause).not.toHaveBeenCalled();

        state.createObjectUrl.mockImplementationOnce(() => 'blob:orphan');
        const next = state.audios.length;
        state.setCreateAudio(() => {
            const audio = new FakeAudio();
            state.audios.push(audio);
            Object.defineProperty(audio, 'src', {set() { throw new Error('src rejected'); }});
            return audio;
        });
        await expect(state.player.play({audioBase64: 'YQ==', ...route('request-3')})).rejects.toThrow('src rejected');
        expect(state.audios).toHaveLength(next + 1);
        expect(state.revokeObjectUrl).toHaveBeenCalledWith('blob:orphan');
        expect(state.audios[0].pause).not.toHaveBeenCalled();
    });

    it('新请求替换旧请求，旧回调和迟到 reject 不会污染新状态或泄漏 URL', async () => {
        const state = fixture();
        const oldPlay = deferred<void>();
        state.setCreateAudio(() => {
            const audio = new FakeAudio();
            audio.play.mockReturnValue(oldPlay.promise);
            state.audios.push(audio);
            return audio;
        });
        const pending = state.player.play({audioBase64: 'pending', ...route('old-request')});
        await Promise.resolve();
        const staleEnded = state.audios[0].onended;
        state.setCreateAudio(undefined);
        await state.player.play({sourceUrl: 'https://audio.test/new', ...route('new-request')});
        expect(state.player.stop(route('old-request'))).toBe(false);
        staleEnded?.(new Event('ended'));
        oldPlay.reject(new Error('late failure'));
        await expect(pending).rejects.toThrow('late failure');

        expect(state.notifications.map(({state: value}) => value)).toContain('stopped');
        expect(state.notifications.filter(({state: value}) => value === 'error')).toHaveLength(0);
        expect(state.audios[1].pause).not.toHaveBeenCalled();
    });

    it('已开始播放的 error 走通知，启动 play 拒绝只走失败响应并释放资源', async () => {
        const eventState = fixture();
        await eventState.player.play({audioBase64: 'event', ...route('request-4', 2)});
        const staleError = eventState.audios[0].onerror;
        staleError?.(new Event('error'));
        expect(eventState.notifications).toHaveLength(1);
        expect(eventState.notifications[0].state).toBe('error');
        expect(eventState.notifications[0].error).toBeInstanceOf(Error);
        staleError?.(new Event('error'));
        expect(eventState.notifications).toHaveLength(1);

        const rejectionState = fixture();
        const failure = new Error('autoplay blocked');
        rejectionState.setCreateAudio(() => {
            const audio = new FakeAudio();
            audio.play.mockRejectedValue(failure);
            rejectionState.audios.push(audio);
            return audio;
        });
        await expect(rejectionState.player.play({sourceUrl: 'https://audio', ...route('request-5', 2)}))
            .rejects.toBe(failure);
        expect(rejectionState.notifications).toEqual([]);
        expect(rejectionState.audios[0].pause).toHaveBeenCalledOnce();
    });


    it('同一次启动先触发媒体 error 再拒绝 play 仍只有 PLAY 失败响应', async () => {
        const state = fixture();
        const failure = new Error('media startup failed');
        state.setCreateAudio(() => {
            const audio = new FakeAudio();
            audio.play.mockImplementation(async () => {
                audio.onerror?.(new Event('error'));
                throw failure;
            });
            state.audios.push(audio);
            return audio;
        });
        await expect(state.player.play({audioBase64: 'pending', ...route('startup')})).rejects.toBe(failure);
        expect(state.notifications).toEqual([]);
        expect(state.audios[0].pause).toHaveBeenCalledOnce();
        expect(state.revokeObjectUrl).toHaveBeenCalledOnce();
        expect(state.player.stop(route('startup'))).toBe(false);
    });

    it('停止参数校验发生在状态变更前，factory 返回独立实例', async () => {
        const state = fixture();
        await state.player.play({sourceUrl: 'https://audio', ...route('request-9')});
        expect(() => state.player.stop('request-9')).toThrow('路由');
        expect(() => state.player.stop({tabId: 1, clientRequestId: 9})).toThrow('clientRequestId');
        expect(state.audios[0].pause).not.toHaveBeenCalled();
        expect(fixture().player).not.toBe(state.player);
    });
});

describe('Offscreen TTS media progress', () => {
    const text = 'Hello world. 你好世界';
    const timings = [
        {startChar: 0, endChar: 12, startTime: 0, endTime: 1},
        {startChar: 13, endChar: 17, startTime: 1, endTime: 5},
    ];

    it('5 秒跳转使用媒体时间并立即更新高亮，不重建音频或干扰另一条路由', async () => {
        const state = fixture();
        expect(state.player.seek({...route('old'),offsetSeconds:5})).toBe(false);
        await state.player.play({sourceUrl:'https://audio',text:'Hello world',...route('seek',0)});
        const audio=state.audios[0];audio.duration=12;audio.currentTime=2;
        expect(state.player.seek({...route('seek',1),offsetSeconds:5})).toBe(false);
        expect(state.player.seek({...route('old',0),offsetSeconds:5})).toBe(false);
        expect(audio.currentTime).toBe(2);
        expect(state.player.seek({...route('seek',0),offsetSeconds:5})).toBe(true);
        expect(audio.currentTime).toBe(7);
        expect(state.progressNotifications.at(-1)?.progress.start).toBe(6);
        expect(state.notifyProgress).toHaveBeenLastCalledWith(expect.objectContaining(route('seek',0)),expect.any(Object),{currentTime:7,duration:12});
        expect(state.player.seek({...route('seek',0),offsetSeconds:5})).toBe(true);
        expect(audio.currentTime).toBe(12);
        expect(state.player.seek({...route('seek',0),offsetSeconds:-5})).toBe(true);
        expect(audio.currentTime).toBe(7);
        state.player.seek({...route('seek',0),offsetSeconds:-5});state.player.seek({...route('seek',0),offsetSeconds:-5});
        expect(audio.currentTime).toBe(0);
        expect(state.audios).toHaveLength(1);expect(audio.play).toHaveBeenCalledOnce();expect(state.notifications).toEqual([]);
        audio.duration=NaN;expect(state.player.seek({...route('seek',0),offsetSeconds:5})).toBe(false);
        audio.duration=undefined;expect(state.player.seek({...route('seek',0),offsetSeconds:5})).toBe(false);
        audio.duration=12;audio.currentTime=undefined;expect(state.player.seek({...route('seek',0),offsetSeconds:5})).toBe(false);
        expect(()=>state.player.seek({...route('seek',0),offsetSeconds:15})).toThrow('5 秒');
        state.player.stop(route('seek',0));expect(state.player.seek({...route('seek',0),offsetSeconds:5})).toBe(false);
        const legacy=fixture();await legacy.player.play({sourceUrl:'https://audio/legacy',...route('legacy-seek')});
        expect(legacy.player.seek({...route('legacy-seek'),offsetSeconds:5})).toBe(true);
        expect(legacy.notifyProgress).not.toHaveBeenCalled();
        const silent=fixture(false);await silent.player.play({sourceUrl:'https://audio',text:'Hello',...route('silent-seek')});
        expect(silent.player.seek({...route('silent-seek'),offsetSeconds:5})).toBe(true);
    });

    it('samples actual currentTime every 100ms and uses chunk timings for words, Chinese characters and seeks', async () => {
        const state = fixture();
        await state.player.play({sourceUrl: 'https://audio', text, timings, ...route('timed-request', 0)});
        const audio = state.audios[0];
        audio.duration = 5;
        expect(state.progressNotifications).toEqual([
            {request: expect.objectContaining(route('timed-request', 0)), progress: {start: 0, end: 5, fraction: 0, estimated: true}},
        ]);
        audio.currentTime = 3;
        await vi.advanceTimersByTimeAsync(99);
        expect(state.notifyProgress).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(state.progressNotifications.at(-1)?.progress).toEqual({start: 15, end: 16, fraction: 0, estimated: true});
        // 墙钟过去一秒但媒体时间未变，进度必须停在同一个字。
        await vi.advanceTimersByTimeAsync(1_000);
        expect(state.progressNotifications.slice(1).every(({progress}) => progress.start === 15 && progress.fraction === 0)).toBe(true);
        audio.currentTime = 0.75;
        await vi.advanceTimersByTimeAsync(100);
        expect(state.progressNotifications.at(-1)?.progress).toEqual({start: 6, end: 11, fraction: 0.6, estimated: true});
        audio.currentTime = 5;
        await vi.advanceTimersByTimeAsync(100);
        expect(state.progressNotifications.at(-1)?.progress).toEqual({start: 16, end: 17, fraction: 1, estimated: true});
        expect(state.progressNotifications.every(({request}) => request.tabId === 0 && request.clientRequestId === 'timed-request')).toBe(true);
    });

    it.each(['stop', 'ended', 'error', 'dispose'] as const)('clears the progress timer on %s and ignores retained callbacks', async terminal => {
        const state = fixture();
        await state.player.play({audioBase64: 'YQ==', text, timings, ...route('cleanup-request')});
        const audio = state.audios[0];
        const ended = audio.onended, error = audio.onerror;
        expect(vi.getTimerCount()).toBe(1);
        expect(state.player.stop(route('cleanup-request', 2))).toBe(false);
        expect(state.player.stop(route('different-request'))).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        if (terminal === 'stop') expect(state.player.stop(route('cleanup-request'))).toBe(true);
        else if (terminal === 'ended') ended?.(new Event('ended'));
        else if (terminal === 'error') error?.(new Event('error'));
        else state.player.dispose();
        expect(vi.getTimerCount()).toBe(0);
        expect(audio.onended).toBeNull();
        expect(audio.onerror).toBeNull();
        expect(audio.pause).toHaveBeenCalledOnce();
        expect(state.revokeObjectUrl).toHaveBeenCalledOnce();
        expect(state.revokeObjectUrl).toHaveBeenCalledWith('blob:1');
        const progressCount = state.notifyProgress.mock.calls.length;
        audio.currentTime = 3;
        ended?.(new Event('ended'));
        error?.(new Event('error'));
        await vi.advanceTimersByTimeAsync(1_000);
        expect(state.notifyProgress).toHaveBeenCalledTimes(progressCount);
        expect(state.notifications.map(({state: value}) => value)).toEqual(terminal === 'dispose' ? [] : [terminal === 'stop' ? 'stopped' : terminal]);
    });

    it('replaces the old progress timer and routes later ticks only to the new tab and request', async () => {
        const state = fixture();
        await state.player.play({audioBase64: 'YQ==', text, timings, ...route('old', 0)});
        const oldAudio = state.audios[0], staleEnded = oldAudio.onended, staleError = oldAudio.onerror;
        expect(vi.getTimerCount()).toBe(1);
        await state.player.play({sourceUrl: 'https://audio/new', text: '你好世界', ...route('new', 2)});
        expect(vi.getTimerCount()).toBe(1);
        const oldCount = state.progressNotifications.filter(({request}) => request.clientRequestId === 'old').length;
        const newAudio = state.audios[1];
        oldAudio.currentTime = 3;
        newAudio.currentTime = 1.5;
        staleEnded?.(new Event('ended'));
        staleError?.(new Event('error'));
        expect(state.player.stop(route('old', 0))).toBe(false);
        await vi.advanceTimersByTimeAsync(100);
        expect(state.progressNotifications.filter(({request}) => request.clientRequestId === 'old')).toHaveLength(oldCount);
        expect(state.progressNotifications.at(-1)).toEqual({
            request: expect.objectContaining(route('new', 2)),
            progress: {start: 1, end: 2, fraction: 0.5, estimated: true},
        });
        expect(newAudio.pause).not.toHaveBeenCalled();
        expect(state.notifications).toEqual([expect.objectContaining({request: expect.objectContaining(route('old', 0)), state: 'stopped'})]);
        expect(state.revokeObjectUrl).toHaveBeenCalledOnce();
        expect(state.revokeObjectUrl).toHaveBeenCalledWith('blob:1');
        state.player.stop(route('new', 2));
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['stop', 'replace', 'reject'] as const)('does not start a timer for a pending play promise after %s', async action => {
        const state = fixture();
        const delayed = deferred<void>();
        state.setCreateAudio(() => {
            const audio = new FakeAudio();
            audio.play.mockReturnValue(delayed.promise);
            state.audios.push(audio);
            return audio;
        });
        const pending = state.player.play({audioBase64: 'YQ==', text, timings, ...route('pending')});
        expect(vi.getTimerCount()).toBe(0);
        expect(state.notifyProgress).not.toHaveBeenCalled();
        if (action === 'replace') {
            state.setCreateAudio(undefined);
            await state.player.play({sourceUrl: 'https://audio/new', text: 'New audio', ...route('replacement')});
        } else if (action === 'stop') state.player.stop(route('pending'));
        if (action === 'reject') {
            delayed.reject(new Error('autoplay blocked'));
            await expect(pending).rejects.toThrow('autoplay blocked');
        } else {
            delayed.resolve();
            await pending;
        }
        expect(vi.getTimerCount()).toBe(action === 'replace' ? 1 : 0);
        await vi.advanceTimersByTimeAsync(500);
        expect(state.progressNotifications.every(({request}) => request.clientRequestId === 'replacement')).toBe(true);
        if (action === 'replace') expect(state.notifyProgress).toHaveBeenCalledTimes(6);
        else expect(state.notifyProgress).not.toHaveBeenCalled();
    });

    it('supports legacy requests without text and callers without a progress callback', async () => {
        const legacy = fixture();
        await legacy.player.play({sourceUrl: 'https://audio/legacy', ...route('legacy')});
        expect(legacy.audios[0].play).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(legacy.notifyProgress).not.toHaveBeenCalled();
        legacy.audios[0].onended?.(new Event('ended'));
        expect(legacy.notifications[0].state).toBe('ended');
        const noProgress = fixture(false);
        await noProgress.player.play({sourceUrl: 'https://audio', text, timings, ...route('no-callback')});
        expect(noProgress.audios[0].play).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 0])('waits for valid duration metadata (%s) then reports estimated progress without timestamps', async duration => {
        const state = fixture();
        state.setCreateAudio(() => {
            const audio = new FakeAudio();
            audio.duration = duration;
            audio.currentTime = undefined;
            state.audios.push(audio);
            return audio;
        });
        await state.player.play({sourceUrl: 'https://audio', text: 'Hello world', ...route('metadata')});
        await vi.advanceTimersByTimeAsync(100);
        expect(state.notifyProgress).not.toHaveBeenCalled();
        const audio = state.audios[0];
        audio.currentTime = 1.5;
        await vi.advanceTimersByTimeAsync(100);
        expect(state.notifyProgress).not.toHaveBeenCalled();
        audio.duration = 3;
        await vi.advanceTimersByTimeAsync(100);
        expect(state.progressNotifications.at(-1)?.progress).toEqual({start: 6, end: 11, fraction: 0, estimated: true});
        expect(state.notifications).toEqual([]);
        state.player.stop(route('metadata'));
        expect(vi.getTimerCount()).toBe(0);
    });
});
