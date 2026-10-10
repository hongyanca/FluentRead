import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createSiteAdaptationSession} from '@/src/core/site-adaptation/session';
import {getCurrentTranslationCore, setCurrentTranslationAdapters} from '@/src/core/translation/current';
import {defaultTranslationAdapters} from '@/src/core/translation/registry';
import {compileSiteRulePack} from '@/src/core/site-adaptation/compiler';
import type {SiteRulePack} from '@/src/core/site-adaptation/types';

const pack: SiteRulePack = {version: 1, rules: [{
    id: 'article', name: '文章正文', match: {hosts: ['example.test'], paths: ['/articles/*']},
    mode: 'focus', content: [{css: ['article p'], resolve: 'closest'}],
}]};

afterEach(() => {
    setCurrentTranslationAdapters(defaultTranslationAdapters);
    vi.unstubAllGlobals();
});

describe('网站适配会话切换', () => {
    it('首次路由只记身份，同一匹配集合不打断，切换边界先取消旧会话', () => {
        const events: string[] = [];
        const session = createSiteAdaptationSession(pack, {apply: () => events.push('apply'), invalidate: () => events.push('invalidate')});
        session.update(undefined);
        expect(session.routeChanged(new URL('https://example.test/articles/start'))).toBe(false);
        expect(session.routeChanged(new URL('https://example.test/articles/next?sort=new#comment'))).toBe(false);
        expect(events).toEqual(['apply']);
        expect(session.routeChanged(new URL('https://example.test/settings'))).toBe(true);
        expect(events).toEqual(['apply', 'invalidate']);
        expect(session.routeChanged(new URL('https://other.test/settings'))).toBe(false);
        expect(session.routeChanged(new URL('https://example.test/articles/start'))).toBe(true);
        expect(events).toEqual(['apply', 'invalidate', 'invalidate']);
    });

    it('配置变更同步路由身份，不会在迟到的路由事件中重复恢复', () => {
        const invalidate = vi.fn();
        const session = createSiteAdaptationSession(pack, {apply: vi.fn(), invalidate});
        session.routeChanged(new URL('https://example.test/articles/start'));
        session.update(undefined);
        expect(session.routeChanged(new URL('https://example.test/articles/start'))).toBe(false);
        session.update({enabled: false});
        expect(session.routeChanged(new URL('https://example.test/articles/start'))).toBe(false);
        expect(invalidate).toHaveBeenCalledTimes(1);
        session.update({enabled: true}, new URL('https://example.test/settings'));
        expect(session.routeChanged(new URL('https://example.test/settings'))).toBe(false);
        expect(invalidate).toHaveBeenCalledTimes(2);
        // 同值配置回声不得吞掉尚未处理的路由变化。
        expect(session.update({enabled: true}, new URL('https://example.test/articles/start'))).toBe(false);
        expect(session.routeChanged(new URL('https://example.test/articles/start'))).toBe(true);
        expect(invalidate).toHaveBeenCalledTimes(3);
    });

    it('初始化不取消会话，同值存储回声不重编译，更新先失效再发布', () => {
        const events: string[] = [];
        const apply = vi.fn(() => events.push('apply'));
        const session = createSiteAdaptationSession(pack, {apply, invalidate: () => events.push('invalidate')});
        expect(session.update(undefined)).toBe(true);
        expect(events).toEqual(['apply']);
        expect(session.update({enabled: true, disabledRuleIds: [], custom: {version: 1, rules: []}})).toBe(false);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(session.update({enabled: false})).toBe(true);
        expect(events).toEqual(['apply', 'invalidate', 'apply']);
        expect(apply.mock.calls[1]).toEqual([[]]);
        expect(session.update({enabled: false})).toBe(false);
        expect(session.update(undefined)).toBe(true);
        expect(events).toEqual(['apply', 'invalidate', 'apply', 'invalidate', 'apply']);
    });

    it('同 URL 下配置变更重建候选核心，同时使悬浮和全文遵守新保护区', () => {
        vi.stubGlobal('location', {href: 'https://example.test/articles/start'});
        const {document} = parseHTML('<html><body><article><p id="source">Readable article sentence.</p></article></body></html>');
        const session = createSiteAdaptationSession(pack, {apply: setCurrentTranslationAdapters, invalidate: vi.fn()});
        session.update(undefined);
        const first = getCurrentTranslationCore();
        expect(first.discover(document).map(item => item.element.id)).toEqual(['source']);
        expect(first.resolve(document.querySelector('#source'))?.element.id).toBe('source');
        session.update({custom: {version: 1, rules: [{...pack.rules[0], protect: ['#source']}]}});
        const next = getCurrentTranslationCore();
        expect(next).not.toBe(first);
        expect(next.discover(document)).toEqual([]);
        expect(next.resolve(document.querySelector('#source'))).toBeNull();
        expect(getCurrentTranslationCore()).toBe(next);
    });

    it('同一适配器引用保持缓存，SPA 路径改变重新匹配规则', () => {
        vi.stubGlobal('location', {href: 'https://example.test/articles/start'});
        const adapters = compileSiteRulePack(pack);
        setCurrentTranslationAdapters(adapters);
        const first = getCurrentTranslationCore();
        expect(first.adapters.map(item => item.id)).toEqual(['article']);
        setCurrentTranslationAdapters(adapters);
        expect(getCurrentTranslationCore()).toBe(first);
        vi.stubGlobal('location', {href: 'https://example.test/settings'});
        const second = getCurrentTranslationCore();
        expect(second).not.toBe(first);
        expect(second.adapters).toEqual([]);
    });
});
