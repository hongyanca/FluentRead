/**
 * @file tests/fullPageRemountPreparation.test.ts
 * 文件职责：验证全文重挂准备的公开拒绝边界与当前来源身份。
 * 主要内容：使用真实候选核心、翻译状态和 DOM 来源读取，拒绝不完整元素、
 * owner/kind/外壳不匹配与改写原文，并确认准备不写 DOM、来源引用属于新 owner。
 * 模块边界：只构造 linkedom 夹具并调用公开端口；不替换算法、不发请求、不启动浏览器。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createBilingualRemountPreparationBatch, transferEquivalentBilingualOwners} from '@/src/features/full-page-translation/content/bilingualRemount';
import {asHTMLElement, isElementNode, mutationTargetElement} from '@/src/features/full-page-translation/content/mutationObservation';
import {acquireTranslationLayoutOverride, beginTranslation, getTranslationState, markTranslationComplete, restoreAllTranslations, restoreTranslation, setBilingualContent} from '@/src/features/full-page-translation/content/state';
import {getCurrentTranslationCore, translationTruncationStyleOverrides} from '@/src/core/translation/public';

const source = 'This readable source paragraph must keep its current text and translation ownership after remounting.';

function committedReplacement(replacementSource = source) {
    const {document} = parseHTML('<html><head></head><body><p id="old"></p></body></html>');
    const previousOwner = document.getElementById('old')!;
    previousOwner.textContent = source;
    const attempt = beginTranslation(previousOwner, 'bilingual', 'content', false, source,
        [previousOwner.firstChild as Text], false, undefined, 'all')!;
    expect(markTranslationComplete(previousOwner, attempt.state, attempt.generation)).toBe(true);
    const wrapper = document.createElement('span');
    wrapper.className = 'fluent-read-bilingual-content';
    wrapper.setAttribute('data-fr-translation-owned', 'true');
    wrapper.setAttribute('translate', 'no');
    wrapper.textContent = '已经提交的可信译文。';
    previousOwner.appendChild(wrapper);
    setBilingualContent(previousOwner, wrapper);
    const replacementOwner = document.createElement('p');
    replacementOwner.textContent = replacementSource;
    previousOwner.replaceWith(replacementOwner);
    return {document, previousOwner, replacementOwner, state: attempt.state};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    restoreAllTranslations();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
});

describe('公开全文重挂准备与节点边界', () => {
    it('真实重挂准备与交接当轮重新解除最后旧租户恢复的裁剪，恢复保留新来源', () => {
        const fixture = committedReplacement();
        const {document, previousOwner, replacementOwner} = fixture;
        const window = document.defaultView!;
        const descriptor = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');
        const clamp = document.createElement('div');
        clamp.setAttribute('style', 'max-height:20px;overflow:hidden');
        const originalStyle = clamp.getAttribute('style');
        const sourceNode = replacementOwner.firstChild;
        replacementOwner.replaceWith(clamp);
        clamp.append(previousOwner);
        const clipped = () => clamp.style.getPropertyValue('max-height') === '20px';
        const rect = (height: number) => ({top: 0, bottom: height} as DOMRect);
        clamp.getBoundingClientRect = () => rect(clipped() ? 20 : 80);
        replacementOwner.getBoundingClientRect = () => rect(80);
        Object.defineProperties(clamp, {
            clientHeight: {get: () => clipped() ? 20 : 80}, scrollHeight: {value: 80},
        });
        try {
            Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => ({
                display: 'block', visibility: 'visible', fontFamily: 'serif', position: 'static', transform: 'none',
                height: '100px', maxHeight: element === clamp ? clamp.style.getPropertyValue('max-height') : 'none',
                overflowY: element === clamp ? clamp.style.getPropertyValue('overflow') : 'visible',
                webkitLineClamp: 'none', getPropertyValue: () => '',
            })});
            expect(acquireTranslationLayoutOverride(previousOwner, clamp, translationTruncationStyleOverrides)).toBe(true);
            previousOwner.replaceWith(replacementOwner);
            const result = transferEquivalentBilingualOwners({type: 'childList', target: clamp,
                addedNodes: [replacementOwner], removedNodes: [previousOwner]} as unknown as MutationRecord,
            createBilingualRemountPreparationBatch());
            expect(result.transfers).toEqual([{previousOwner, replacementOwner}]);
            expect(clamp.style.getPropertyValue('max-height')).toBe('unset');
            expect(getTranslationState(previousOwner)).toBeUndefined();
            expect(replacementOwner.firstChild).toBe(sourceNode);
            expect(restoreTranslation(replacementOwner)).toBe(true);
            expect(clamp.getAttribute('style')).toBe(originalStyle);
            expect(replacementOwner.textContent).toBe(source);
        } finally {
            restoreAllTranslations();
            if (descriptor) Object.defineProperty(window, 'getComputedStyle', descriptor);
            else Reflect.deleteProperty(window, 'getComputedStyle');
        }
    });

    it('拒绝缺少标签或样式的元素形状，保留 Text 与 ShadowRoot 的真实宿主', () => {
        for (const invalid of [null, undefined, false, 'p', {nodeType: 3},
            {nodeType: 1, tagName: 12, style: {}}, {nodeType: 1, tagName: 'P', style: undefined}]) {
            expect(asHTMLElement(invalid)).toBeNull();
        }
        const {document} = parseHTML('<html><body><div id="host">Original text.</div></body></html>');
        const host = document.getElementById('host')!;
        expect(asHTMLElement(host)).toBe(host);
        expect(isElementNode(host)).toBe(true);
        expect(isElementNode(document)).toBe(false);
        expect(mutationTargetElement(host.firstChild!)).toBe(host);
        expect(mutationTargetElement(host.attachShadow({mode: 'open'}))).toBe(host);
        expect(mutationTargetElement(document.createDocumentFragment())).toBeNull();
    });

    it('准备保留新 owner 的精确 Text，下一批重新读取隐藏保护和原文变化', () => {
        const fixture = committedReplacement();
        const text = fixture.replacementOwner.firstChild as Text;
        const html = fixture.document.documentElement.outerHTML;
        const prepare = createBilingualRemountPreparationBatch();
        const prepared = prepare(fixture.previousOwner, fixture.replacementOwner, fixture.state);
        expect(prepared?.sourceTextNodes).toEqual([text]);
        expect(prepared?.sourceTextNodes[0]).toBe(text);
        expect(typeof prepared?.reconcileLayout).toBe('function');
        expect(fixture.document.documentElement.outerHTML).toBe(html);
        fixture.replacementOwner.hidden = true;
        expect(createBilingualRemountPreparationBatch()(fixture.previousOwner, fixture.replacementOwner, fixture.state)).toBeNull();
        fixture.replacementOwner.hidden = false;
        text.data = 'The host changed this source between synchronous batches.';
        expect(createBilingualRemountPreparationBatch()(fixture.previousOwner, fixture.replacementOwner, fixture.state)).toBeNull();
        text.data = source;
        expect(createBilingualRemountPreparationBatch()(fixture.previousOwner, fixture.replacementOwner, fixture.state)?.sourceTextNodes[0]).toBe(text);
    });

    it('拒绝不匹配的 kind、外壳权限和非 owner 后代，并保持 DOM 原样', () => {
        const fixture = committedReplacement();
        const prepare = createBilingualRemountPreparationBatch();
        expect(getCurrentTranslationCore('all').resolve(fixture.replacementOwner)?.kind).toBe('content');
        expect(prepare(fixture.previousOwner, fixture.replacementOwner, {...fixture.state, kind: 'control'})).toBeNull();
        expect(prepare(fixture.previousOwner, fixture.replacementOwner, {...fixture.state, allowTopLevelApplicationShell: true})).toBeNull();
        fixture.replacementOwner.innerHTML = '<span></span>';
        const descendant = fixture.replacementOwner.firstElementChild as HTMLElement;
        descendant.textContent = source;
        expect(getCurrentTranslationCore('all').resolve(descendant)?.element).toBe(fixture.replacementOwner);
        const html = fixture.document.documentElement.outerHTML;
        expect(createBilingualRemountPreparationBatch()(fixture.previousOwner, descendant, fixture.state)).toBeNull();
        expect(fixture.document.documentElement.outerHTML).toBe(html);
    });
});
