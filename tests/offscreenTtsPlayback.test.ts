import {describe, expect, it, vi} from 'vitest';
import {
    createSelectionTtsPlayer,
    parseSelectionTtsPlaybackRequest,
    type SelectionAudioPort,
    type SelectionTtsPlaybackRequest,
} from '@/src/app/offscreen/ttsPlayback';

class FakeAudio implements SelectionAudioPort {
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

function fixture() {
    const audios: FakeAudio[] = [];
    const notifications: Array<{request: SelectionTtsPlaybackRequest; state: string; error?: unknown}> = [];
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
    });
    return {
        audios,
        createObjectUrl,
        decodeBase64,
        notifications,
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

    it('当前播放的 error 事件和 play 拒绝只上报一次并释放资源', async () => {
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
        expect(rejectionState.notifications).toEqual([
            expect.objectContaining({state: 'error', error: failure}),
        ]);
        expect(rejectionState.audios[0].pause).toHaveBeenCalledOnce();
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
