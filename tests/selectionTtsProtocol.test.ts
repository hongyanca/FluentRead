import {describe, expect, it} from 'vitest';

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

        for (const state of ['ended', 'stopped', 'error'] as const) {
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
