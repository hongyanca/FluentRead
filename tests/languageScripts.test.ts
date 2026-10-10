/**
 * @file tests/languageScripts.test.ts
 * 文字切词与单一语言文字证据：各书写体系归属、组合符号与零宽连接符、Latin 词内撇号、假名长音符、
 * 未知文字，以及希腊文、希伯来文、孟加拉文的古典或相邻语言反证。
 */
import {describe, expect, it} from 'vitest';
import {SCRIPT_UNIQUE_LANGUAGES, hasScriptUniqueVeto, segmentScriptWords} from '@/src/core/language/scripts';
import {translationLanguageOptions} from '@/src/core/language/catalog';

function summary(text: string): Array<[string, string, number]> {
    return segmentScriptWords(text).map(word => [word.script, word.text, word.letters]);
}

describe('按文字切词', () => {
    it.each([
        ['Welcome home', [['Latin', 'Welcome', 7], ['Latin', 'home', 4]]],
        ['Добро пожаловать', [['Cyrillic', 'Добро', 5], ['Cyrillic', 'пожаловать', 10]]],
        ['Καλώς ήρθατε', [['Greek', 'Καλώς', 5], ['Greek', 'ήρθατε', 6]]],
        ['שלום עולם', [['Hebrew', 'שלום', 4], ['Hebrew', 'עולם', 4]]],
        ['مرحبا بكم', [['Arabic', 'مرحبا', 5], ['Arabic', 'بكم', 3]]],
        ['नमस्ते', [['Devanagari', 'नमस्ते', 6]]],
        ['স্বাগতম', [['Bengali', 'স্বাগতম', 7]]],
        ['ਜੀ ਆਇਆਂ', [['Gurmukhi', 'ਜੀ', 2], ['Gurmukhi', 'ਆਇਆਂ', 4]]],
        ['સ્વાગત', [['Gujarati', 'સ્વાગત', 6]]],
        ['வரவேற்பு', [['Tamil', 'வரவேற்பு', 8]]],
        ['స్వాగతం', [['Telugu', 'స్వాగతం', 7]]],
        ['ಸ್ವಾಗತ', [['Kannada', 'ಸ್ವಾಗತ', 6]]],
        ['സ്വാഗതം', [['Malayalam', 'സ്വാഗതം', 7]]],
        ['සාදරයෙන්', [['Sinhala', 'සාදරයෙන්', 8]]],
        ['ยินดีต้อนรับ', [['Thai', 'ยินดีต้อนรับ', 12]]],
        ['ສະບາຍດີ', [['Lao', 'ສະບາຍດີ', 7]]],
        ['សួស្តី', [['Khmer', 'សួស្តី', 6]]],
        ['გამარჯობა', [['Georgian', 'გამარჯობა', 9]]],
        ['Բարեւ', [['Armenian', 'Բարեւ', 5]]],
        ['ދިވެހި', [['Thaana', 'ދިވެހި', 6]]],
        ['မင်္ဂလာပါ', [['Myanmar', 'မင်္ဂလာပါ', 9]]],
        ['ሰላም', [['Ethiopic', 'ሰላም', 3]]],
        ['བཀྲ་ཤིས', [['Tibetan', 'བཀྲ', 3], ['Tibetan', 'ཤིས', 3]]],
        ['中文', [['Han', '中文', 2]]],
        ['カタカナとひらがな', [['Kana', 'カタカナとひらがな', 9]]],
        ['한국어', [['Hangul', '한국어', 3]]],
        ['𓀀𓁐', [['Other', '𓀀𓁐', 2]]],
    ] as const)('%s', (text, expected) => {
        expect(summary(text)).toEqual(expected);
    });

    it('混合文字在文字变化处断词并记录源位置', () => {
        expect(segmentScriptWords('GPT和日本語のAPI').map(({script, text, start, end}) => ({script, text, start, end}))).toEqual([
            {script: 'Latin', text: 'GPT', start: 0, end: 3},
            {script: 'Han', text: '和日本語', start: 3, end: 7},
            {script: 'Kana', text: 'の', start: 7, end: 8},
            {script: 'Latin', text: 'API', start: 8, end: 11},
        ]);
    });

    it('Latin 词内撇号保留，词首词尾撇号和其他文字前的撇号断开', () => {
        expect(summary("aujourd'hui don’t 'quoted' l'été")).toEqual([
            ['Latin', "aujourd'hui", 10], ['Latin', 'don’t', 4], ['Latin', 'quoted', 6], ['Latin', "l'été", 4],
        ]);
        expect(summary("ab'中")).toEqual([['Latin', 'ab', 2], ['Han', '中', 1]]);
        expect(summary("rock'")).toEqual([['Latin', 'rock', 4]]);
    });

    it('继承型组合符号和零宽连接符附着在前一个词上，孤立符号不成词', () => {
        expect(summary('Café')).toEqual([['Latin', 'Café', 5]]);
        expect(summary('می‌کند')).toEqual([['Arabic', 'می‌کند', 5]]);
        expect(summary('́ ‍')).toEqual([]);
    });

    it('长音符 ー 与半角长音符归入假名，数字、标点、表情和空白都是分隔符', () => {
        expect(summary('スーパー ｰ')).toEqual([['Kana', 'スーパー', 4], ['Kana', 'ｰ', 1]]);
        expect(summary('123 🎉，!? \t')).toEqual([]);
    });
});

describe('单一语言文字', () => {
    it('单一语言文字只映射到语言目录或明确的单语言文字', () => {
        const catalog = new Set(translationLanguageOptions.map(option => option.value));
        const uniqueLanguages = Object.values(SCRIPT_UNIQUE_LANGUAGES);
        for (const language of ['el', 'he', 'th', 'bn', 'pa', 'gu', 'ta', 'te', 'kn', 'ml', 'si']) {
            expect(catalog.has(language)).toBe(true);
            expect(uniqueLanguages).toContain(language);
        }
        // 缅文、吉兹文、藏文承载多种语言，不能直接给出结论。
        for (const script of ['Myanmar', 'Ethiopic', 'Tibetan', 'Latin', 'Cyrillic', 'Arabic', 'Devanagari', 'Han'] as const) {
            expect(SCRIPT_UNIQUE_LANGUAGES[script]).toBeUndefined();
        }
    });

    it.each([
        ['Hebrew', 'װאָס מאַכסטו', true], ['Hebrew', 'ײַ', true], ['Hebrew', 'ﬠ', false], ['Hebrew', 'ברוכים הבאים', false],
        ['Bengali', 'অসমীয়া ৰাজ্য', true], ['Bengali', 'বাংলা ভাষা', false],
        ['Greek', 'Ἐν ἀρχῇ', true], ['Greek', 'Καλώς ήρθατε', false],
        ['Thai', 'ภาษาไทย', false],
    ] as const)('%s 反证：%s → %s', (script, text, veto) => {
        expect(hasScriptUniqueVeto(script, text)).toBe(veto);
    });
});
