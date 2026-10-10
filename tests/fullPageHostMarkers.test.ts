import {describe, expect, it} from 'vitest';
import {parseHTML} from 'linkedom';
import {
    TRANSLATION_FAILED_ATTRIBUTE,
    clearLegacyHostMarkerClasses,
    clearTranslationFailedHost,
    markTranslationFailedHost,
} from '@/src/features/full-page-translation/core/hostMarkers';

function paragraph(html: string): HTMLElement {
    const {document} = parseHTML(`<html><body>${html}</body></html>`);
    return document.querySelector<HTMLElement>('p')!;
}

describe('全文翻译宿主标记', () => {
    it('失败标记只写 data 属性，不创建宿主 class 属性', () => {
        const node = paragraph('<p>Source</p>');

        markTranslationFailedHost(node);

        expect(node.getAttribute(TRANSLATION_FAILED_ATTRIBUTE)).toBe('true');
        expect(node.hasAttribute('class')).toBe(false);
    });

    it('清除失败标记后宿主自身的 class 原样保留', () => {
        const node = paragraph('<p class="host lead">Source</p>');

        markTranslationFailedHost(node);
        clearTranslationFailedHost(node);

        expect(node.hasAttribute(TRANSLATION_FAILED_ATTRIBUTE)).toBe(false);
        expect(node.getAttribute('class')).toBe('host lead');
    });

    it('历史 class 标记被清空后连空 class 属性一起移除', () => {
        const node = paragraph('<p class="fluent-read-bilingual fluent-read-failure">Source</p>');

        clearLegacyHostMarkerClasses(node);

        expect(node.hasAttribute('class')).toBe(false);
    });

    it('宿主没有 class 属性时不写入 class', () => {
        const node = paragraph('<p>Source</p>');

        clearLegacyHostMarkerClasses(node);

        expect(node.hasAttribute('class')).toBe(false);
    });

    it('宿主自带的空 class 属性不被删除', () => {
        const node = paragraph('<p class="">Source</p>');

        clearLegacyHostMarkerClasses(node);

        expect(node.getAttribute('class')).toBe('');
    });
});
