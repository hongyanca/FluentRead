import {describe, expect, it, vi} from 'vitest';
import {attachReadingStreamPort, type ReadingStreamPort} from '@/src/features/reading-assistant/streamPort';
import type {ReadingProgress, ReadingResponse} from '@/src/features/reading-assistant/types';

function event<T extends (...args: any[]) => void>() {const listeners = new Set<T>(); return {addListener: vi.fn((callback: T) => listeners.add(callback)), removeListener: vi.fn((callback: T) => listeners.delete(callback)), emit: (...args: Parameters<T>) => {for (const listener of [...listeners]) listener(...args);}};}
const tick = async () => {for(let i = 0; i < 6; i++) await Promise.resolve();};
function setup() {
    const onMessage = event<(message: unknown) => void>();
    const onDisconnect = event<() => void>();
    const port: ReadingStreamPort = {name: 'fluentReadHarnessStream', sender: {id: 'ext', tab: {id: 1}}, onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn()};
    const handler = {handle: vi.fn(async () => ({success: true, text: 'done', model: 'm', service: 's'} as ReadingResponse))};
    return {port, handler, onMessage, onDisconnect};
}
const request = {type: 'fluentReadHarness', action: 'run', requestId: 'r1'};
describe('Harness stream port ownership', () => {
    it('ignores unrelated ports, publishes progress and final response, and only accepts one request', async () => {
        const {port, handler, onMessage} = setup();
        port.name = 'other'; attachReadingStreamPort(port, handler);
        expect(onMessage.addListener).not.toHaveBeenCalled();
        port.name = 'fluentReadHarnessStream';
        handler.handle.mockImplementationOnce(async (...args: unknown[]) => {(args[2] as (progress: ReadingProgress) => void)({kind: 'text', text: 'partial'}); return {success: true, text: 'done', model: 'm', service: 's'};});
        attachReadingStreamPort(port, handler);
        onMessage.emit(request); onMessage.emit(request);
        await tick();
        expect(handler.handle).toHaveBeenCalledOnce();
        expect(port.postMessage).toHaveBeenNthCalledWith(1, {type: 'progress', requestId: 'r1', progress: {kind: 'text', text: 'partial'}});
        expect(port.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({type: 'result'}));
        expect(onMessage.removeListener).toHaveBeenCalledOnce();
        expect(port.disconnect).toHaveBeenCalledOnce();
    });
    it('cancels the owned request on disconnect and suppresses late progress and completion', async () => {
        const {port, handler, onMessage, onDisconnect} = setup();
        let resolve!: (result: ReadingResponse) => void;
        let publish!: (progress: ReadingProgress) => void;
        handler.handle.mockImplementationOnce((...args: unknown[]) => {publish = args[2] as typeof publish; return new Promise(done => {resolve = done;});});
        attachReadingStreamPort(port, handler);
        const listener = onMessage.addListener.mock.calls[0][0];
        onMessage.emit(request); onDisconnect.emit(); listener(request);
        publish({kind: 'text', text: 'late'});
        resolve({success: false, error: 'late'});
        await tick();
        expect(handler.handle).toHaveBeenLastCalledWith({type: 'fluentReadHarness', action: 'cancel', requestId: 'r1'}, port.sender);
        expect(port.postMessage).not.toHaveBeenCalled();
    });
    it('handles malformed sender/message, pre-start disconnect and all port failures', async () => {
        const unused = setup(); delete unused.port.sender;
        attachReadingStreamPort(unused.port, unused.handler); unused.onDisconnect.emit();
        expect(unused.handler.handle).not.toHaveBeenCalled();
        const failed = setup(); delete failed.port.sender;
        failed.handler.handle.mockRejectedValueOnce(new Error('handler failure'));
        vi.mocked(failed.port.disconnect).mockImplementationOnce(() => {throw new Error('closed');});
        attachReadingStreamPort(failed.port, failed.handler); failed.onMessage.emit(null); await tick();
        expect(failed.port.postMessage).toHaveBeenCalledWith({type: 'result', requestId: '', response: {success: false, error: expect.stringContaining('中断')}});
        const sendFailure = setup();
        vi.mocked(sendFailure.port.postMessage).mockImplementation(() => {throw new Error('disconnected');});
        sendFailure.handler.handle.mockResolvedValueOnce({success: false, error: 'failed'}).mockRejectedValueOnce(new Error('cancel failed'));
        attachReadingStreamPort(sendFailure.port, sendFailure.handler); sendFailure.onMessage.emit(request); await tick();
        expect(sendFailure.handler.handle).toHaveBeenCalledTimes(2);
        const malformed = setup(); attachReadingStreamPort(malformed.port, malformed.handler);
        malformed.onMessage.emit({requestId: 5}); await tick();
        expect(malformed.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({requestId: ''}));
    });
});
