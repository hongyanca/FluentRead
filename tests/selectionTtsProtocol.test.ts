import {describe, expect, it} from 'vitest';
import {parseSpeechCues, parseSpeechProgress} from '@/src/core/tts/speechProgress';

import {
    createSelectionTtsClientRequestId,
    matchesSelectionTtsClientRequest,
    parseSelectionTtsClientRequestId,
    parseSelectionTtsPlaybackState,
    parseSelectionTtsRoute,
    parseSelectionTtsTabId,
    sameSelectionTtsRoute,
} from '@/src/features/selection-translation/protocol';

describe('划词 TTS 跨 worker 协议', () => {
    it('client request ID 由 UUID 生成器创建并规范化', () => {
        expect(createSelectionTtsClientRequestId({
            randomUUID: () => '  stable-request-id  ',
            getRandomValues: crypto.getRandomValues.bind(crypto),
        })).toBe('stable-request-id');
        expect(createSelectionTtsClientRequestId()).toMatch(/^[0-9a-f-]{36}$/u);
        expect(createSelectionTtsClientRequestId({
            getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
                (array as Uint8Array).fill(0);
                return array;
            },
        })).toBe('00000000-0000-4000-8000-000000000000');
        expect(parseSelectionTtsClientRequestId(' request-id ')).toBe('request-id');
        expect(() => parseSelectionTtsClientRequestId(1)).toThrow('clientRequestId');
        expect(() => parseSelectionTtsClientRequestId('   ')).toThrow('clientRequestId');
        expect(() => parseSelectionTtsClientRequestId('x'.repeat(129))).toThrow('clientRequestId');
    });

    it('tabId 仅接受包含 0 的非负安全整数', () => {
        expect(parseSelectionTtsTabId(0)).toBe(0);
        expect(parseSelectionTtsTabId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
        for (const value of ['0', 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => parseSelectionTtsTabId(value)).toThrow('tabId');
        }
    });

    it('路由和播放状态严格校验，匹配时同时比较 tab 与 UUID', () => {
        const route = {tabId: 0, clientRequestId: 'request-a'};
        expect(parseSelectionTtsRoute(route)).toEqual(route);
        for (const value of [null, 'route', []]) {
            expect(() => parseSelectionTtsRoute(value)).toThrow('路由');
        }

        for (const state of ['ended', 'stopped', 'error', 'progress'] as const) {
            expect(parseSelectionTtsPlaybackState(state)).toBe(state);
        }
        expect(() => parseSelectionTtsPlaybackState(1)).toThrow('state');
        expect(() => parseSelectionTtsPlaybackState('playing')).toThrow('state');

        expect(sameSelectionTtsRoute(route, {...route})).toBe(true);
        expect(sameSelectionTtsRoute(route, {...route, tabId: 1})).toBe(false);
        expect(sameSelectionTtsRoute(route, {...route, clientRequestId: 'request-b'})).toBe(false);

        expect(matchesSelectionTtsClientRequest('new-request', 'new-request', null)).toBe(true);
        expect(matchesSelectionTtsClientRequest('pending-request', null, 'pending-request')).toBe(true);
        expect(matchesSelectionTtsClientRequest('old-stopped', 'new-request', null)).toBe(false);
        expect(matchesSelectionTtsClientRequest(null, null, null)).toBe(false);
    });
});

describe('TTS timing and progress message metadata', () => {
    const cue = {startChar: 0, endChar: 5, startTime: 0, endTime: 1};
    const progress = {start: 0, end: 5, fraction: 0.5, estimated: true};

    it('preserves ordered character and time gaps while removing fields outside the cue contract', () => {
        const cues = [
            {...cue, privateField: 'discard'},
            {startChar: 7, endChar: 12, startTime: 2, endTime: 3},
        ];
        const parsed = parseSpeechCues(cues);
        expect(parsed).toEqual([cue, cues[1]]);
        expect(parsed).not.toBe(cues);
        expect(parsed[0]).not.toBe(cues[0]);
        expect(cues[0]).toHaveProperty('privateField', 'discard');
        expect(parseSpeechCues([])).toEqual([]);
        const maximum = Array.from({length: 2048}, (_, index) => ({
            startChar: index, endChar: index + 1, startTime: index, endTime: index + 1,
        }));
        expect(parseSpeechCues(maximum)).toEqual(maximum);
        expect(parseSpeechCues([...maximum, {startChar: 2048, endChar: 2049, startTime: 2048, endTime: 2049}])).toEqual([]);
    });

    it.each([
        ['missing', undefined], ['null', null], ['object', {}], ['nonobject item', [null]],
        ['string item', ['cue']], ['missing fields', [{}]],
        ['fractional start', [{...cue, startChar: 0.5}]],
        ['unsafe end', [{...cue, endChar: Number.MAX_SAFE_INTEGER + 1}]],
        ['negative start', [{...cue, startChar: -1}]],
        ['empty range', [{...cue, endChar: 0}]],
        ['invalid start time', [{...cue, startTime: Number.NaN}]],
        ['invalid end time', [{...cue, endTime: Number.POSITIVE_INFINITY}]],
        ['negative time', [{...cue, startTime: -1}]],
        ['empty duration', [{...cue, endTime: 0}]],
        ['overlapping text', [cue, {...cue, startChar: 4, endChar: 9, startTime: 1, endTime: 2}]],
        ['overlapping time', [cue, {...cue, startChar: 5, endChar: 10, startTime: 0.5, endTime: 2}]],
    ])('drops the entire cue list for %s metadata', (_reason, value) => {
        expect(parseSpeechCues(value)).toEqual([]);
    });

    it('accepts inclusive progress endpoints and keeps the estimated precision flag', () => {
        expect(parseSpeechProgress({...progress, fraction: 0, ignored: 'extra'})).toEqual({...progress, fraction: 0});
        expect(parseSpeechProgress({...progress, fraction: 1, estimated: false})).toEqual({...progress, fraction: 1, estimated: false});
    });

    it.each([
        undefined, null, 'progress', {},
        {...progress, start: 0.5}, {...progress, end: Number.MAX_SAFE_INTEGER + 1},
        {...progress, start: -1}, {...progress, end: 0},
        {...progress, fraction: Number.NaN}, {...progress, fraction: -0.1}, {...progress, fraction: 1.1},
        {...progress, estimated: 'true'},
    ])('rejects malformed progress %j', value => {
        expect(parseSpeechProgress(value)).toBeNull();
    });
});
