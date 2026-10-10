import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTranslationLayoutMeasurements} from '@/src/core/translation/layoutMeasurements';
import {hasActiveTranslationLineClamp, hasTranslationHeightOverflow, isTranslationHeightBoundary, translationHeightStyleOverrides, translationTruncationStyleOverrides} from '@/src/core/translation/serialization';
import {acquireTranslationLayoutOverride, beginTranslation, createTranslationTruncationLayoutBatch, ensureTranslationTruncationLayout,
    markTranslationComplete, restoreAllTranslations, restoreTranslation, setBilingualContent} from '@/src/features/full-page-translation/content/state';

afterEach(() => restoreAllTranslations());

const style = (overrides: object = {}) => ({position: 'static', transform: 'none', display: 'block',
    overflow: 'visible', overflowY: 'visible', height: '100px', maxHeight: 'none', webkitLineClamp: 'none',
    getPropertyValue: vi.fn(() => ''), ...overrides});
const rect = (bottom = 100) => ({top: 0, bottom} as DOMRect);

describe('synchronous translation layout measurements', () => {
    it('同轮冻结样式并缓存 CSS 属性与几何，显式失效后读取宿主最新布局', () => {
        const {document, window} = parseHTML('<html><body><p>Source.</p></body></html>');
        const owner = document.querySelector('p')!;
        const live = style();
        const readStyle = vi.fn(() => live);
        const readRect = vi.fn(() => rect());
        Object.defineProperty(window, 'getComputedStyle', {value: readStyle, configurable: true});
        owner.getBoundingClientRect = readRect;
        const measurements = createTranslationLayoutMeasurements();
        const first = measurements.style(owner)!;
        expect(first.height).toBe('100px');
        expect(measurements.style(owner)).toBe(first);
        first.getPropertyValue('line-clamp');
        first.getPropertyValue('line-clamp');
        expect(live.getPropertyValue).toHaveBeenCalledTimes(1);
        expect(measurements.rect(owner)).toBe(measurements.rect(owner));
        expect(readRect).toHaveBeenCalledTimes(1);
        live.height = '200px';
        expect(first.height).toBe('100px');
        measurements.invalidate();
        expect(measurements.style(owner)?.height).toBe('200px');
        expect(measurements.rect(owner)?.bottom).toBe(100);
        expect(readStyle).toHaveBeenCalledTimes(2);
        expect(readRect).toHaveBeenCalledTimes(2);
    });

    it('布局 API 失败也只探测一次，失效后允许恢复', () => {
        const {document, window} = parseHTML('<html><body><p>Source.</p></body></html>');
        const owner = document.querySelector('p')!;
        const readStyle = vi.fn().mockImplementationOnce(() => {throw new Error('No style');}).mockReturnValue(style());
        const readRect = vi.fn().mockImplementationOnce(() => {throw new Error('No rect');}).mockReturnValue(rect());
        Object.defineProperty(window, 'getComputedStyle', {value: readStyle, configurable: true});
        owner.getBoundingClientRect = readRect;
        const measurements = createTranslationLayoutMeasurements();
        expect(measurements.style(owner)).toBeUndefined();
        expect(measurements.style(owner)).toBeUndefined();
        expect(measurements.rect(owner)).toBeUndefined();
        expect(measurements.rect(owner)).toBeUndefined();
        expect(readStyle).toHaveBeenCalledTimes(1);
        expect(readRect).toHaveBeenCalledTimes(1);
        measurements.invalidate();
        expect(measurements.style(owner)).toBeDefined();
        expect(measurements.rect(owner)).toBeDefined();
        expect(createTranslationLayoutMeasurements().style({} as HTMLElement)).toBeUndefined();
        expect(createTranslationLayoutMeasurements().style({ownerDocument: {}} as HTMLElement)).toBeUndefined();
        Object.defineProperty(window, 'getComputedStyle', {value: () => undefined, configurable: true});
        expect(createTranslationLayoutMeasurements().style(owner)).toBeUndefined();
    });

    it('未知几何不能据此扩大容器', () => {
        const {document, window} = parseHTML('<html><body><main><p>Source.</p></main></body></html>');
        Object.defineProperty(window, 'getComputedStyle', {value: () => style(), configurable: true});
        const owner = document.querySelector('p')!;
        const main = document.querySelector('main')!;
        main.getBoundingClientRect = () => rect();
        owner.getBoundingClientRect = () => {throw new Error('No rect');};
        expect(hasTranslationHeightOverflow(main, owner, createTranslationLayoutMeasurements())).toBe(false);
        main.getBoundingClientRect = () => {throw new Error('No rect');};
        expect(hasTranslationHeightOverflow(main, owner, createTranslationLayoutMeasurements())).toBe(false);
    });

    it('计算样式属性读取失败时不解除未知 line-clamp', () => {
        const {document, window} = parseHTML('<html><body><p>Source.</p></body></html>');
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: () => {
            const live = style();
            Object.defineProperty(live, 'webkitLineClamp', {get() {throw new Error('Unreadable property');}});
            return live;
        }});
        const owner = document.querySelector('p')!;
        expect(hasActiveTranslationLineClamp(owner)).toBe(false);
        expect(hasActiveTranslationLineClamp(owner, createTranslationLayoutMeasurements())).toBe(false);
    });

    it('500 段同批布局复核只读取一次共享 main 的 transform，逐项调用不跨轮保留读数', () => {
        const {document, window} = parseHTML('<html><body><main></main></body></html>');
        const main = document.querySelector('main')!;
        let mainTransformReads = 0;
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => {
            const live = style();
            Object.defineProperty(live, 'transform', {get() {if (element === main) mainTransformReads += 1; return 'none';}});
            return live;
        }});
        const owners: HTMLElement[] = [];
        main.getBoundingClientRect = () => rect();
        for (let index = 0; index < 500; index += 1) {
            const owner = document.createElement('p');
            owner.textContent = `Source ${index}.`;
            owner.getBoundingClientRect = () => rect();
            main.appendChild(owner);
            const attempt = beginTranslation(owner, 'bilingual', 'content', false, owner.textContent, [])!;
            expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
            const wrapper = document.createElement('span');
            wrapper.className = 'fluent-read-bilingual-content';
            wrapper.setAttribute('data-fr-translation-owned', 'true');
            wrapper.textContent = '译文';
            owner.appendChild(wrapper);
            setBilingualContent(owner, wrapper);
            owners.push(owner);
        }
        mainTransformReads = 0;
        owners.forEach(owner => expect(ensureTranslationTruncationLayout(owner)).toBe(true));
        expect(mainTransformReads).toBeGreaterThanOrEqual(500);
        mainTransformReads = 0;
        const reconcile = createTranslationTruncationLayoutBatch();
        owners.forEach(owner => expect(reconcile(owner)).toBe(true));
        expect(mainTransformReads).toBe(1);
    });

    it('500 段加入已生效共享租约时复用读数，宿主新增定位仍撤销高度并保留原文', () => {
        const {document, window} = parseHTML('<html><body><main style="height:20px;max-height:20px;overflow:hidden"></main></body></html>');
        const main = document.querySelector('main')!;
        const originalStyle = main.getAttribute('style');
        const transform = vi.fn(() => 'none');
        const restore = installStyle(window, element => {
            const inline = (element as HTMLElement).style;
            return {...style({
                position: inline.position || 'static',
                height: inline.height || '100px',
                maxHeight: inline.getPropertyValue('max-height') || 'none',
                overflowY: inline.overflow || 'visible',
                getPropertyValue: (name: string) => inline.getPropertyValue(name) || '',
            }), get transform() {return element === main ? transform() : 'none';}};
        });
        const owners = Array.from({length: 500}, (_, index) => {
            const owner = document.createElement('p');
            owner.textContent = `Source ${index}.`;
            owner.getBoundingClientRect = () => rect();
            main.append(owner);
            const source = owner.firstChild;
            const attempt = beginTranslation(owner, 'bilingual', 'content', false, owner.textContent, [])!;
            expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
            const wrapper = document.createElement('span');
            wrapper.className = 'fluent-read-bilingual-content';
            wrapper.setAttribute('data-fr-translation-owned', 'true');
            wrapper.textContent = '译文';
            owner.append(wrapper);
            setBilingualContent(owner, wrapper);
            return {owner, source};
        });
        main.getBoundingClientRect = () => rect();
        try {
            expect(acquireTranslationLayoutOverride(owners[0].owner, main,
                [...translationTruncationStyleOverrides, ...translationHeightStyleOverrides])).toBe(true);
            transform.mockClear();
            const reconcile = createTranslationTruncationLayoutBatch();
            owners.forEach(({owner}) => expect(reconcile(owner)).toBe(true));
            expect(transform).toHaveBeenCalledTimes(1);
            expect(main.style.height).toBe('auto');
            // 已缓存祖先随后被宿主改为定位边界；加入租约不能掩盖这个写入。
            main.style.position = 'fixed';
            main.style.color = 'red';
            expect(reconcile(owners[1].owner)).toBe(true);
            expect(main.style.height).toBe('20px');
            expect(main.style.getPropertyValue('max-height')).toBe('unset');
            owners.forEach(({owner, source}, index) => {
                expect(owner.firstChild).toBe(source);
                expect(restoreTranslation(owner)).toBe(true);
                expect(owner.textContent).toBe(`Source ${index}.`);
            });
            expect(main.style.position).toBe('fixed');
            expect(main.style.color).toBe('red');
            expect(main.style.height).toBe('20px');
            expect(main.style.getPropertyValue('max-height')).toBe('20px');
            expect(main.style.overflow).toBe('hidden');
            expect(originalStyle).toContain('height:20px');
        } finally {restore();}
    });

    it('同批解除共享裁剪后立即废弃旧样式，恢复兄弟段落仍沿用首个租约基线', () => {
        const {document, window} = parseHTML('<html><body><main style="-webkit-line-clamp:2;max-height:20px;overflow:hidden"><p>First source.</p><p>Second source.</p></main></body></html>');
        const main = document.querySelector('main')!;
        const originalStyle = main.getAttribute('style');
        let mainReads = 0;
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => {
            if (element === main) mainReads += 1;
            return style({height: element.style.height || '100px', overflowY: element.style.overflow || 'visible',
                maxHeight: element.style.maxHeight || 'none', webkitLineClamp: element.style.getPropertyValue('-webkit-line-clamp') || 'none',
                getPropertyValue: (name: string) => element.style.getPropertyValue(name) || '',
            });
        }});
        const owners = Array.from(document.querySelectorAll<HTMLElement>('p'));
        [main, ...owners].forEach(owner => {owner.getBoundingClientRect = () => rect();});
        owners.forEach(owner => {
            const attempt = beginTranslation(owner, 'bilingual', 'content', false, owner.textContent!, [])!;
            expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
            const wrapper = document.createElement('span');
            wrapper.className = 'fluent-read-bilingual-content';
            wrapper.setAttribute('data-fr-translation-owned', 'true');
            wrapper.textContent = '译文';
            owner.appendChild(wrapper);
            setBilingualContent(owner, wrapper);
        });
        mainReads = 0;
        const reconcile = createTranslationTruncationLayoutBatch();
        owners.forEach(owner => expect(reconcile(owner)).toBe(true));
        expect(mainReads).toBeGreaterThan(1);
        expect(main.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
        restoreTranslation(owners[0]!);
        expect(main.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
        restoreTranslation(owners[1]!);
        expect(main.getAttribute('style')).toBe(originalStyle);
    });

    it('断开的最后租户在新 owner 接管时释放后，当轮重新解除恢复的裁剪', () => {
        const {document, window} = parseHTML('<html><body><main style="max-height:20px;overflow:hidden"><p>Same source.</p></main></body></html>');
        const main = document.querySelector('main')!;
        const originalStyle = main.getAttribute('style');
        const oldOwner = document.querySelector('p')!;
        const restore = installStyle(window, element => style({
            maxHeight: element === main ? main.style.getPropertyValue('max-height') : 'none',
            overflowY: element === main ? main.style.getPropertyValue('overflow') : 'visible',
        }));
        main.getBoundingClientRect = () => rect(main.style.getPropertyValue('max-height') === '20px' ? 20 : 80);
        Object.defineProperties(main, {
            clientHeight: {get: () => main.style.getPropertyValue('max-height') === '20px' ? 20 : 80},
            scrollHeight: {value: 80},
        });
        const translate = (owner: HTMLElement) => {
            owner.getBoundingClientRect = () => rect(80);
            const source = owner.firstChild;
            const attempt = beginTranslation(owner, 'bilingual', 'content', false, owner.textContent!, [])!;
            expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
            const wrapper = document.createElement('span');
            wrapper.className = 'fluent-read-bilingual-content';
            wrapper.setAttribute('data-fr-translation-owned', 'true');
            wrapper.textContent = '译文';
            owner.append(wrapper);
            setBilingualContent(owner, wrapper);
            return {attempt, source};
        };
        try {
            const previous = translate(oldOwner);
            expect(ensureTranslationTruncationLayout(oldOwner)).toBe(true);
            expect(main.style.getPropertyValue('max-height')).toBe('unset');
            const replacement = document.createElement('p');
            replacement.textContent = 'Same source.';
            oldOwner.replaceWith(replacement);
            const current = translate(replacement);
            expect(ensureTranslationTruncationLayout(replacement)).toBe(true);
            expect(main.style.getPropertyValue('max-height')).toBe('unset');
            expect(previous.attempt.state.controller.signal.aborted).toBe(true);
            expect(replacement.firstChild).toBe(current.source);
            expect(restoreTranslation(replacement)).toBe(true);
            expect(main.getAttribute('style')).toBe(originalStyle);
            expect(replacement.textContent).toBe('Same source.');
        } finally { restore(); }
    });

    it('同批移走唯一租户恢复旧祖先样式后，后续兄弟读取因 CSS 依赖改变的新裁剪', () => {
        const {document, window} = parseHTML('<html><body><div id="leased" style="height:10px"><p id="moved">Moving source.</p></div><div id="destination"></div><main><p id="first">First source.</p><p id="second">Second source.</p></main></body></html>');
        const leased = document.getElementById('leased')!;
        const destination = document.getElementById('destination')!;
        const main = document.querySelector('main')!;
        const owners = ['moved', 'first', 'second'].map(id => document.getElementById(id)!);
        const sourceNodes = owners.map(owner => owner.firstChild);
        const restore = installStyle(window, element => style({
            height: element === main && leased.style.height !== 'auto' ? '20px' : '100px',
            maxHeight: element === main ? main.style.getPropertyValue('max-height') ||
                (leased.style.height === 'auto' ? 'none' : '20px') : 'none',
            overflowY: element === main ? 'hidden' : 'visible',
        }));
        [leased, destination, main, ...owners].forEach(element => {
            element.getBoundingClientRect = () => rect(element === main && leased.style.height !== 'auto' ? 20 : 100);
            Object.defineProperties(element, {
                clientHeight: {get: () => element === main && leased.style.height !== 'auto' ? 20 : 100},
                scrollHeight: {value: 100},
            });
        });
        try {
            owners.forEach(owner => {
                const attempt = beginTranslation(owner, 'bilingual', 'content', false, owner.textContent!, [])!;
                expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
                const wrapper = document.createElement('span');
                wrapper.className = 'fluent-read-bilingual-content';
                wrapper.setAttribute('data-fr-translation-owned', 'true');
                wrapper.textContent = '译文';
                owner.append(wrapper);
                setBilingualContent(owner, wrapper);
            });
            expect(acquireTranslationLayoutOverride(owners[0], leased, translationHeightStyleOverrides)).toBe(true);
            destination.append(owners[0]); // 宿主写入在整个读批次开始前完成。
            const reconcile = createTranslationTruncationLayoutBatch();
            expect(reconcile(owners[1])).toBe(true); // 此时缓存 main 未裁剪的读数。
            expect(reconcile(owners[0])).toBe(true); // 释放最后一个旧祖先租约。
            expect(leased.style.height).toBe('10px');
            expect(reconcile(owners[2])).toBe(true);
            expect(main.style.getPropertyValue('max-height')).toBe('unset');
            expect(owners.map(owner => owner.firstChild)).toEqual(sourceNodes);
        } finally { restore(); }
    });
});

function installStyle(window: Window, read: (element: Element) => object): () => void {
    const previous = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');
    Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: read});
    return () => {
        if (previous) Object.defineProperty(window, 'getComputedStyle', previous);
        else Reflect.deleteProperty(window, 'getComputedStyle');
    };
}

describe('同步布局测量字段的冻结与失效', () => {
    it.each(['none', '', undefined])('transform 首次读数 %s 在同轮保持不变，失效后读取宿主新变换', initial => {
        const {document, window} = parseHTML('<html><body><p>Readable source.</p></body></html>');
        const owner = document.querySelector<HTMLElement>('p')!;
        let current = initial;
        const transform = vi.fn(() => current);
        const restore = installStyle(window, () => ({get transform() { return transform(); }}));
        try {
            const measurements = createTranslationLayoutMeasurements();
            const first = measurements.style(owner)!;
            expect(first.transform).toBe(initial);
            current = 'matrix(1, 0, 0, 1, 0, 20)';
            expect(measurements.style(owner)!.transform).toBe(initial);
            expect(transform).toHaveBeenCalledTimes(1);
            measurements.invalidate();
            expect(measurements.style(owner)!.transform).toBe(current);
            expect(transform).toHaveBeenCalledTimes(2);
        } finally { restore(); }
    });

    it('transform 读取抛错不登记快照，布局 API 恢复后同轮可重新读取', () => {
        const {document, window} = parseHTML('<html><body><p>Readable source.</p></body></html>');
        const owner = document.querySelector<HTMLElement>('p')!;
        const transform = vi.fn().mockImplementationOnce(() => {throw new Error('Unreadable transform');})
            .mockReturnValue('none');
        const restore = installStyle(window, () => ({get transform() { return transform(); }}));
        try {
            const first = createTranslationLayoutMeasurements().style(owner)!;
            expect(() => first.transform).toThrow('Unreadable transform');
            expect(first.transform).toBe('none');
            expect(first.transform).toBe('none');
            expect(transform).toHaveBeenCalledTimes(2);
        } finally { restore(); }
    });

    it('边界预检查不读取无关高度/矩形，字段按需冻结且失效后取得新值', () => {
        const {document, window} = parseHTML('<html><body><p>Readable source.</p></body></html>');
        const owner = document.querySelector<HTMLElement>('p')!;
        let currentHeight = '100px';
        const height = vi.fn(() => currentHeight);
        const transform = vi.fn(() => 'none');
        const rectangle = vi.fn(() => ({top: 0, bottom: 100} as DOMRect));
        owner.getBoundingClientRect = rectangle;
        const restore = installStyle(window, () => ({
            position: 'static', get transform() { return transform(); },
            overflow: 'visible', overflowY: 'visible', display: 'block',
            maxHeight: 'none', webkitLineClamp: 'none',
            get height() { return height(); }, getPropertyValue: () => '',
        }));
        try {
            const measurements = createTranslationLayoutMeasurements();
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(false);
            expect(height).not.toHaveBeenCalled();
            expect(rectangle).not.toHaveBeenCalled();
            const first = measurements.style(owner)!;
            expect(first.height).toBe('100px');
            currentHeight = '200px'; // 只改变测试读数；DOM 变化必须先 invalidate。
            expect(first.height).toBe('100px');
            expect(height).toHaveBeenCalledTimes(1);
            expect(transform).toHaveBeenCalledTimes(1);
            measurements.invalidate();
            expect(measurements.style(owner)?.height).toBe('200px');
            expect(height).toHaveBeenCalledTimes(2);
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(false);
            expect(transform).toHaveBeenCalledTimes(2);
        } finally { restore(); }
    });

    it('空字段按需缓存，重复边界判定不重读宿主', () => {
        const {document, window} = parseHTML('<html><body><p>Readable source.</p></body></html>');
        const owner = document.querySelector<HTMLElement>('p')!;
        const empty = vi.fn(() => '');
        const restore = installStyle(window, () => ({
            get position() { return empty(); }, transform: 'none',
            overflow: 'visible', overflowY: 'visible', display: 'block',
            maxHeight: 'none', webkitLineClamp: 'none', height: '100px',
            getPropertyValue: vi.fn(() => ''),
        }));
        try {
            const measurements = createTranslationLayoutMeasurements();
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(false);
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(false);
            expect(empty).toHaveBeenCalledTimes(1);
        } finally { restore(); }
    });

    it.each([['translate', '0px 40px'], ['rotate', '45deg'], ['scale', '2']])(
        '%s 独立变换阻止把视觉溢出当成祖先自然流高度溢出', (property, value) => {
            const {document, window} = parseHTML('<html><body><main><p>Source.</p></main></body></html>');
            const main = document.querySelector('main')!;
            const owner = document.querySelector('p')!;
            main.getBoundingClientRect = () => rect(20);
            owner.getBoundingClientRect = () => rect(80);
            let liveValue = value;
            Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: Element) =>
                style({translate: 'none', rotate: 'none', scale: 'none',
                    ...(element === owner ? {[property]: liveValue} : {})})});
            const measurements = createTranslationLayoutMeasurements();
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(true);
            expect(hasTranslationHeightOverflow(main, owner, measurements)).toBe(false);
            expect(hasTranslationHeightOverflow(owner, owner, measurements)).toBe(false);
            liveValue = 'none';
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(true);
            measurements.invalidate();
            expect(isTranslationHeightBoundary(owner, measurements)).toBe(false);
            expect(hasTranslationHeightOverflow(main, owner, measurements)).toBe(true);
        },
    );

    it.each(['absolute', 'fixed', 'sticky'])('已知 %s 边界不读取会强制布局的 transform', position => {
        const {document, window} = parseHTML('<html><body><p>Source.</p></body></html>');
        const owner = document.querySelector('p')!;
        const transform = vi.fn(() => 'none');
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: () => ({
            ...style({position}), get transform() {return transform();},
        })});
        expect(isTranslationHeightBoundary(owner, createTranslationLayoutMeasurements())).toBe(true);
        expect(transform).not.toHaveBeenCalled();
    });

    it.each(['', 'none'])('独立变换默认值 %s 保持自然流溢出判断', value => {
        const {document, window} = parseHTML('<html><body><main><p>Source.</p></main></body></html>');
        const main = document.querySelector('main')!;
        const owner = document.querySelector('p')!;
        main.getBoundingClientRect = () => rect(20);
        owner.getBoundingClientRect = () => rect(80);
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: () =>
            style({translate: value, rotate: value, scale: value})});
        const measurements = createTranslationLayoutMeasurements();
        expect(isTranslationHeightBoundary(owner, measurements)).toBe(false);
        expect(hasTranslationHeightOverflow(main, owner, measurements)).toBe(true);
    });

});
