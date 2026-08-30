import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';

import {showPageNotice} from '@/src/features/page-notice/public';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalBrowser = (globalThis as typeof globalThis & {browser?: unknown}).browser;

const sendMessage = vi.fn(async () => ({success: true}));
const noticeCss = readFileSync(new URL('../src/features/page-notice/content/notice.css', import.meta.url), 'utf8');

describe('page error notice', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        sendMessage.mockClear();
        const {document, window} = parseHTML(`
            <html>
                <body>
                    <p>Translation target</p>
                    <div style="height: 6000px">Long page spacer</div>
                </body>
            </html>
        `);
        Object.defineProperty(globalThis, 'document', {value: document, configurable: true});
        Object.defineProperty(globalThis, 'window', {value: window, configurable: true});
        Object.defineProperty(globalThis, 'browser', {
            value: {
                runtime: {
                    getURL: (path: string) => `chrome-extension://fixture${path}`,
                    sendMessage,
                },
            },
            configurable: true,
        });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
        Object.defineProperty(globalThis, 'window', {value: originalWindow, configurable: true});
        Object.defineProperty(globalThis, 'browser', {value: originalBrowser, configurable: true});
    });

    it('keeps error details fixed to the viewport on a long page', async () => {
        const notice = showPageNotice('Failed to fetch', 'error');
        await Promise.resolve();

        const host = document.getElementById('fluent-read-page-notice-host')!;
        expect(host.parentElement).toBe(document.documentElement);
        expect(host.hasAttribute('data-fluent-read-ui')).toBe(true);
        expect(host.getAttribute('translate')).toBe('no');
        expect(host.style.getPropertyValue('position')).toBe('fixed');
        expect(host.style.getPropertyValue('z-index')).toBe('2147483647');
        expect(host.style.getPropertyValue('pointer-events')).toBe('none');

        const shadow = host.shadowRoot!;
        expect(shadow.querySelector('.notice-stack')).not.toBeNull();
        expect(noticeCss).toMatch(/\.notice-stack\s*\{[^}]*position:\s*fixed/s);
        expect(notice.getAttribute('role')).toBe('alert');
        expect(notice.textContent).toContain('Failed to fetch');
        expect(notice.classList.contains('is-visible')).toBe(true);
    });

    it('keeps credential guidance interactive inside the isolated notice', async () => {
        showPageNotice('DeepSeek 需要 API Key（访问令牌），当前尚未配置', 'error');
        await Promise.resolve();

        const host = document.getElementById('fluent-read-page-notice-host')!;
        const shadow = host.shadowRoot!;
        const action = shadow.querySelector<HTMLButtonElement>('.notice-action')!;
        expect(shadow.querySelector('.notice-detail')?.textContent).toContain('为 DeepSeek 填写 API Key');

        action.click();
        expect(sendMessage).toHaveBeenCalledWith({type: 'openOptionsPage'});
    });

    it('隔离设置页打开失败，不产生未处理拒绝', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        sendMessage.mockRejectedValueOnce(new Error('runtime disconnected'));
        showPageNotice('DeepSeek 需要 API Key，当前尚未配置', 'error');
        await Promise.resolve();

        const action = document.getElementById('fluent-read-page-notice-host')!
            .shadowRoot!.querySelector<HTMLButtonElement>('.notice-action')!;
        action.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleError).toHaveBeenCalledWith('[FluentRead] 打开设置页失败', expect.any(Error));
        consoleError.mockRestore();
    });

    it.each([
        ['有道翻译 需要 App Key 和 App Secret，当前尚未完整配置；请先在设置中填写，再开始翻译。', 'App Key 和 App Secret'],
        ['腾讯翻译 需要 SecretId 和 SecretKey，当前尚未完整配置；请先在设置中填写，再开始翻译。', 'SecretId 和 SecretKey'],
    ])('offers settings for every supported missing credential type', async (message, credentialLabel) => {
        showPageNotice(message, 'error');
        await Promise.resolve();

        const shadow = document.getElementById('fluent-read-page-notice-host')!.shadowRoot!;
        expect(shadow.querySelector('.notice-detail')?.textContent).toContain(credentialLabel);
        const action = shadow.querySelector<HTMLButtonElement>('.notice-action')!;
        action.click();
        expect(sendMessage).toHaveBeenCalledWith({type: 'openOptionsPage'});
    });

    it('keeps invalid credential diagnostics instead of treating them as missing setup', async () => {
        const message = '当前翻译服务的 API Key 无效、已过期或没有模型访问权限（HTTP 401）。';
        showPageNotice(message, 'error');
        await Promise.resolve();

        const shadow = document.getElementById('fluent-read-page-notice-host')!.shadowRoot!;
        expect(shadow.querySelector('.notice-detail')?.textContent).toBe(message);
        expect(shadow.querySelector('.notice-action')).toBeNull();
    });

    it('keeps the settings action for a legacy generic missing-key error', async () => {
        showPageNotice('当前翻译服务还没有配置 API Key，请前往设置页面填写后再试。', 'error');
        await Promise.resolve();

        const shadow = document.getElementById('fluent-read-page-notice-host')!.shadowRoot!;
        expect(shadow.querySelector('.notice-detail')?.textContent).toContain('API Key');
        expect(shadow.querySelector('.notice-action')).not.toBeNull();
    });

    it('removes the isolated host after the last notice is closed', async () => {
        showPageNotice('Provider unavailable', 'error');
        await Promise.resolve();

        const host = document.getElementById('fluent-read-page-notice-host')!;
        host.shadowRoot!.querySelector<HTMLButtonElement>('.notice-close')!.click();
        await vi.advanceTimersByTimeAsync(180);

        expect(document.getElementById('fluent-read-page-notice-host')).toBeNull();
    });
});
