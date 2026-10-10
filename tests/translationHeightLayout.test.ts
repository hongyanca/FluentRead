import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({config: {style: 1, to: 'zh-Hans'}}));
vi.mock('@/src/core/config/catalog', () => ({options: {styles: []}}));

import {appendBilingualTranslation} from '@/src/features/full-page-translation/content/renderer';
import {
    acquireTranslationLayoutOverride,
    beginTranslation,
    ensureTranslationTruncationLayout,
    getTranslationState,
    restoreTranslation,
    setBilingualContent,
} from '@/src/features/full-page-translation/content/state';
import {translationHeightStyleOverrides, translationTruncationStyleOverrides} from '@/src/core/translation/serialization';

const owners: HTMLElement[] = [];
afterEach(() => {
    owners.splice(0).forEach(owner => { if (getTranslationState(owner)) restoreTranslation(owner); });
    vi.unstubAllGlobals();
});

function fixture() {
    const {document, window} = parseHTML(`<html><body>
      <div id="outside"><div id="scroll"><div id="card" style="height:176px;color:red">
        <div id="inner"><div id="clamp"><p id="first">A detailed model description.</p>
          <p id="second">Another model description.</p></div></div>
      </div></div></div>
    </body></html>`);
    const elements = Object.fromEntries(['outside', 'scroll', 'card', 'inner', 'clamp', 'first', 'second']
        .map(id => [id, document.getElementById(id)!])) as Record<string, HTMLElement>;
    const {outside, scroll, card, inner, clamp, first, second} = elements;
    let contentHeight = 340;
    const translated = () => document.querySelectorAll('.fluent-read-bilingual-content').length > 0;
    const innerHeight = () => translated() && clamp.style.getPropertyValue('-webkit-line-clamp') === 'unset'
        ? contentHeight : 120;
    const cardHeight = () => card.style.height === 'auto' ? innerHeight() : parseFloat(card.style.height || '176');
    const rect = (top: number, height: number) => ({top, bottom: top + height, height, left: 0, right: 600, width: 600}) as DOMRect;
    Object.values(elements).forEach(element => {
        Object.defineProperty(element, 'getBoundingClientRect', {configurable: true, value: () => {
            if (element === card) return rect(100, cardHeight());
            if (element === inner) return rect(100 + (cardHeight() - innerHeight()) / 2, innerHeight());
            return rect(0, 1000);
        }});
        Object.defineProperties(element, {
            clientHeight: {configurable: true, get: () => element === card ? cardHeight() : 1000},
            scrollHeight: {configurable: true, get: () => element === card ? Math.max(cardHeight(), innerHeight()) : 1000},
        });
    });
    Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => {
        const lineClamp = element === clamp ? element.style.getPropertyValue('-webkit-line-clamp') || '2' : 'none';
        return {
            height: `${element === card ? cardHeight() : 1000}px`,
            maxHeight: 'none', display: element === card ? 'flex' : 'block',
            position: element.style.position || 'static', transform: 'none',
            overflowY: element.style.overflow || (element === clamp ? 'hidden' : 'visible'),
            overflow: element.style.overflow || (element === clamp ? 'hidden' : 'visible'),
            webkitLineClamp: lineClamp,
            getPropertyValue: (property: string) => property.includes('line-clamp') ? lineClamp : '',
        } as CSSStyleDeclaration;
    }});
    // linkedom 的 defaultView 是动态 Proxy；固定本测试的 realm 方法，避免跨用例绑定到旧 Document。
    const view = {
        Element: window.Element, HTMLElement: window.HTMLElement, Node: window.Node, ShadowRoot: window.ShadowRoot,
        MutationObserver: window.MutationObserver, Event: window.Event, getComputedStyle: window.getComputedStyle,
        addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
        dispatchEvent: window.dispatchEvent.bind(window),
    };
    Object.defineProperty(document, 'defaultView', {configurable: true, value: view});
    const realm = view as unknown as Record<string, unknown>;
    const bindings = Object.fromEntries(['Element', 'HTMLElement', 'Node', 'ShadowRoot', 'MutationObserver']
        .map(name => [name, realm[name]]));
    Object.entries({document, window: view, ...bindings}).forEach(([name, value]) => vi.stubGlobal(name, value));
    vi.stubGlobal('DOMParser', class {
        parseFromString(source: string) { return parseHTML(`<html><body>${source}</body></html>`).document; }
    });
    return {document, window: view, outside, scroll, card, inner, clamp, first, second, setContentHeight: (height: number) => {contentHeight = height;}};
}

function translate(owner: HTMLElement) {
    owners.push(owner);
    const attempt = beginTranslation(owner, 'bilingual')!;
    const wrapper = appendBilingualTranslation(owner, '模型的详细中文说明，翻译后需要更多的纵向空间。');
    setBilingualContent(owner, wrapper);
    attempt.state.phase = 'translated';
    return wrapper;
}

async function flush() {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
}

describe('双语固定高度卡片的共享布局生命周期', () => {
    it('先插入译文并解除内层 clamp，再同步展开外层固定高度，恢复后可再次翻译', () => {
        const {first, card, clamp} = fixture();
        const original = card.getAttribute('style');
        translate(first);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
        expect(card.style.height).toBe('auto');
        expect(restoreTranslation(first)).toBe(true);
        expect(card.getAttribute('style')).toBe(original);
        expect(clamp.getAttribute('style')).toBeNull();
        translate(first);
        expect(card.style.height).toBe('auto');
        expect(first.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
    });

    it('两个段落共享高度租约，恢复第一个不折叠仍有译文的卡片', () => {
        const {first, second, card} = fixture();
        const original = card.getAttribute('style');
        translate(first);
        translate(second);
        restoreTranslation(first);
        expect(card.style.height).toBe('auto');
        expect(second.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
        restoreTranslation(second);
        expect(card.getAttribute('style')).toBe(original);
    });

    it('同一元素的截断租约可以追加高度属性，仍精确恢复首份 style 快照', () => {
        const {first, card} = fixture();
        const original = card.getAttribute('style');
        owners.push(first);
        beginTranslation(first, 'bilingual');
        acquireTranslationLayoutOverride(first, card, translationTruncationStyleOverrides);
        acquireTranslationLayoutOverride(first, card, translationHeightStyleOverrides);
        expect(card.style.height).toBe('auto');
        restoreTranslation(first);
        expect(card.getAttribute('style')).toBe(original);
    });

    it('宿主修改已租用的高度和无关样式后，恢复保留新的宿主值', async () => {
        const {first, card} = fixture();
        translate(first);
        card.setAttribute('style', 'height:240px;border-left:7px solid orange');
        await flush();
        expect(getTranslationState(first)).toBeDefined();
        expect(card.style.height).toBe('auto');
        expect(card.style.getPropertyValue('border-left')).toBe('7px solid orange');
        restoreTranslation(first);
        expect(card.style.height).toBe('240px');
        expect(card.style.getPropertyValue('border-left')).toBe('7px solid orange');
    });

    it('后续所有者加入前的宿主样式变更也不被租约追加掩盖', () => {
        const {first, second, card} = fixture();
        translate(first);
        card.style.setProperty('height', '240px');
        translate(second);
        restoreTranslation(first);
        restoreTranslation(second);
        expect(card.style.height).toBe('240px');
    });

    it('只展开独立滚动容器内部的卡片，不改写滚动容器及其外层高度', () => {
        const {first, card, scroll, outside} = fixture();
        scroll.style.setProperty('overflow', 'auto');
        scroll.style.setProperty('height', '430px');
        const original = scroll.getAttribute('style');
        translate(first);
        expect(card.style.height).toBe('auto');
        expect(scroll.getAttribute('style')).toBe(original);
        expect(outside.getAttribute('style')).toBeNull();
    });

    it('移除唯一 owner 后释放卡片高度及布局资源', async () => {
        const {first, card} = fixture();
        translate(first);
        first.remove();
        await flush();
        expect(card.style.height).toBe('176px');
        expect(getTranslationState(first)).toBeUndefined();
    });

    it.each(['auto', 'scroll'])('宿主把已展开卡片改为 overflow:%s 时撤销共享高度覆盖', async overflow => {
        const {first, second, card} = fixture();
        translate(first);
        translate(second);
        card.setAttribute('style', `height:auto;overflow:${overflow};color:blue`);
        await flush();
        expect(card.style.height).toBe('176px');
        expect(first.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
        expect(second.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
        restoreTranslation(first);
        restoreTranslation(second);
        expect(card.style.height).toBe('176px');
        expect(card.style.overflow).toBe(overflow);
        expect(card.style.color).toBe('blue');
    });

    it('宿主修改高度并将卡片改为定位容器时，采用新的宿主高度', async () => {
        const {first, card} = fixture();
        translate(first);
        card.setAttribute('style', 'height:240px;position:absolute');
        await flush();
        expect(card.style.height).toBe('240px');
        restoreTranslation(first);
        expect(card.style.height).toBe('240px');
        expect(card.style.position).toBe('absolute');
    });

    it('翻译后窗口变窄造成溢出时重新计算，恢复后移除 resize 监听', async () => {
        const {first, card, window, setContentHeight} = fixture();
        const removeListener = vi.fn(window.removeEventListener.bind(window));
        Object.defineProperty(window, 'removeEventListener', {configurable: true, value: removeListener});
        setContentHeight(150);
        translate(first);
        expect(card.style.height).toBe('176px');
        setContentHeight(340);
        window.dispatchEvent(new window.Event('resize'));
        await flush();
        expect(card.style.height).toBe('auto');
        restoreTranslation(first);
        expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
        window.dispatchEvent(new window.Event('resize'));
        await flush();
        expect(card.style.height).toBe('176px');
    });

    it('等待或失败的翻译没有双语工件时不申请高度租约', () => {
        const {first, card} = fixture();
        owners.push(first);
        const attempt = beginTranslation(first, 'bilingual')!;
        ensureTranslationTruncationLayout(first);
        expect(card.style.height).toBe('176px');
        attempt.state.phase = 'error';
        ensureTranslationTruncationLayout(first);
        expect(card.style.height).toBe('176px');
    });
});
