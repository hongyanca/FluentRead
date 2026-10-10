import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {DEFAULT_TRANSLATION_APPEARANCE} from '@/src/core/config/translationAppearance';
import {syncTranslationAppearanceStyles, TRANSLATION_APPEARANCE_STYLE_ID} from '@/src/app/content/translationAppearance';

function createDocument(markup = '<!doctype html><html><head></head><body><p>Source</p></body></html>'): Document {
    return parseHTML(markup).document as unknown as Document;
}

describe('网页译文外观样式同步', () => {
    it('自定义外观只安装一个样式节点，相同内容不重复写入，变化时原位更新', () => {
        const document = createDocument();
        syncTranslationAppearanceStyles(document, {lineColor: '#ef4776'});
        const style = document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)!;
        expect(style.parentNode).toBe(document.head);
        expect(style.textContent).toContain('--fluent-read-translation-line: #ef4776 !important;');

        let writes = 0;
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(style), 'textContent')
            ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(style)), 'textContent');
        Object.defineProperty(style, 'textContent', {
            configurable: true,
            get: () => descriptor!.get!.call(style),
            set: (value: string) => { writes += 1; descriptor!.set!.call(style, value); },
        });
        syncTranslationAppearanceStyles(document, {lineColor: '#EF4776'});
        expect(writes).toBe(0);

        syncTranslationAppearanceStyles(document, {lineColor: '#ef4776', textColor: '#1d4ed8'});
        expect(writes).toBe(1);
        expect(document.querySelectorAll(`#${TRANSLATION_APPEARANCE_STYLE_ID}`)).toHaveLength(1);
        expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)).toBe(style);
        expect(style.textContent).toContain('color: #1d4ed8 !important;');
        syncTranslationAppearanceStyles(document, {backgroundColor: 'rgb(255, 248, 204)', fontScale: 117});
        expect(style.textContent).toContain('background: #fff8cc !important;');
        expect(style.textContent).toContain('font-size: 117% !important;');
    });

    it('默认外观或页面功能停用时移除样式节点，空文档安全跳过', () => {
        const document = createDocument();
        syncTranslationAppearanceStyles(document, {opacity: 80});
        expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)).not.toBeNull();
        syncTranslationAppearanceStyles(document, {...DEFAULT_TRANSLATION_APPEARANCE});
        expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)).toBeNull();

        syncTranslationAppearanceStyles(document, {fontScale: 120});
        syncTranslationAppearanceStyles(document, null);
        expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)).toBeNull();
        expect(() => syncTranslationAppearanceStyles(document, null)).not.toThrow();
    });

    it('没有 head 的文档把样式挂到根元素，仍由固定标识管理', () => {
        const document = createDocument('<!doctype html><html><head></head><body></body></html>');
        // document_start 阶段或 XML 文档可能没有 head；linkedom 会按需补建，这里显式模拟浏览器返回 null。
        Object.defineProperty(document, 'head', {configurable: true, get: () => null});
        syncTranslationAppearanceStyles(document, {fontWeight: 'bold'});
        const style = document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID);
        expect(style?.parentNode).toBe(document.documentElement);
        expect(style?.textContent).toContain('font-weight: 700 !important;');
    });
});
