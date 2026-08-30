import {afterEach, describe, expect, it} from 'vitest';
import {userscriptFetch} from '@/userscript/http';

describe('userscript HTTP transport', () => {
    afterEach(() => {
        globalThis.GM_xmlhttpRequest = undefined;
    });

    it('wraps Via-compatible responseText as a fetch Response', async () => {
        let captured: UserscriptXmlHttpRequestDetails | undefined;
        globalThis.GM_xmlhttpRequest = (details) => {
            captured = details;
            queueMicrotask(() => details.onload?.({
                status: 200,
                statusText: 'OK',
                responseText: '{"translation":"你好"}',
                responseHeaders: 'content-type: application/json\r\nx-test: userscript',
            }));
            return {abort() {}};
        };

        const response = await userscriptFetch('https://api.example.test/translate', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{"text":"hello"}',
        });

        expect(captured?.method).toBe('POST');
        expect(captured?.data).toBe('{"text":"hello"}');
        expect(captured).not.toHaveProperty('responseType');
        expect(captured).not.toHaveProperty('anonymous');
        expect(response.headers.get('x-test')).toBe('userscript');
        expect(await response.json()).toEqual({translation: '你好'});
    });

    it('propagates AbortSignal to the GM request handle', async () => {
        let aborted = false;
        globalThis.GM_xmlhttpRequest = () => ({abort() { aborted = true; }});
        const controller = new AbortController();
        const pending = userscriptFetch('https://api.example.test/slow', {signal: controller.signal});
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        controller.abort();

        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(aborted).toBe(true);
    });
});
