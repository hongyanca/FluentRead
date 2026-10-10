import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';
import {parseHTML} from 'linkedom';

const store = vi.hoisted(() => {
    const listeners = new Set<(config: {uiLanguage?: string}) => void>();
    return {
        config: {uiLanguage: 'zh-CN'} as {uiLanguage?: string},
        listeners,
        requestConfigPatch: vi.fn(async () => undefined),
        emit(next: {uiLanguage?: string}) {
            Object.assign(this.config, next);
            for (const listener of listeners) listener(this.config);
        },
    };
});
const loader = vi.hoisted(() => ({ensure: vi.fn<(language: unknown) => Promise<boolean>>()}));

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn()}}}));
vi.mock('@/src/services/config/store', () => ({
    config: store.config,
    configReady: Promise.resolve(),
    requestConfigPatch: store.requestConfigPatch,
    subscribeConfig: (listener: (config: {uiLanguage?: string}) => void) => {
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
    },
}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: loader.ensure}));

import {registerUiLanguageBundle} from '@/src/core/i18n';
import {createUiI18nContext, createUiI18nPlugin} from '@/src/ui/i18n';

function deferred() {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => { resolve = done; });
    return {promise, resolve};
}

beforeEach(() => {
    store.config.uiLanguage = 'zh-CN';
    store.listeners.clear();
    store.requestConfigPatch.mockClear();
    loader.ensure.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('源语言界面的 DOM 扫描成本', () => {
    it('中文冷启动和动态更新不扫描，外语切回中文恢复一次后停止重复扫描', async () => {
        const {window} = parseHTML('<html><body><button title="设置">设置</button></body></html>');
        for (const key of ['document', 'Node', 'MutationObserver']) vi.stubGlobal(key, window[key as keyof typeof window]);
        vi.stubGlobal('NodeFilter', {SHOW_TEXT: 4});
        const walker = vi.spyOn(window.document, 'createTreeWalker');
        registerUiLanguageBundle('fr-FR', {messages: {}, legacyText: {'设置': 'Réglages'}, legacyPatterns: {early: [], late: []}});
        let unmount!: () => void;
        const app = {config: {globalProperties: {}}, provide: vi.fn(), directive: vi.fn(), mixin(hooks: {beforeUnmount: () => void}) { unmount = hooks.beforeUnmount; }};
        const plugin = createUiI18nPlugin({documentRoot: window.document.body});
        (plugin as {install: (value: unknown) => void}).install(app);
        const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 15)); };
        try {
            await flush();
            window.document.body.appendChild(window.document.createElement('span')).textContent = '设置';
            await flush();
            expect(walker).not.toHaveBeenCalled();

            store.emit({uiLanguage: 'fr-FR'});
            await flush();
            expect(window.document.querySelector('button')?.textContent).toBe('Réglages');
            expect(window.document.querySelector('button')?.getAttribute('title')).toBe('Réglages');

            store.emit({uiLanguage: 'zh-CN'});
            await flush();
            expect(window.document.querySelector('button')?.textContent).toBe('设置');
            expect(window.document.querySelector('button')?.getAttribute('title')).toBe('设置');
            const scansAfterRestore = walker.mock.calls.length;
            window.document.querySelector('span')!.textContent = '新内容';
            await flush();
            expect(walker).toHaveBeenCalledTimes(scansAfterRestore);
        } finally {
            const root: {$root?: unknown} = {};
            root.$root = root;
            // 插件在根组件卸载时释放 document observer 和语言订阅。
            unmount.call(root);
        }
    });
});

describe('Vue 界面语言资源按需刷新', () => {
    it('资源到达后只为仍在使用该语言的界面递增修订号，普通配置变化不触发刷新', async () => {
        const pending = deferred();
        loader.ensure.mockReturnValue(pending.promise);
        const context = createUiI18nContext();
        await Promise.resolve();
        expect(loader.ensure).not.toHaveBeenCalled();

        store.emit({uiLanguage: 'ko-KR'});
        expect(context.language.value).toBe('ko-KR');
        expect(context.t('popup.donationTitle')).toBe(context.t('popup.donationTitle'));
        registerUiLanguageBundle('ko-KR', {messages: {'popup.donationTitle': '후원'}, legacyText: {}, legacyPatterns: {early: [], late: []}});
        pending.resolve(true);
        await pending.promise;
        await nextTick();
        expect(context.bundleRevision.value).toBe(1);
        expect(context.t('popup.donationTitle')).toBe('후원');

        // 已注册语言上的其他配置写入不应重复加载或整页重扫。
        store.emit({uiLanguage: 'ko-KR'});
        await Promise.resolve();
        expect(loader.ensure).toHaveBeenCalledOnce();
        expect(context.bundleRevision.value).toBe(1);
        context.dispose();
    });

    it('迟到或失败的资源不会刷新已切走或已销毁的界面', async () => {
        const stale = deferred();
        const failed = deferred();
        loader.ensure.mockReturnValueOnce(stale.promise).mockReturnValueOnce(failed.promise);
        const context = createUiI18nContext();
        store.emit({uiLanguage: 'ru-RU'});
        store.emit({uiLanguage: 'es-ES'});
        stale.resolve(true);
        failed.resolve(false);
        await Promise.all([stale.promise, failed.promise]);
        await nextTick();
        expect(context.bundleRevision.value).toBe(0);

        const late = deferred();
        loader.ensure.mockReturnValueOnce(late.promise);
        store.emit({uiLanguage: 'ja-JP'});
        context.dispose();
        late.resolve(true);
        await late.promise;
        expect(context.bundleRevision.value).toBe(0);
    });

    it('主动切换语言时先取得资源再提交配置，保存失败回滚到原语言', async () => {
        loader.ensure.mockResolvedValue(true);
        const context = createUiI18nContext();
        await context.setLanguage('fr-FR');
        expect(loader.ensure).toHaveBeenCalledWith('fr-FR');
        expect(loader.ensure.mock.invocationCallOrder[0]).toBeLessThan(store.requestConfigPatch.mock.invocationCallOrder[0]!);
        expect(store.requestConfigPatch).toHaveBeenCalledWith({uiLanguage: 'fr-FR', uiLanguageSetupCompleted: true}, expect.any(Function));
        expect(context.language.value).toBe('fr-FR');

        store.requestConfigPatch.mockRejectedValueOnce(new Error('offline'));
        await expect(context.setLanguage('en-US')).rejects.toThrow('offline');
        expect(context.language.value).toBe('fr-FR');
        context.dispose();
    });
});
