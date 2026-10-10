import {describe, expect, it, vi} from 'vitest';
import {createReadingSessionHandler} from '@/src/features/reading-assistant/sessionHandler';
import type {HarnessSessionStore} from '@/src/services/harness/sessionTypes';
const sender = {id: 'ext', tab: {id: 1}, url: 'https://page.test'};
function setup() {
    const store = {captureGeneration: vi.fn(), upsertTurn: vi.fn(), get: vi.fn().mockResolvedValue(null), list: vi.fn().mockResolvedValue({sessions: [], hasMore: false}), delete: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined), prune: vi.fn(), recoverInterrupted: vi.fn()} satisfies HarnessSessionStore;
    const deps = {store, extensionId: 'ext', optionsUrl: 'chrome-extension://ext/options.html', ready: Promise.resolve(), eligibility: vi.fn((): string | undefined => undefined), privateContext: vi.fn(() => false)};
    return {store, deps, handle: createReadingSessionHandler(deps)};
}
describe('Harness history access', () => {
    it('supports paginated list/get/delete/clear for eligible pages and own settings', async () => {
        const {handle, store, deps} = setup();
        expect(await handle({action: 'sessions-list'}, sender)).toEqual({success: true, sessions: [], hasMore: false});
        expect(store.list).toHaveBeenLastCalledWith(0, 30);
        await handle({action: 'sessions-list', offset: 30}, sender);
        expect(store.list).toHaveBeenLastCalledWith(30, 30);
        expect(await handle({action: 'sessions-get', sessionId: 'a'}, sender)).toEqual({success: true, session: null});
        expect(await handle({action: 'sessions-delete', sessionId: 'a'}, sender)).toEqual({success: true});
        expect(store.delete).toHaveBeenCalledWith('a');
        deps.eligibility.mockReturnValue('disabled');
        expect(await handle({action: 'sessions-clear'}, {id: 'ext', url: 'chrome-extension://ext/options.html#settings-harness'})).toEqual({success: true});
        expect(store.clear).toHaveBeenCalledOnce();
    });
    it('rejects external, invalid, private, blocked and malformed operations without storage access', async () => {
        const {handle, store, deps} = setup();
        const request = {action: 'sessions-list'};
        for (const owner of [{}, {...sender, id: 'external'}, {...sender, tab: {id: -1}}, {...sender, tab: {id: 1, incognito: true}}, {id: 'ext', url: 'chrome-extension://ext/options.html.evil'}]) expect(await handle(request, owner)).toMatchObject({success: false});
        deps.privateContext.mockReturnValueOnce(true);
        expect(await handle(request, sender)).toMatchObject({success: false});
        for (const bad of [null, 'x', {}, {action: 'unknown'}, {action: 'sessions-list', offset: -1}, {action: 'sessions-list', offset: 1.5}, {action: 'sessions-get'}, {action: 'sessions-delete', sessionId: 42}, {action: 'sessions-get', sessionId: 'bad id'}]) expect(await handle(bad, sender)).toMatchObject({success: false});
        deps.eligibility.mockReturnValue('blocked');
        expect(await handle(request, sender)).toMatchObject({success: false});
        expect(store.list).not.toHaveBeenCalled();
    });
    it('reports readiness and storage failures without exposing their raw details', async () => {
        const {handle, store, deps} = setup();
        store.clear.mockRejectedValueOnce(new Error('secret'));
        expect(await handle({action: 'sessions-clear'}, sender)).toEqual({success: false, error: '会话操作未完成，请稍后重试'});
        const ready = Promise.reject(new Error('config unavailable'));
        expect(await createReadingSessionHandler({...deps, ready})({action: 'sessions-list'}, sender)).toMatchObject({success: false});
    });
});
