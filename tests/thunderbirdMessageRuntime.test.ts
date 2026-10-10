import {describe, expect, it, vi} from 'vitest';
import {
    installThunderbirdMessageRuntime,
    THUNDERBIRD_MESSAGE_CONTENT_SCRIPT,
    type ThunderbirdMessageApi,
} from '@/src/app/background/thunderbirdMessageRuntime';

describe('Thunderbird message display runtime', () => {
    it('does not touch ordinary Firefox or Chromium without MailExtension APIs', () => {
        const sendMessage = vi.fn();
        expect(installThunderbirdMessageRuntime({tabs: {sendMessage}})).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('registers the shared content script only for displayed mail and toggles translation', async () => {
        const register = vi.fn().mockResolvedValue({});
        const listeners: Array<(tab: {id?: number}) => void> = [];
        const sendMessage = vi.fn()
            .mockResolvedValueOnce({status: 'success', isTranslated: false})
            .mockResolvedValueOnce({status: 'success'})
            .mockResolvedValueOnce({status: 'success', isTranslated: true})
            .mockResolvedValueOnce({status: 'success'});
        const api: ThunderbirdMessageApi = {
            messageDisplayScripts: {register},
            messageDisplayAction: {onClicked: {addListener: listener => listeners.push(listener)}},
            tabs: {sendMessage},
        };

        expect(installThunderbirdMessageRuntime(api)).toBe(true);
        expect(register).toHaveBeenCalledWith({
            js: [{file: THUNDERBIRD_MESSAGE_CONTENT_SCRIPT}],
            runAt: 'document_start',
        });
        expect(listeners).toHaveLength(1);
        listeners[0]({});
        listeners[0]({id: -1});
        expect(sendMessage).not.toHaveBeenCalled();

        listeners[0]({id: 7});
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
        expect(sendMessage.mock.calls.slice(0, 2)).toEqual([
            [7, {type: 'getFullPageTranslationState'}],
            [7, {type: 'contextMenuTranslate', action: 'fullPage'}],
        ]);

        listeners[0]({id: 7});
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(4));
        expect(sendMessage.mock.calls[3]).toEqual([7, {type: 'contextMenuTranslate', action: 'restore'}]);
    });

    it('does not start translation when the displayed message has no content runtime', async () => {
        const listener = vi.fn();
        const sendMessage = vi.fn().mockResolvedValue({status: 'disabled'});
        installThunderbirdMessageRuntime({
            messageDisplayScripts: {register: vi.fn().mockResolvedValue({})},
            messageDisplayAction: {onClicked: {addListener: listener}},
            tabs: {sendMessage},
        });
        listener.mock.calls[0][0]({id: 9});
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    });

    it('reports registration and interaction failures without throwing from event handlers', async () => {
        const warnings = vi.fn();
        const listener = vi.fn();
        const sendMessage = vi.fn().mockRejectedValue(new Error('no message display'));
        installThunderbirdMessageRuntime({
            messageDisplayScripts: {register: vi.fn().mockRejectedValue(new Error('no permission'))},
            messageDisplayAction: {onClicked: {addListener: listener}},
            tabs: {sendMessage},
        }, warnings);
        listener.mock.calls[0][0]({id: 4});
        await vi.waitFor(() => expect(warnings).toHaveBeenCalledTimes(2));
        expect(warnings.mock.calls[0][0]).toContain('注册 Thunderbird');
        expect(warnings.mock.calls[1][0]).toContain('邮件翻译操作失败');
    });
});
