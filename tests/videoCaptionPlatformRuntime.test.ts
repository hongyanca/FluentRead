import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {Config} from '@/src/core/config/model';
import {mountPlatformCaptions} from '@/src/features/video-subtitle/content/platformRuntime';

const disposals: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture(url: string, html: string, translate = vi.fn().mockResolvedValue('测试译文')) {
    const {document, window} = parseHTML(`<html><body>${html}</body></html>`);
    // linkedom 不实现 CSS priority；补齐浏览器的标准接口，以验证精确恢复而非削弱产品逻辑。
    const stylePrototype = Object.getPrototypeOf(document.body.style);
    if (!stylePrototype.getPropertyPriority) {
        const priorities = new WeakMap<object, Map<string, string>>();
        const set = stylePrototype.setProperty, remove = stylePrototype.removeProperty, get = stylePrototype.getPropertyValue;
        stylePrototype.getPropertyValue = function (key: string) { return get.call(this, key) || ''; };
        stylePrototype.getPropertyPriority = function (key: string) { return priorities.get(this)?.get(key) || ''; };
        stylePrototype.setProperty = function (key: string, value: string, priority = '') {
            if (!priorities.has(this)) priorities.set(this, new Map());
            priorities.get(this)!.set(key, priority); return set.call(this, key, value);
        };
        stylePrototype.removeProperty = function (key: string) { priorities.get(this)?.delete(key); return remove.call(this, key); };
    }
    const selectedValues = new WeakMap<object, string>();
    Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
        configurable: true,
        get() { return selectedValues.get(this) || ''; },
        set(value) { selectedValues.set(this, value); },
    });
    const config = new Config(); config.to = 'zh-Hans'; config.on = true;
    Object.defineProperty(window, 'location', {value: new URL(url), configurable: true});
    Object.defineProperty(window, 'innerWidth', {value: 1280, configurable: true});
    Object.defineProperty(window, 'innerHeight', {value: 900, configurable: true});
    window.getComputedStyle = () => ({display: 'block', visibility: 'visible'}) as CSSStyleDeclaration;
    vi.stubGlobal('MutationObserver', window.MutationObserver);
    let subscription: (() => void) | undefined;
    const patch = vi.fn((value: Partial<Config>) => { Object.assign(config, value); subscription?.(); });
    const subscribe = vi.fn((listener: () => void) => { subscription = listener; return vi.fn(); });
    const ports = {document: document as unknown as Document, window: window as unknown as Window, config, translate, patch, subscribe, label: (text: string) => text};
    const start = () => { const dispose = mountPlatformCaptions(ports); disposals.push(dispose); return dispose; };
    const shadow = () => document.getElementById('fluent-read-platform-captions')?.shadowRoot;
    return {document, window, config, translate, patch, subscribe, start, shadow, change: () => subscription?.()};
}
const sentence = 'This is the first sentence in the meeting.';

describe('网页会议字幕生命周期', () => {
    it.each([
        ['https://meet.google.com/abc-defg-hij', '<span class="ygicle VbkSUe">'],
        ['https://teams.microsoft.com/v2/', '<span data-tid="closed-caption-text">'],
        ['https://us02web.zoom.us/wc/1/join', '<span class="live-transcription-subtitle__item">'],
    ])('在 %s 翻译、换句、关闭、恢复且不改字幕文本', async (url, open) => {
        const f = fixture(url, `${open}${sentence}</span>`), native = f.document.querySelector('span')!;
        native.style.setProperty('visibility', 'visible', 'important');
        f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
        expect(native.textContent).toBe(sentence); expect(native.style.visibility).toBe('hidden');
        native.textContent = 'Now another participant is speaking.'; await vi.advanceTimersByTimeAsync(300);
        expect(f.shadow()?.querySelector('.source')?.textContent).toBe(native.textContent);
        f.config.videoSubtitleVisible = false; f.change();
        expect(native.style.visibility).toBe('visible'); expect(native.style.getPropertyPriority('visibility')).toBe('important');
        expect(f.document.getElementById('fluent-read-platform-captions')?.hidden).toBe(true);
        f.config.videoSubtitleVisible = true; f.change(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
        expect(f.document.querySelectorAll('#fluent-read-platform-captions')).toHaveLength(1);
    });

    it('自动开启明确字幕控件只点击一次，关闭插件恢复；原先已开启的不操作', async () => {
        const f = fixture('https://meet.google.com/abc-defg-hij', '<button aria-label="Turn on captions"></button>');
        const button = f.document.querySelector('button')!;
        const click = vi.fn(() => button.setAttribute('aria-label', button.getAttribute('aria-label') === 'Turn on captions' ? 'Turn off captions' : 'Turn on captions'));
        button.addEventListener('click', click);
        const dispose = f.start(); await vi.advanceTimersByTimeAsync(1000);
        expect(click).toHaveBeenCalledTimes(1);
        f.config.videoTranslationEnabled = false; f.change(); expect(click).toHaveBeenCalledTimes(2);
        dispose();
        const manual = fixture('https://meet.google.com/abc-defg-hij', '<button aria-label="Turn off captions"></button>');
        const manualClick = vi.fn(); manual.document.querySelector('button')!.addEventListener('click', manualClick);
        manual.start()(); expect(manualClick).not.toHaveBeenCalled();
    });

    it('自动开关关闭时仍可翻译手动开启字幕，不操作禁用和隐藏控件', async () => {
        const f = fixture('https://meet.google.com/abc-defg-hij', `<button aria-label="Turn on captions"></button><span data-caption-text>${sentence}</span>`);
        const click = vi.fn(); f.document.querySelector('button')!.addEventListener('click', click);
        f.config.videoMeetingAutoEnabled = false; f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(click).not.toHaveBeenCalled(); expect(f.translate).toHaveBeenCalledOnce();
        f.config.videoMeetingAutoEnabled = true;
        f.window.getComputedStyle = () => ({display: 'none', visibility: 'hidden'}) as CSSStyleDeclaration;
        f.change(); expect(click).not.toHaveBeenCalled();
    });

    it('用户手动关闭再开启后，停用插件保留用户选择的原生字幕状态', async () => {
        const f = fixture('https://meet.google.com/abc-defg-hij', '<button aria-label="Turn on captions"></button>');
        const button = f.document.querySelector('button')!;
        button.addEventListener('click', () => button.setAttribute('aria-label', button.getAttribute('aria-label') === 'Turn on captions' ? 'Turn off captions' : 'Turn on captions'));
        const dispose = f.start();
        expect(button.getAttribute('aria-label')).toBe('Turn off captions');
        for (let i = 0; i < 2; i++) {
            const click = new f.window.Event('click', {bubbles: true});
            Object.defineProperty(click, 'isTrusted', {value: true});
            button.dispatchEvent(click);
            await vi.advanceTimersByTimeAsync(300);
            expect(button.getAttribute('aria-label')).toBe(i === 0 ? 'Turn on captions' : 'Turn off captions');
        }
        dispose();
        expect(button.getAttribute('aria-label')).toBe('Turn off captions');
    });

    it('Teams 会议菜单按更多操作、语言和语音、字幕开启顺序只执行一次', async () => {
        const f = fixture('https://teams.cloud.microsoft/v2/', '<button id="callingButtons-showMoreBtn" aria-expanded="false">More actions</button>');
        const actions: string[] = [];
        f.document.getElementById('callingButtons-showMoreBtn')!.addEventListener('click', () => {
            actions.push('more');
            f.document.getElementById('callingButtons-showMoreBtn')!.setAttribute('aria-expanded', 'true');
            const language = f.document.createElement('div'); language.setAttribute('role', 'menuitem'); language.textContent = 'Language and speech';
            language.addEventListener('click', () => {
                actions.push('language'); language.remove();
                const enable = f.document.createElement('button'); enable.dataset.tid = 'closed-caption-button'; enable.textContent = 'Turn on live captions';
                enable.addEventListener('click', () => {
                    actions.push('captions'); enable.textContent = 'Turn off live captions';
                    const caption = f.document.createElement('span'); caption.dataset.tid = 'closed-caption-text'; caption.textContent = sentence;
                    f.document.body.appendChild(caption);
                });
                f.document.body.appendChild(enable);
            });
            f.document.body.appendChild(language);
        });
        f.start(); await vi.advanceTimersByTimeAsync(1200);
        expect(actions).toEqual(['more', 'language', 'captions']);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
    });

    it('逐词连续变化有界更新；晚到的上句结果和关闭后的结果不会写回', async () => {
        let finish!: (text: string) => void;
        const translate = vi.fn().mockImplementationOnce(() => new Promise<string>(yes => { finish = yes; })).mockResolvedValue('新的译文');
        const f = fixture('https://teams.live.com/meet/1', `<span data-tid="closed-caption-text">${sentence}</span>`, translate);
        const native = f.document.querySelector('span')!;
        const dispose = f.start(); await vi.advanceTimersByTimeAsync(0);
        native.textContent = 'Another sentence about the project.'; await vi.advanceTimersByTimeAsync(300);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('新的译文');
        finish('过期译文'); await vi.advanceTimersByTimeAsync(1);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('新的译文');
        dispose(); expect(f.document.getElementById('fluent-read-platform-captions')).toBeNull();
        expect(native.style.getPropertyValue('visibility')).toBe('');
        const count = translate.mock.calls.length;
        native.textContent = 'Changed after disposal'; await vi.advanceTimersByTimeAsync(1000);
        expect(translate).toHaveBeenCalledTimes(count);
    });

    it('原文模式、同语言、失败重试与显示菜单复用配置端口', async () => {
        const translate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('重试译文');
        const f = fixture('https://teams.microsoft.com/v2/', `<span data-tid="closed-caption-text">${sentence}</span>`, translate);
        f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('这句翻译失败');
        f.shadow()?.querySelector('button')!.click(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('重试译文');
        const select = f.shadow()!.querySelector('select')!;
        select.value = 'original-only'; select.dispatchEvent(new f.window.Event('change'));
        expect(f.patch).toHaveBeenLastCalledWith({videoSubtitleDisplayMode: 'original-only'});
        await vi.advanceTimersByTimeAsync(100); expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('');
        select.value = 'off'; select.dispatchEvent(new f.window.Event('change'));
        expect(f.config.videoSubtitleVisible).toBe(false);
        const same = fixture('https://meet.google.com/abc-defg-hij', '<span data-caption-text>这是当前会议的中文字幕内容。</span>');
        same.start(); await vi.advanceTimersByTimeAsync(100);
        expect(same.translate).not.toHaveBeenCalled(); expect(same.shadow()?.querySelector('.translation')?.textContent).toBe('');
        same.config.videoSubtitleDisplayMode = 'translation-only'; same.change(); await vi.advanceTimersByTimeAsync(100);
        expect(same.shadow()?.querySelector<HTMLElement>('.source')?.hidden).toBe(true);
        expect(same.shadow()?.querySelector('.translation')?.textContent).toBe('这是当前会议的中文字幕内容。');
    });

    it('动态节点、空档、换会议、全屏和宿主修改后保持所有权', async () => {
        const f = fixture('https://meet.google.com/abc-defg-hij', '<div id="fullscreen"></div>');
        const dispose = f.start();
        const native = f.document.createElement('span'); native.dataset.captionText = ''; native.textContent = sentence;
        f.document.body.appendChild(native); await vi.advanceTimersByTimeAsync(300);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
        Object.defineProperty(f.document, 'fullscreenElement', {configurable: true, value: f.document.getElementById('fullscreen')});
        f.document.dispatchEvent(new f.window.Event('fullscreenchange')); await vi.advanceTimersByTimeAsync(100);
        expect(f.document.getElementById('fluent-read-platform-captions')?.parentElement?.id).toBe('fullscreen');
        native.textContent = ''; await vi.advanceTimersByTimeAsync(300);
        expect(f.document.getElementById('fluent-read-platform-captions')?.hidden).toBe(true);
        expect(native.style.getPropertyValue('visibility')).toBe('');
        native.textContent = sentence; f.window.location.href = 'https://meet.google.com/xxx-yyyy-zzz'; await vi.advanceTimersByTimeAsync(300);
        expect(f.translate).toHaveBeenCalledTimes(2);
        native.style.setProperty('visibility', 'collapse'); dispose();
        expect(native.style.getPropertyValue('visibility')).toBe('collapse');
    });
});

function videoFixture(url: string, translate?: ReturnType<typeof vi.fn>) {
    const f = fixture(url, `<div class="video-player"><video src="one.mp4"></video><span data-purpose="captions-cue-text">${sentence}</span></div>`, translate);
    const video = f.document.querySelector('video')! as unknown as HTMLVideoElement;
    video.getBoundingClientRect = () => ({left: 50, top: 50, width: 800, height: 450}) as DOMRect;
    Object.assign(video, {currentTime: 1, paused: true, ended: false, seeking: false});
    const source = {kind: 'subtitles', language: 'en', label: 'English', mode: 'showing', cues: [{startTime: 0, endTime: 2, text: sentence}]} as unknown as TextTrack;
    const target = {kind: 'subtitles', language: 'zh-CN', label: 'Chinese', mode: 'disabled', cues: [{startTime: 0, endTime: 2, text: '人工字幕'}]} as unknown as TextTrack;
    Object.defineProperty(video, 'textTracks', {value: [source, target], configurable: true});
    return {...f, video, source, target};
}

describe('Udemy 与 Disney+ 原生人工字幕', () => {
    it.each(['https://www.udemy.com/course/demo/learn/', 'https://www.disneyplus.com/video/demo'])('在 %s 优先人工轨，不请求服务并恢复轨道模式', async url => {
        const f = videoFixture(url); const dispose = f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.source')?.textContent).toBe(sentence);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('人工字幕');
        expect(f.translate).not.toHaveBeenCalled(); expect(f.target.mode).toBe('hidden'); expect(f.source.mode).toBe('hidden');
        f.config.videoPreferHumanSubtitles = false; f.change(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
        expect(f.target.mode).toBe('disabled'); dispose(); expect(f.source.mode).toBe('showing');
    });

    it('人工字幕空档回退翻译；视频空档、拖动和换片不留旧句', async () => {
        const f = videoFixture('https://www.udemy.com/course/demo/learn/');
        f.target.cues![0].startTime = 1.5;
        f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
        f.video.currentTime = 1.6; await vi.advanceTimersByTimeAsync(250);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('人工字幕');
        Object.assign(f.video, {seeking: true}); await vi.advanceTimersByTimeAsync(250);
        expect(f.document.getElementById('fluent-read-platform-captions')?.hidden).toBe(true);
        Object.assign(f.video, {seeking: false}); f.video.setAttribute('src', 'two.mp4'); f.target.cues![0].endTime = 3;
        await vi.advanceTimersByTimeAsync(250); expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('人工字幕');
        f.document.querySelector('span')!.textContent = ''; f.video.currentTime = 4;
        await vi.advanceTimersByTimeAsync(250); expect(f.document.getElementById('fluent-read-platform-captions')?.hidden).toBe(true);
    });

    it('没有可读轨道时从字幕 DOM 回退，结束时恢复，非目标页不挂载', async () => {
        const f = videoFixture('https://www.udemy.com/course/demo/learn/');
        Object.defineProperty(f.video, 'textTracks', {value: []});
        const dispose = f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.translation')?.textContent).toBe('测试译文');
        Object.assign(f.video, {ended: true}); await vi.advanceTimersByTimeAsync(250);
        expect(f.document.querySelector('span')!.style.getPropertyValue('visibility')).toBe(''); dispose();
        const unknown = fixture('https://example.com/', '<span data-caption-text>Unrelated text</span>'); unknown.start()();
        expect(unknown.document.getElementById('fluent-read-platform-captions')).toBeNull();
    });

    it('多视频只读取当前播放器字幕，卸载保留用户后来选择的轨道模式', async () => {
        const f = videoFixture('https://www.udemy.com/course/demo/learn/');
        Object.defineProperty(f.video, 'textTracks', {value: []});
        const other = f.document.createElement('div'); other.className = 'video-player';
        other.innerHTML = '<video></video><span data-purpose="captions-cue-text">Unrelated recommendation caption.</span>';
        const otherVideo = other.querySelector('video')! as unknown as HTMLVideoElement;
        otherVideo.getBoundingClientRect = () => ({width: 300, height: 180}) as DOMRect;
        Object.assign(otherVideo, {paused: true, ended: false, seeking: false});
        f.document.body.appendChild(other);
        f.start(); await vi.advanceTimersByTimeAsync(100);
        expect(f.shadow()?.querySelector('.source')?.textContent).toBe(sentence);
        expect(other.querySelector('span')!.style.getPropertyValue('visibility')).toBe('');
        const native = videoFixture('https://www.disneyplus.com/video/demo'); const dispose = native.start();
        await vi.advanceTimersByTimeAsync(100); native.target.mode = 'showing'; dispose();
        expect(native.target.mode).toBe('showing'); expect(native.source.mode).toBe('showing');
    });
});
