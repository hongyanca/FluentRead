import {afterEach, describe, expect, it, vi} from 'vitest';
import {withImageSourceAuthorization, IMAGE_SOURCE_VALIDATION_MESSAGE_TYPE} from '@/src/features/image-translation/content/sourceAuthorization';
import {withPixivImageReferrer} from '@/src/features/image-translation/background/pixivImageReferrer';
import {createImageSourceVerifier, imageTranslationSourceTransport} from '@/src/features/image-translation/background/offscreenAdapter';
import {createImageTranslationBackgroundHandlers, IMAGE_FETCH_MESSAGE_TYPE, IMAGE_CANCEL_MESSAGE_TYPE} from '@/src/features/image-translation/background/handlers';

const url = 'https://z-cdn-media.chatglm.cn/article/chart.png';
const documentUrl = 'https://z.ai/blog/article';
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};};

function pageFixture() {
    const listeners = new Set<(...args: any[]) => boolean>();
    const addListener = vi.fn(listener => listeners.add(listener));
    const removeListener = vi.fn(listener => listeners.delete(listener));
    const document = {URL: documentUrl};
    const attributes = {src: url, srcset: null, sizes: null};
    const image = {src: url, currentSrc: '', isConnected: true, ownerDocument: document, getAttribute: (name: keyof typeof attributes) => attributes[name]} as unknown as HTMLImageElement;
    vi.stubGlobal('document', document);
    vi.stubGlobal('browser', {runtime: {id: 'fluentread-id', onMessage: {addListener, removeListener}}});
    const challenge = (requestId: string, extra = {}, sender: {id: string; tab?: unknown} = {id: 'fluentread-id'}) => {
        const respond = vi.fn();
        for (const listener of listeners) listener({type: IMAGE_SOURCE_VALIDATION_MESSAGE_TYPE, requestId, url, documentUrl, ...extra}, sender, respond);
        return respond;
    };
    return {listeners, addListener, removeListener, document, attributes, image, challenge};
}

afterEach(() => vi.unstubAllGlobals());

describe('跨域图片读取任务的页面授权', () => {
    it('同文档翻页允许浏览器 sender 的初始路径，仍拒绝跨源、换文档和请求期间再次导航',async()=>{
        const env=pageFixture();env.document.URL='https://globalcomix.com/read/chapter/3';
        await withImageSourceAuthorization(env.image,url,undefined,async id=>{
            expect(env.challenge(id,{documentUrl:'https://globalcomix.com/read/chapter/1'})).toHaveBeenCalledWith({valid:true});
            for(const documentUrl of [null,'invalid','https://other.example/read/chapter/1','http://globalcomix.com/read/chapter/1','https://globalcomix.com:444/read/chapter/1'])expect(env.challenge(id,{documentUrl})).toHaveBeenCalledWith({valid:false});
            Object.assign(env.image,{ownerDocument:{URL:env.document.URL}});expect(env.challenge(id,{documentUrl:env.document.URL})).toHaveBeenCalledWith({valid:false});
            Object.assign(env.image,{ownerDocument:env.document});vi.stubGlobal('document',{URL:env.document.URL});expect(env.challenge(id,{documentUrl:env.document.URL})).toHaveBeenCalledWith({valid:false});
            vi.stubGlobal('document',env.document);env.document.URL='https://globalcomix.com/read/chapter/4';expect(env.challenge(id,{documentUrl:'https://globalcomix.com/read/chapter/1'})).toHaveBeenCalledWith({valid:false});
        });
        expect(env.listeners.size).toBe(0);
    });
    it('本地文件只允许相同完整地址，损坏的文档地址不能匹配其他来源',async()=>{
        const env=pageFixture();env.document.URL='file:///tmp/manga.html';
        await withImageSourceAuthorization(env.image,url,undefined,async id=>{
            expect(env.challenge(id,{documentUrl:env.document.URL})).toHaveBeenCalledWith({valid:true});
            expect(env.challenge(id,{documentUrl:'file:///tmp/another.html'})).toHaveBeenCalledWith({valid:false});
        });
        env.document.URL='invalid';await withImageSourceAuthorization(env.image,url,undefined,async id=>{
            expect(env.challenge(id,{documentUrl:'https://other.example/'})).toHaveBeenCalledWith({valid:false});
        });
    });
    it('Pixiv 临时规则精确绑定图片及扩展发起者，不触碰宿主请求；成功和失败都移除', async () => {
        const api={updateSessionRules:vi.fn().mockResolvedValue(undefined)},operation=vi.fn().mockResolvedValue('image');
        const source='https://i.pximg.net/img-original/123_p0.jpg?a=1&b=2';
        await expect(withPixivImageReferrer(source,'https://www.pixiv.net/artworks/123#1',operation,api,'own-extension')).resolves.toBe('image');
        const rule=api.updateSessionRules.mock.calls[0][0].addRules[0];
        expect(rule.condition.initiatorDomains).toEqual(['own-extension']);expect(new RegExp(rule.condition.regexFilter).test(source)).toBe(true);
        expect(new RegExp(rule.condition.regexFilter).test(source+'extra')).toBe(false);
        expect(rule.action.requestHeaders).toEqual([{header:'Referer',operation:'set',value:'https://www.pixiv.net/'}]);
        expect(api.updateSessionRules).toHaveBeenLastCalledWith({removeRuleIds:[rule.id]});
        operation.mockRejectedValueOnce(new Error('network failed'));
        await expect(withPixivImageReferrer(source,'https://pixiv.net/en/artworks/123/',operation,api,'own-extension')).rejects.toThrow('network failed');
        expect(api.updateSessionRules).toHaveBeenCalledTimes(4);
    });
    it('没有伪造来源、没有 API 或其他站点时不安装规则；并发请求串行取得临时规则', async () => {
        const api={updateSessionRules:vi.fn().mockResolvedValue(undefined)},operation=vi.fn().mockResolvedValue('image');
        const source='https://i.pximg.net/img-original/123_p0.jpg';
        for(const page of [undefined,'invalid','http://pixiv.net/artworks/123','https://pixiv.net.attacker.test/artworks/123','https://pixiv.net/']) await withPixivImageReferrer(source,page,operation,api,'own');
        for(const image of ['http://i.pximg.net/a.jpg','https://other.net/a.jpg','https://i.pximg.net:123/a.jpg','https://u@i.pximg.net/a.jpg','https://:p@i.pximg.net/a.jpg']) await withPixivImageReferrer(image,'https://pixiv.net/artworks/123',operation,api,'own');
        expect(api.updateSessionRules).not.toHaveBeenCalled();
        vi.stubGlobal('browser',{runtime:{id:'own'},declarativeNetRequest:undefined});await withPixivImageReferrer(source,'https://pixiv.net/artworks/123',operation);
        vi.stubGlobal('browser',{runtime:{getURL:()=> 'moz-extension://own-uuid/'},declarativeNetRequest:api});const pending=deferred<string>();
        const first=withPixivImageReferrer(source,'https://pixiv.net/artworks/123',()=>pending.promise);
        const second=withPixivImageReferrer(source+'?page=2','https://pixiv.net/artworks/123',operation);
        for(let i=0;i<8;i++)await Promise.resolve();expect(api.updateSessionRules).toHaveBeenCalledTimes(1);
        pending.resolve('first');await first;await second;expect(api.updateSessionRules).toHaveBeenCalledTimes(4);
        api.updateSessionRules.mockRejectedValueOnce(new Error('permission'));await expect(withPixivImageReferrer(source,'https://pixiv.net/artworks/123',operation,api,'own')).rejects.toThrow('permission');
    });
    it('独立 requestId 只匹配本扩展后台，读取结束即清理监听器', async () => {
        const env = pageFixture(); const wait = deferred<string>(); let id = '';
        const pending = withImageSourceAuthorization(env.image, url, undefined, requestId => {id = requestId; return wait.promise;});
        expect(id).toMatch(/^image-source-/);
        expect(env.challenge(id)).toHaveBeenCalledWith({valid: true});
        for (const [extra, sender] of [[{type: 'other'}, {id: 'fluentread-id'}], [{requestId: 'wrong'}, {id: 'fluentread-id'}], [{}, {id: 'other'}], [{}, {id: 'fluentread-id', tab: {id: 1}}]] as const) {
            expect(env.challenge(id, extra, sender)).not.toHaveBeenCalled();
        }
        const respond = vi.fn();
        const listener = [...env.listeners][0];
        for (const invalid of [null, 'not a message']) expect(listener(invalid, {}, respond)).toBe(false);
        expect(respond).not.toHaveBeenCalled();
        wait.resolve('data:image/png,image');
        await expect(pending).resolves.toBe('data:image/png,image');
        expect(env.listeners.size).toBe(0); expect(env.removeListener).toHaveBeenCalledOnce();
        expect(env.challenge(id)).not.toHaveBeenCalled();
    });

    it('HTTP 页面没有 randomUUID 时使用随机字节，仍建立独立图片任务授权', async () => {
        const env = pageFixture(); const getRandomValues = vi.fn((buffer: Uint32Array) => {buffer.set([1, 2, 3, 4]); return buffer;});
        vi.stubGlobal('crypto', {getRandomValues});
        await withImageSourceAuthorization(env.image, url, undefined, async id => {
            expect(id).toBe('image-source-1-2-3-4'); expect(env.challenge(id)).toHaveBeenCalledWith({valid: true});
        });
        expect(getRandomValues).toHaveBeenCalledOnce(); expect(env.listeners.size).toBe(0);
    });

    it('换图、响应式资源变化、移除、导航和错误来源不能继续取得授权', async () => {
        const env = pageFixture();
        await withImageSourceAuthorization(env.image, url, undefined, async id => {
            expect(env.challenge(id, {url: 'https://other.example.com/a.png'})).toHaveBeenCalledWith({valid: false});
            expect(env.challenge(id, {documentUrl: 'https://other.example.com/'})).toHaveBeenCalledWith({valid: false});
            Object.assign(env.image, {currentSrc: url});
            expect(env.challenge(id)).toHaveBeenCalledWith({valid: true});
            Object.assign(env.image, {currentSrc: 'https://other.example.com/a.png'});
            expect(env.challenge(id)).toHaveBeenCalledWith({valid: false});
            Object.assign(env.image, {currentSrc: url});
            env.attributes.srcset = 'changed' as never;
            expect(env.challenge(id)).toHaveBeenCalledWith({valid: false});
            env.attributes.srcset = null;
            Object.assign(env.image, {isConnected: false});
            expect(env.challenge(id)).toHaveBeenCalledWith({valid: false});
            Object.assign(env.image, {isConnected: true}); env.document.URL = 'https://z.ai/next';
            expect(env.challenge(id)).toHaveBeenCalledWith({valid: false});
        });
        expect(env.listeners.size).toBe(0);
    });

    it('预取消不发请求，处理中取消立即撤销授权，失败也清理资源', async () => {
        const env = pageFixture(); const controller = new AbortController(); controller.abort(); const operation = vi.fn();
        await expect(withImageSourceAuthorization(env.image, url, controller.signal, operation)).rejects.toMatchObject({name: 'AbortError'});
        expect(operation).not.toHaveBeenCalled(); expect(env.addListener).not.toHaveBeenCalled();
        const active = new AbortController(); const wait = deferred<void>(); let listener: (...args: any[]) => boolean; let id = '';
        const pending = withImageSourceAuthorization(env.image, url, active.signal, requestId => {id = requestId; listener = [...env.listeners][0]; return wait.promise;});
        active.abort(); expect(env.listeners.size).toBe(0);
        const respond = vi.fn(); listener!({type: IMAGE_SOURCE_VALIDATION_MESSAGE_TYPE, requestId: id, url, documentUrl}, {id: 'fluentread-id'}, respond);
        expect(respond).toHaveBeenCalledWith({valid: false});
        wait.resolve(); await pending;
        await expect(withImageSourceAuthorization(env.image, url, undefined, async () => {throw new Error('read failed');})).rejects.toThrow('read failed');
        expect(env.listeners.size).toBe(0);
    });
});

describe('后台跨域图片来源复核', () => {
    const owner = {sender: {tab: {id: 7}, frameId: 3, url: documentUrl}};
    const options = () => ({requestId: 'source-request', signal: new AbortController().signal, timeoutMs: 1000});
    it('核验真实 sender 的同一 frame、document 与 requestId，生产适配器沿用同一约束', async () => {
        const send = vi.fn(async (_tabId: number, _message: object, _options: {frameId: number}) => ({valid: true})); const verify = createImageSourceVerifier(send); const request = options();
        await verify(url, request, owner);
        expect(send).toHaveBeenCalledWith(7, {type: IMAGE_SOURCE_VALIDATION_MESSAGE_TYPE, requestId: request.requestId, url, documentUrl}, {frameId: 3});
        await verify(url, request, {sender: {tab: {id: 0}, url: 'file:///tmp/page.html'}});
        expect(send.mock.calls[1][2]).toEqual({frameId: 0});
        vi.stubGlobal('browser', {tabs: {sendMessage: send}});
        await imageTranslationSourceTransport.assertImageSource(url, request, owner);
        expect(send).toHaveBeenCalledTimes(3);
    });
    it('扩展 UI、无来源、非法 tab/frame、拒绝或过期响应均不能授权', async () => {
        const send = vi.fn(async (_tabId: number, _message: object, _options: {frameId: number}) => ({valid: true})); const verify = createImageSourceVerifier(send);
        for (const context of [{}, {sender: {}}, {sender: {tab: {id: NaN}, url: documentUrl}}, {sender: {tab: {id: -1}, url: documentUrl}}, {sender: {tab: {id: 7}, frameId: -1, url: documentUrl}}, {sender: {tab: {id: 7}, url: 'chrome-extension://id/popup.html'}}, {sender: {tab: {id: 7}}}]) {
            await expect(verify(url, options(), context)).rejects.toThrow('未授权');
        }
        expect(send).not.toHaveBeenCalled();
        for (const response of [null, false, {}, {valid: false}, {valid: 'true'}]) {
            send.mockResolvedValueOnce(response as never);
            await expect(verify(url, options(), owner)).rejects.toThrow('已失效');
        }
        send.mockRejectedValueOnce(new Error('no receiving end'));
        await expect(verify(url, options(), owner)).rejects.toThrow('已失效');
    });
    it('复核前或等待回复期间取消，不能继续读取图片', async () => {
        const controller = new AbortController(); controller.abort(); const send = vi.fn(async (_tabId: number, _message: object, _options: {frameId: number}) => ({valid: true}));
        const verify = createImageSourceVerifier(send);
        await expect(verify(url, {...options(), signal: controller.signal}, owner)).rejects.toThrow('取消');
        expect(send).not.toHaveBeenCalled();
        const active = new AbortController(); send.mockImplementationOnce(async () => {active.abort(); return {valid: true};});
        await expect(verify(url, {...options(), signal: active.signal}, owner)).rejects.toThrow('取消');
    });

    it('图片 handler 先完成来源核验，缺少授权或已取消时不调用 Offscreen', async () => {
        const verify = vi.fn(async (_url: string, _options: unknown, _context: unknown) => {}); const fetchImage = vi.fn(async () => 'data:image/png,image');
        const dependencies = {assertLanguagesDownloaded: async () => {}, translateImage: async () => ({}), fetchImage, assertImageSource: verify,
            getTranslationService: () => 'google', supportsBatchTranslation: () => false, translateTexts: async () => '', downloadLanguages: async () => {}, markLanguagesDownloaded: async () => []};
        const handlers = createImageTranslationBackgroundHandlers(dependencies);
        const request = {type: IMAGE_FETCH_MESSAGE_TYPE, url, requestId: 'task'} as const;
        const handler = handlers.find(item => item.type === IMAGE_FETCH_MESSAGE_TYPE)!;
        const forged = {...request, documentUrl: 'https://www.pixiv.net/artworks/123'};
        await expect(handler.handle(forged, owner)).resolves.toEqual({success: true, image: 'data:image/png,image'});
        expect(verify).toHaveBeenCalledWith(url, expect.objectContaining({requestId: 'task'}), owner);
        expect(fetchImage).toHaveBeenCalledWith(url, expect.objectContaining({documentUrl}));
        fetchImage.mockClear(); verify.mockRejectedValueOnce(new Error('未授权'));
        await expect(handler.handle({...request, requestId: 'denied'}, owner)).rejects.toThrow('未授权');
        expect(fetchImage).not.toHaveBeenCalled();
        const {assertImageSource: _verify, ...missing} = dependencies;
        const unverified = createImageTranslationBackgroundHandlers(missing).find(item => item.type === IMAGE_FETCH_MESSAGE_TYPE)!;
        await expect(unverified.handle(request)).rejects.toThrow('未授权');
        verify.mockImplementationOnce(async () => {await handlers.find(item => item.type === IMAGE_CANCEL_MESSAGE_TYPE)!.handle({type: IMAGE_CANCEL_MESSAGE_TYPE, requestId: 'cancelled'});});
        await expect(handler.handle({...request, requestId: 'cancelled'}, owner)).rejects.toThrow('取消');
        expect(fetchImage).not.toHaveBeenCalled();
    });
});
