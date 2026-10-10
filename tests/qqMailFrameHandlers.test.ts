import {describe, expect, it, vi} from 'vitest';

import {
    createQqMailFrameBackgroundHandlers,
} from '@/src/features/full-page-translation/background/qqMailFrameHandlers';
import {createNeteaseMailFrameBackgroundHandlers} from '@/src/features/full-page-translation/background/neteaseMailFrameHandlers';
import {
    isNeteaseMailChildUrl, isNeteaseMailReadUrl, isNeteaseMailTopUrl,
    parseNeteaseMailFrameRequest, type NeteaseMailFrameRequest,
} from '@/src/features/full-page-translation/neteaseMailFrames';
import {
    isQqMailLegacyTopUrl,
    isQqMailReadmailUrl,
    parseQQMailFrameChanged,
    parseQQMailFrameRequest,
    QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE,
    QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE,
} from '@/src/features/full-page-translation/qqMailFrames';

const topUrl = 'https://mail.qq.com/cgi-bin/frame_html?mode=legacy';
const readUrl = 'https://mail.qq.com/cgi-bin/readmail?mailid=redacted';

describe('QQ legacy frame relay', () => {
    it('保留术语空选择和有限ID数组，拒绝类型错误与稀疏数组', () => {
        for (const glossaryIds of [null, [], ['technical']]) {
            expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: {glossaryIds}}))
                .toMatchObject({invocation: {glossaryIds}});
        }
        for (const glossaryIds of ['all', Array(101).fill('a'), [1], ['a'.repeat(129)], new Array(1)]) {
            expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: {glossaryIds}})).toBeNull();
        }
    });
    it('guards exact HTTPS host and pathname while allowing query strings', () => {
        expect(isQqMailLegacyTopUrl(topUrl)).toBe(true);
        expect(isQqMailReadmailUrl(readUrl)).toBe(true);
        expect(isQqMailLegacyTopUrl('not a url')).toBe(false);
        expect(isQqMailLegacyTopUrl(undefined)).toBe(false);
        for (const value of [
            'http://mail.qq.com/cgi-bin/frame_html',
            'https://wx.mail.qq.com/cgi-bin/frame_html',
            'https://mail.qq.com/cgi-bin/frame_html/extra',
            'https://mail.qq.com/cgi-bin/readmail/extra',
            'https://evil.example/cgi-bin/readmail',
            'https://user:pass@mail.qq.com/cgi-bin/frame_html',
            'https://mail.qq.com:444/cgi-bin/frame_html',
        ]) {
            expect(isQqMailLegacyTopUrl(value)).toBe(false);
            expect(isQqMailReadmailUrl(value)).toBe(false);
        }
    });

    it('strictly validates requests and invocation allowlist', () => {
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'state'}))
            .toEqual({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'state'});
        expect(parseQQMailFrameRequest({
            type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE,
            action: 'toggle',
            invocation: {service: 'openai', model: 'test', targetLanguage: 'zh-CN', displayMode: 'bilingual', profileId: 'default', fullPageMode: 'all'},
        })).toMatchObject({action: 'toggle'});
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'state', invocation: undefined})).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', credentials: 'secret'})).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: {sid: 'secret'}})).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: {displayMode: 'invalid'}})).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: {fullPageMode: 'invalid'}})).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: 'invalid'})).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle', invocation: {service: 1}})).toBeNull();
        expect(parseQQMailFrameRequest(null)).toBeNull();
        expect(parseQQMailFrameRequest({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE})).toBeNull();
        expect(parseQQMailFrameChanged({type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE})).toEqual({type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE});
        expect(parseQQMailFrameChanged({type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE, extra: true})).toBeNull();
        expect(parseQQMailFrameChanged(null)).toBeNull();
    });

    it('accepts both frozen recognition scopes, keeps legacy requests, and rejects invalid scope values', () => {
        const request = {type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle'};
        for (const scope of ['content', 'all']) {
            expect(parseQQMailFrameRequest({...request, invocation: {scope, fullPageMode: 'viewport'}}))
                .toEqual({...request, invocation: {scope, fullPageMode: 'viewport'}});
        }
        expect(parseQQMailFrameRequest({...request, invocation: {fullPageMode: 'all'}}))
            .toEqual({...request, invocation: {fullPageMode: 'all'}});
        for (const scope of ['future', '', 'ALL', true, 1, null, undefined, {}, ['all']]) {
            expect(parseQQMailFrameRequest({...request, invocation: {scope}})).toBeNull();
        }
    });

    it('relays valid child requests and rejects spoofed sender metadata', async () => {
        const sendTabMessage = vi.fn(async () => ({success: true, enabled: false}));
        const [request] = createQqMailFrameBackgroundHandlers({sendTabMessage});
        const context = {sender: {frameId: 3, url: readUrl, tab: {id: 42, url: topUrl}}};
        await expect(request.handle({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'toggle'}, context))
            .resolves.toEqual({success: true, enabled: false});
        expect(sendTabMessage).toHaveBeenCalledWith(42, {type: 'qqMailFrameCommand', action: 'toggle'}, {frameId: 0});
        await expect(request.handle({
            type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE,
            action: 'toggle',
            invocation: {targetLanguage: 'zh-CN', scope: 'all'},
        }, context)).resolves.toEqual({success: true, enabled: false});
        expect(sendTabMessage).toHaveBeenLastCalledWith(42, {
            type: 'qqMailFrameCommand', action: 'toggle', invocation: {targetLanguage: 'zh-CN', scope: 'all'},
        }, {frameId: 0});

        for (const sender of [
            {...context.sender, frameId: 0},
            {...context.sender, url: 'https://evil.example/cgi-bin/readmail'},
            {...context.sender, tab: {id: 42, url: 'https://evil.example/cgi-bin/frame_html'}},
            {...context.sender, tab: {id: -1, url: topUrl}},
        ]) {
            await expect(request.handle({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'state'}, {sender})).resolves.toEqual({success: false});
        }
        sendTabMessage.mockRejectedValueOnce(new Error('no receiver'));
        await expect(request.handle({type: QQ_MAIL_FRAME_REQUEST_MESSAGE_TYPE, action: 'state'}, context)).resolves.toEqual({success: false});
    });

    it('broadcasts top frame changes as best effort, including no receiver', async () => {
        const sendTabMessage = vi.fn(async () => undefined);
        const [, changed] = createQqMailFrameBackgroundHandlers({sendTabMessage});
        const context = {sender: {frameId: 0, url: topUrl, tab: {id: 42, url: topUrl}}};
        await expect(changed.handle({type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE}, context)).resolves.toEqual({success: true});
        expect(sendTabMessage).toHaveBeenCalledWith(42, {type: 'qqMailFrameRefresh'});
        sendTabMessage.mockRejectedValueOnce(new Error('no receiver'));
        await expect(changed.handle({type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE}, context)).resolves.toEqual({success: true});
        await expect(changed.handle({type: QQ_MAIL_FRAME_CHANGED_MESSAGE_TYPE}, {sender: {...context.sender, frameId: 1}})).resolves.toEqual({success: false});
    });
});

describe('NetEase mail reading frame relay', () => {
    const readTop = 'https://mail.163.com/js6/main.jsp?sid=redacted#module=read.ReadModule%7C%7B%7D';
    const listTop = 'https://mail.163.com/js6/main.jsp?sid=redacted#module=mbox.ListModule%7C%7B%7D';
    it('restricts hosts and reading routes without parsing session parameters', () => {
        for (const host of ['mail.163.com', 'mail.126.com', 'mail.yeah.net']) {
            expect(isNeteaseMailReadUrl(`https://${host}/js6/main.jsp#module=read.ReadModule%7C%7B%7D`)).toBe(true);
        }
        expect(isNeteaseMailReadUrl('https://hw.mail.163.com/js6/main.jsp#module=read.ReadModule')).toBe(true);
        expect(isNeteaseMailTopUrl(listTop)).toBe(true);
        expect(isNeteaseMailReadUrl(listTop)).toBe(false);
        expect(isNeteaseMailChildUrl('about:blank', readTop)).toBe(true);
        expect(isNeteaseMailChildUrl('about:srcdoc', readTop)).toBe(true);
        expect(isNeteaseMailChildUrl('about:blank', 'https://evil.example/js6/main.jsp#module=read.ReadModule')).toBe(false);
        expect(isNeteaseMailTopUrl(null)).toBe(false);
        expect(isNeteaseMailTopUrl('invalid URL')).toBe(false);
        expect(isNeteaseMailChildUrl('https://evil.example/frame', readTop)).toBe(false);
        expect(isNeteaseMailChildUrl('invalid URL', readTop)).toBe(false);
        expect(isNeteaseMailChildUrl('https://mail.163.com/js6/frame.jsp', readTop)).toBe(true);
        expect(isNeteaseMailChildUrl(readTop, readTop)).toBe(false);
        expect(isNeteaseMailChildUrl('https://user@mail.163.com/js6/frame.jsp', readTop)).toBe(false);
        expect(isNeteaseMailChildUrl('https://:pass@mail.163.com/js6/frame.jsp', readTop)).toBe(false);
        for (const url of ['http://mail.163.com/js6/main.jsp', 'https://evil.other.mail.163.com/js6/main.jsp',
            'https://mail.163.com/js6/other.jsp', 'https://user:pass@mail.163.com/js6/main.jsp']) {
            expect(isNeteaseMailTopUrl(url)).toBe(false);
        }
    });

    it('validates request fields and forwards only a reading child to frame zero', async () => {
        const sendTabMessage = vi.fn(async () => ({enabled: true, revision: 1, sessionId: null}));
        const [request, changed] = createNeteaseMailFrameBackgroundHandlers({sendTabMessage});
        const sender = {frameId: 3, url: 'about:blank', tab: {id: 42, url: readTop}};
        const state = {type: 'neteaseMailFrameRequest', action: 'state'} as const;
        expect(parseNeteaseMailFrameRequest({...state, sid: 'secret'})).toBeNull();
        expect(parseNeteaseMailFrameRequest({type: 'wrong', action: 'state'})).toBeNull();
        expect(parseNeteaseMailFrameRequest({type: state.type, action: 'toggle', invocation: {sid: 'secret'}})).toBeNull();
        await expect(request.handle(state, {sender})).resolves.toMatchObject({enabled: true});
        expect(sendTabMessage).toHaveBeenCalledWith(42, {type: 'neteaseMailFrameCommand', action: 'state'}, {frameId: 0});
        const toggle: NeteaseMailFrameRequest = {type: 'neteaseMailFrameRequest', action: 'toggle', invocation: {targetLanguage: 'zh-Hans'}};
        await request.handle(toggle, {sender});
        expect(sendTabMessage).toHaveBeenLastCalledWith(42, {
            type: 'neteaseMailFrameCommand', action: 'toggle', invocation: {targetLanguage: 'zh-Hans'},
        }, {frameId: 0});
        sendTabMessage.mockRejectedValueOnce(new Error('top frame gone'));
        await expect(request.handle(state, {sender})).resolves.toEqual({success: false});
        for (const bad of [
            {...sender, frameId: 0},
            {...sender, tab: {id: 42, url: listTop}},
            {...sender, origin: 'https://mail.126.com'},
            {...sender, url: 'https://evil.example/'},
            {...sender, tab: {id: -1, url: readTop}},
        ]) {
            await expect(request.handle(state, {sender: bad})).resolves.toEqual({success: false});
        }
        await expect(changed.handle({type: 'neteaseMailFrameChanged'}, {sender: {frameId: 0, url: listTop, tab: {id: 42, url: listTop}}}))
            .resolves.toEqual({success: true});
        expect(sendTabMessage).toHaveBeenLastCalledWith(42, {type: 'neteaseMailFrameRefresh'});
        await expect(changed.handle({type: 'neteaseMailFrameChanged', extra: true} as never,
            {sender: {frameId: 0, url: listTop, tab: {id: 42, url: listTop}}})).resolves.toEqual({success: false});
        sendTabMessage.mockRejectedValueOnce(new Error('child frame gone'));
        await expect(changed.handle({type: 'neteaseMailFrameChanged'},
            {sender: {frameId: 0, url: listTop, tab: {id: 42, url: listTop}}})).resolves.toEqual({success: true});
    });
});
