import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    buildUserscriptSettingsUrl,
    closeUserscriptSettings,
    openUserscriptSettings,
} from '@/userscript/settingsFull';

const mocks = vi.hoisted(() => ({
    createVueShadowUi: vi.fn(),
    remove: vi.fn(),
}));

vi.mock('@/src/app/options', () => ({installOptionsApp: vi.fn()}));
vi.mock('@/src/app/options/OptionsApp.vue', () => ({default: {name: 'OptionsApp'}}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.createVueShadowUi}));

describe('full userscript Options entry', () => {
    beforeEach(() => {
        mocks.createVueShadowUi.mockReset().mockResolvedValue({remove: mocks.remove});
        mocks.remove.mockReset();
    });

    afterEach(() => {
        closeUserscriptSettings();
        vi.unstubAllGlobals();
    });

    it('opens the same URL with a settings fragment through Safari GM.openInTab', async () => {
        const openInTab = vi.fn().mockResolvedValue({id: 1});
        const browserOpen = vi.fn();
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article?ref=home#old', hash: '#old'},
            open: browserOpen,
        });
        vi.stubGlobal('GM', {openInTab});

        await openUserscriptSettings({id: 'context'}, 'settings-services');

        expect(openInTab).toHaveBeenCalledWith(
            buildUserscriptSettingsUrl('https://example.test/article?ref=home#old', 'settings-services'),
            false,
        );
        expect(browserOpen).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('uses GM_openInTab with an active tab for classic managers', async () => {
        const openInTab = vi.fn();
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article', hash: ''},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', openInTab);

        await openUserscriptSettings({id: 'context'}, 'settings-writing');

        expect(openInTab).toHaveBeenCalledWith(
            'https://example.test/article#fluentread-userscript-settings/settings-writing',
            expect.objectContaining({active: true}),
        );
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('opens settings in-page on Android even if GM_openInTab exists', async () => {
        const openInTab = vi.fn();
        vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'});
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', openInTab);

        await openUserscriptSettings({id: 'context'}, 'settings-general');

        expect(openInTab).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe('#host-route');
    });

    it('opens the full Options in-page when no manager tab API exists', async () => {
        const browserOpen = vi.fn();
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: browserOpen,
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', undefined);

        await openUserscriptSettings({id: 'context'});

        expect(browserOpen).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).toHaveBeenCalledWith(
            {id: 'context'},
            expect.objectContaining({mode: 'closed', viewport: true}),
        );
        const options = mocks.createVueShadowUi.mock.calls[0][1];
        expect(options.component).toEqual({name: 'OptionsApp'});
        vi.stubGlobal('ShadowRoot', class {});
        vi.stubGlobal('HTMLElement', class {});
        expect(options.props({getRootNode: () => ({})})).toMatchObject({
            locationRouting: 'internal',
            settingsHashPrefix: undefined,
            onClose: closeUserscriptSettings,
        });
        expect(window.location.hash).toBe('#host-route');
        closeUserscriptSettings();
        expect(mocks.remove).toHaveBeenCalledOnce();
    });

    it('keeps the selected settings section in the in-page fallback', async () => {
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', undefined);

        await openUserscriptSettings({id: 'context'}, 'settings-services');

        const options = mocks.createVueShadowUi.mock.calls[0][1];
        vi.stubGlobal('ShadowRoot', class {});
        vi.stubGlobal('HTMLElement', class {});
        expect(options.props({getRootNode: () => ({})})).toMatchObject({
            initialSection: 'settings-services',
            locationRouting: 'internal',
        });
        expect(window.location.hash).toBe('#host-route');
    });

    it('falls back to the in-page Options when GM.openInTab rejects asynchronously', async () => {
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article', hash: ''},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', {openInTab: vi.fn().mockRejectedValue(new Error('blocked'))});

        await openUserscriptSettings({id: 'context'});
        await vi.waitFor(() => expect(mocks.createVueShadowUi).toHaveBeenCalledOnce());
    });

    it('removes a pending settings mount after the page closes', async () => {
        let resolveMount!: (value: {remove: typeof mocks.remove}) => void;
        mocks.createVueShadowUi.mockReturnValue(new Promise((resolve) => { resolveMount = resolve; }));
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: vi.fn(() => null),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', undefined);

        const firstOpen = openUserscriptSettings({id: 'context'});
        const secondOpen = openUserscriptSettings({id: 'context'});
        expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
        closeUserscriptSettings();
        resolveMount({remove: mocks.remove});
        await Promise.all([firstOpen, secondOpen]);
        expect(mocks.remove).toHaveBeenCalledOnce();
    });
});
