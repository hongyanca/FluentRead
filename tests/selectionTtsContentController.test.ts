import {describe, expect, it, vi} from 'vitest';
import {
    createSelectionTtsContentController,
    SelectionTtsContentController,
} from '@/src/features/selection-translation/content/selectionTtsContentController';

async function flushStops(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function fixture(ids = ['request-1', 'request-2', 'request-3', 'request-4']) {
    const remainingIds = [...ids];
    const stopRemote = vi.fn(async (_clientRequestId: string): Promise<void> => undefined);
    const controller = createSelectionTtsContentController({
        createClientRequestId: () => remainingIds.shift() || 'fallback-request',
        stopRemote,
    });
    return {controller, stopRemote};
}

describe('selection TTS content controller', () => {
    it('clears a failed remote request without leaving a stale pending STOP route', async () => {
        const {controller, stopRemote} = fixture();
        expect(controller.getState()).toEqual({
            generation: 0,
            pendingClientRequestId: null,
            activeClientRequestId: null,
        });
        expect(controller.currentGeneration()).toBe(0);
        expect(controller.isCurrentGeneration(0)).toBe(true);
        expect(controller.isCurrentGeneration(1)).toBe(false);

        const failed = controller.beginRemoteRequest();
        expect(controller.getState().pendingClientRequestId).toBe('request-1');
        expect(controller.completeRemoteRequest(failed, {success: false})).toBe('failed');
        expect(controller.getState().pendingClientRequestId).toBeNull();

        const missingResponse = controller.beginRemoteRequest();
        expect(controller.completeRemoteRequest(missingResponse, undefined)).toBe('failed');
        controller.stop();
        await flushStops();
        expect(stopRemote).not.toHaveBeenCalled();
        expect(controller.currentGeneration()).toBe(1);
    });

    it('tracks page/offscreen completion and matches only the current UUID state protocol', async () => {
        const {controller, stopRemote} = fixture();
        const page = controller.beginRemoteRequest();
        expect(controller.completeRemoteRequest(page, {success: true, transport: 'page'})).toBe('page');
        expect(controller.getState()).toMatchObject({
            pendingClientRequestId: null,
            activeClientRequestId: null,
        });

        const offscreen = controller.beginRemoteRequest();
        expect(controller.completeRemoteRequest(offscreen, {success: true, transport: 'offscreen'})).toBe('offscreen');
        expect(controller.getState().activeClientRequestId).toBe('request-2');
        for (const state of ['ended', 'stopped', 'error'] as const) {
            expect(controller.matchRemoteState({
                type: 'selectionTtsState',
                clientRequestId: 'request-2',
                state,
            })).toBe(state);
        }
        for (const message of [
            null,
            'bad',
            [],
            {type: 'other', clientRequestId: 'request-2', state: 'ended'},
            {type: 'selectionTtsState', clientRequestId: 'old', state: 'ended'},
            {type: 'selectionTtsState', clientRequestId: 'request-2', state: 1},
            {type: 'selectionTtsState', clientRequestId: 'request-2', state: 'playing'},
        ]) {
            expect(controller.matchRemoteState(message)).toBeNull();
        }

        controller.stop();
        await flushStops();
        expect(stopRemote).toHaveBeenCalledWith('request-2');
        expect(controller.getState()).toEqual({
            generation: 1,
            pendingClientRequestId: null,
            activeClientRequestId: null,
        });
    });

    it('stop then new play keeps the new pending UUID and precisely cleans a late offscreen success', async () => {
        const {controller, stopRemote} = fixture();
        const oldRequest = controller.beginRemoteRequest();
        controller.stop();
        const newRequest = controller.beginRemoteRequest();
        expect(controller.getState().pendingClientRequestId).toBe('request-2');

        expect(controller.completeRemoteRequest(oldRequest, {success: true, transport: 'offscreen'})).toBe('stale');
        expect(controller.getState()).toMatchObject({
            generation: 1,
            pendingClientRequestId: 'request-2',
            activeClientRequestId: null,
        });
        expect(controller.matchRemoteState({
            type: 'selectionTtsState', clientRequestId: 'request-1', state: 'ended',
        })).toBeNull();
        expect(controller.matchRemoteState({
            type: 'selectionTtsState', clientRequestId: 'request-2', state: 'ended',
        })).toBe('ended');

        await flushStops();
        expect(stopRemote.mock.calls).toEqual([['request-1'], ['request-1']]);
        expect(controller.completeRemoteRequest(newRequest, {success: true, transport: 'page'})).toBe('page');

        const staleWithoutPlayback = controller.beginRemoteRequest();
        controller.stop(false);
        expect(controller.completeRemoteRequest(staleWithoutPlayback, {success: true, transport: 'page'})).toBe('stale');
        await flushStops();
        expect(stopRemote).toHaveBeenCalledTimes(2);
    });

    it('late rejection cannot clear a newer request while a current rejection releases its own pending UUID', () => {
        const {controller} = fixture();
        const oldRequest = controller.beginRemoteRequest();
        controller.stop(false);
        const newRequest = controller.beginRemoteRequest();

        expect(controller.rejectRemoteRequest(oldRequest)).toBe(false);
        expect(controller.getState().pendingClientRequestId).toBe('request-2');
        expect(controller.rejectRemoteRequest(newRequest)).toBe(true);
        expect(controller.getState().pendingClientRequestId).toBeNull();
    });

    it('swallows asynchronous and synchronous targeted STOP failures and factory instances are isolated', async () => {
        const {controller, stopRemote} = fixture();
        stopRemote.mockRejectedValueOnce(new Error('async stop failed'));
        const pending = controller.beginRemoteRequest();
        controller.stop();
        await flushStops();
        expect(stopRemote).toHaveBeenCalledWith(pending.clientRequestId);

        stopRemote.mockImplementationOnce(() => {
            throw new Error('sync stop failed');
        });
        const late = controller.beginRemoteRequest();
        controller.stop(false);
        expect(controller.completeRemoteRequest(late, {success: true, transport: 'offscreen'})).toBe('stale');
        await flushStops();

        const independent = new SelectionTtsContentController({
            createClientRequestId: () => 'independent',
            stopRemote: async () => undefined,
        });
        expect(independent.currentGeneration()).toBe(0);
        expect(controller.currentGeneration()).toBe(2);
    });
});
