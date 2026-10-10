import {describe, expect, it} from 'vitest';
import {hasDistinctTranslation, hasTranslationContent} from '@/src/core/translation/result';
import {parseDocument, renderDocument} from '@/src/features/document-translation/core/document';
import {createDocumentPreviewHtml} from '@/src/features/document-translation/core/preview';
import {parseHTML} from 'linkedom';

describe('相同译文只保留原文', () => {
    it.each([
        ['', false], [' \n\t\u3000', false], ['\u200b', false], [' \u200b\t\u200b', false],
        ['\u200c', true], ['\u200d', true], ['+', true], ['=', true], ['0', true], ['中文\u200b', true],
    ])('有效内容判定 %j：%s，保留连接符与数学语义', (text, content) => {
        expect(hasTranslationContent(text as string)).toBe(content);
    });
    it.each([
        ['Hello world', 'Hello world', false],
        ['Hello  world', '  Hello\nworld\u3000', false],
        ['Café', 'Cafe\u0301', false],
        ['Amber Meadow', 'Amber Meadow\u200b', false],
        ['原文', '原\u200b文', false],
        ['', '\u200b', false],
        ['a\u200bb', 'a b', true],
        ['原文', '', false],
        ['原文', ' \n ', false],
        ['原文', undefined, false],
        ['原文', '译文', true],
        ['Hello', 'hello', true],
        ['Hello!', 'Hello?', true],
        ['允许清空', '允許清空', true],
        ['a b', 'ab', true],
        ['👩‍💻', '👩💻', true],
        ['می\u200cروم', 'میروم', true],
    ])('比较 %j 和 %j 时是否显示译文：%s', (source, translation, visible) => {
        expect(hasDistinctTranslation(source!, translation)).toBe(visible);
    });

    it.each([
        ['same.txt', 'Hello world'],
        ['same.md', '# Hello world\n\nRead `code` and [the guide](https://example.test).'],
        ['same.html', '<p>Hello &amp; world <strong>again</strong></p>'],
        ['same.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello world\n'],
        ['same.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello world\n'],
        ['same.ass', '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello world'],
        ['same.lrc', '[00:01.00]Hello world\n'],
        ['same.json', '{"title":" Hello world ","count":1}'],
    ])('%s 在双语与仅译文导出时保持原始内容', (filename, source) => {
        const document = parseDocument(filename, source);
        const same = document.segments.map(segment => `  ${segment.source}  `);
        const expected = document.format === 'json' ? JSON.stringify(JSON.parse(source), null, 2) : source;
        expect(renderDocument(document, same, 'bilingual')).toBe(expected);
        expect(renderDocument(document, same, 'translated')).toBe(expected);
        expect(renderDocument(document, [], 'bilingual')).toBe(expected);
    });

    it.each(['txt', 'md', 'html'])('%s 预览保留相同段落，仅为有变化的段落生成译文', extension => {
        const source = extension === 'html' ? '<p>Hello world</p><p>Read every day</p>' : 'Hello world\n\nRead every day';
        const document = parseDocument(`mixed.${extension}`, source);
        const html = createDocumentPreviewHtml(document, ['Hello world', '每天阅读'], 'bilingual');
        const {document: dom} = parseHTML(html);
        expect(dom.body.textContent?.match(/Hello world/g)).toHaveLength(1);
        expect(dom.querySelectorAll('.fluentread-translation, [data-fluent-read-document-translation]')).toHaveLength(1);
        expect(dom.body.textContent).toContain('每天阅读');
        const allSame = createDocumentPreviewHtml(document, document.segments.map(segment => segment.source), 'translated');
        expect(allSame).toContain('Hello world');
        expect(parseHTML(allSame).document.querySelectorAll('.fluentread-translation, [data-fluent-read-document-translation]')).toHaveLength(0);
    });

    it.each([
        ['same.srt', '1\n00:00:01,000 --> 00:00:02,000\n<i>Amber Meadow</i>\n'],
        ['same.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>Amber Meadow</i>\n'],
        ['same.ass', '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}Amber Meadow'],
    ])('%s 仅字幕样式不同也不会重复导出文字', (filename, source) => {
        const document = parseDocument(filename, source);
        expect(renderDocument(document, ['Amber Meadow'], 'bilingual')).toBe(source);
        expect(renderDocument(document, ['Amber Meadow'], 'translated')).toBe(source);
    });
});
