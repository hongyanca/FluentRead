import {afterEach, describe, expect, it, vi} from 'vitest';
import {setActionIcon, type ActionIconDetails} from '@/src/platform/browser/actionIcon';

const details: ActionIconDetails = {tabId: 7, path: {16: 'icon/16.png'}};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function nativeApi() {
    const runtime: {id: string; lastError?: {message?: string}} = {id: 'extension-id'};
    const action = {setIcon: vi.fn((_details: ActionIconDetails, callback: () => void) => callback())};
    vi.stubGlobal('chrome', {runtime, action});
    return {runtime, action};
}

describe('Chromium 图标回调错误适配', () => {
    it.each(['chrome', 'edge'])('%s 等待原生回调并保留 API 的 this', async target => {
        vi.stubEnv('BROWSER', target);
        const native = nativeApi();
        const fallback = {setIcon: vi.fn(async () => {})};
        let complete!: () => void;
        native.action.setIcon.mockImplementationOnce(function (this: typeof native.action, received, callback) {
            expect(this).toBe(native.action);
            expect(received).toBe(details);
            complete = callback;
        });
        let settled = false;
        const pending = setActionIcon(fallback, details).then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        complete();
        await pending;
        expect(native.action.setIcon).toHaveBeenCalledTimes(1);
        expect(native.action.setIcon).toHaveBeenCalledWith(details, expect.any(Function));
        expect(fallback.setIcon).not.toHaveBeenCalled();
    });

    it.each([{message: 'No tab with id: 7.'}, {}])('只在回调内读取 lastError 并转为拒绝：%j', async error => {
        vi.stubEnv('BROWSER', 'chrome');
        const native = nativeApi();
        let inCallback = false;
        const readError = vi.fn(() => {
            expect(inCallback).toBe(true);
            return error;
        });
        Object.defineProperty(native.runtime, 'lastError', {get: readError});
        native.action.setIcon.mockImplementationOnce((_received, callback) => {
            inCallback = true;
            callback();
            inCallback = false;
        });
        const fallback = {setIcon: vi.fn(async () => {})};
        await expect(setActionIcon(fallback, details)).rejects.toThrow(error.message ?? 'Failed to set action icon');
        expect(readError).toHaveBeenCalledTimes(1);
        expect(fallback.setIcon).not.toHaveBeenCalled();
    });

    it('原生 API 同步抛错时拒绝且不会重复调用 Promise 接口', async () => {
        vi.stubEnv('BROWSER', 'chrome');
        const native = nativeApi();
        const error = new Error('Invalid icon path');
        native.action.setIcon.mockImplementationOnce(() => { throw error; });
        const fallback = {setIcon: vi.fn(async () => {})};
        await expect(setActionIcon(fallback, details)).rejects.toBe(error);
        expect(fallback.setIcon).not.toHaveBeenCalled();
    });

    it.each(['firefox', 'userscript', 'unknown'])('%s 即使有 chrome 全局也保持 Promise 路径', async target => {
        vi.stubEnv('BROWSER', target);
        const native = nativeApi();
        const fallback = {setIcon: vi.fn(async () => {})};
        await setActionIcon(fallback, details);
        expect(fallback.setIcon).toHaveBeenCalledTimes(1);
        expect(fallback.setIcon).toHaveBeenCalledWith(details);
        expect(native.action.setIcon).not.toHaveBeenCalled();
    });

    it.each([
        undefined,
        {},
        {runtime: {}},
        {runtime: {id: 'extension-id'}},
        {runtime: {id: 'extension-id'}, action: {}},
    ])('缺少原生扩展接口的替身保持 Promise 路径：%j', async chrome => {
        vi.stubEnv('BROWSER', 'chrome');
        vi.stubGlobal('chrome', chrome);
        const fallback = {setIcon: vi.fn(async () => {})};
        await setActionIcon(fallback, details);
        expect(fallback.setIcon).toHaveBeenCalledTimes(1);
        expect(fallback.setIcon).toHaveBeenCalledWith(details);
    });

    it('Promise 替身仍等待完成，失败原样拒绝', async () => {
        vi.stubEnv('BROWSER', 'unknown');
        const error = new Error('Promise icon failure');
        let reject!: (error: Error) => void;
        const fallback = {setIcon: vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }))};
        const pending = setActionIcon(fallback, details);
        const assertion = expect(pending).rejects.toBe(error);
        reject(error);
        await assertion;
    });

    it('无返回值的替身仍能完成', async () => {
        vi.stubEnv('BROWSER', 'userscript');
        await expect(setActionIcon({setIcon: () => {}}, details)).resolves.toBeUndefined();
    });
});
