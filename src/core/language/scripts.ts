/**
 * @file src/core/language/scripts.ts
 *
 * 文件职责：把识别副本切分为按书写体系归属的字母词段，并给出文字层面的直接语言证据。
 * 主要内容：用 Unicode Script 属性统计 Latin、Cyrillic、Greek、Hebrew、Arabic、印度诸文字、Thai、Hangul、假名与汉字等词段，把长音符并入假名、组合符号并入所在词段；定义只由单一目录语言使用的文字（希腊文、希伯来文、泰文、孟加拉文等）及其少数民族/古典变体反证（意第绪连字、阿萨姆字母、多调希腊文）。可核对的公开符号包括 segmentScriptWords、ScriptWord、WritingScript、SCRIPT_UNIQUE_LANGUAGES、hasScriptUniqueVeto。
 * 模块边界：本文件属于 core 纯算法，只做字符分类，不调用统计检测、不决定中日韩文本语言、不访问配置或浏览器。
 */

export type WritingScript =
    | 'Latin' | 'Cyrillic' | 'Greek' | 'Armenian' | 'Georgian' | 'Hebrew' | 'Arabic' | 'Thaana' | 'Devanagari'
    | 'Bengali' | 'Gurmukhi' | 'Gujarati' | 'Oriya' | 'Tamil' | 'Telugu' | 'Kannada' | 'Malayalam' | 'Sinhala'
    | 'Thai' | 'Lao' | 'Tibetan' | 'Myanmar' | 'Khmer' | 'Ethiopic' | 'Hangul' | 'Kana' | 'Han' | 'Other';

export interface ScriptWord {
    script: WritingScript;
    text: string;
    /** 字母或所在文字组合符号的数量；组合符号计入文字但不单独成词。 */
    letters: number;
    start: number;
    end: number;
}

const SCRIPT_PATTERNS: ReadonlyArray<readonly [WritingScript, RegExp]> = [
    ['Latin', /\p{Script=Latin}/u],
    ['Han', /\p{Script=Han}/u],
    ['Kana', /[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]/u],
    ['Hangul', /\p{Script=Hangul}/u],
    ['Cyrillic', /\p{Script=Cyrillic}/u],
    ['Arabic', /\p{Script=Arabic}/u],
    ['Devanagari', /\p{Script=Devanagari}/u],
    ['Greek', /\p{Script=Greek}/u],
    ['Hebrew', /\p{Script=Hebrew}/u],
    ['Thai', /\p{Script=Thai}/u],
    ['Bengali', /\p{Script=Bengali}/u],
    ['Tamil', /\p{Script=Tamil}/u],
    ['Telugu', /\p{Script=Telugu}/u],
    ['Gujarati', /\p{Script=Gujarati}/u],
    ['Kannada', /\p{Script=Kannada}/u],
    ['Malayalam', /\p{Script=Malayalam}/u],
    ['Gurmukhi', /\p{Script=Gurmukhi}/u],
    ['Sinhala', /\p{Script=Sinhala}/u],
    ['Oriya', /\p{Script=Oriya}/u],
    ['Armenian', /\p{Script=Armenian}/u],
    ['Georgian', /\p{Script=Georgian}/u],
    ['Thaana', /\p{Script=Thaana}/u],
    ['Lao', /\p{Script=Lao}/u],
    ['Tibetan', /\p{Script=Tibetan}/u],
    ['Myanmar', /\p{Script=Myanmar}/u],
    ['Khmer', /\p{Script=Khmer}/u],
    ['Ethiopic', /\p{Script=Ethiopic}/u],
];

// 字母、所在文字的组合符号，以及 Arabic/Indic 文本中必需的零宽连接符。
const WORD_CHARACTER_PATTERN = /[\p{L}\p{M}‌‍]/u;
const LETTER_PATTERN = /[\p{L}\p{M}]/u;

function scriptOf(character: string): WritingScript | undefined {
    if (!LETTER_PATTERN.test(character)) return undefined;
    for (const [script, pattern] of SCRIPT_PATTERNS) {
        if (pattern.test(character)) return script;
    }
    return /\p{M}/u.test(character) ? undefined : 'Other';
}

/**
 * 按文字切词：遇到非字母或文字变化即断开；Latin 词内部的撇号保留（aujourd'hui、don't），
 * 继承型组合符号附着在前一个字母上。汉字、假名和谚文按连续字符成段，由调用方计数。
 */
export function segmentScriptWords(value: string): ScriptWord[] {
    const words: ScriptWord[] = [];
    let current: ScriptWord | undefined;
    let offset = 0;
    const characters = [...value];
    characters.forEach((character, index) => {
        const start = offset;
        offset += character.length;
        const script = scriptOf(character);
        const apostropheInsideLatin = current?.script === 'Latin' && /['’]/u.test(character)
            && scriptOf(characters[index + 1] ?? '') === 'Latin';
        if (apostropheInsideLatin) {
            current!.text += character;
            current!.end = offset;
            return;
        }
        if (!script) {
            // 组合符号和零宽连接符归入前一个词；其他分隔符结束当前词。
            if (current && WORD_CHARACTER_PATTERN.test(character)) {
                current.text += character;
                current.end = offset;
                if (/\p{M}/u.test(character)) current.letters += 1;
                return;
            }
            current = undefined;
            return;
        }
        if (current && current.script === script) {
            current.text += character;
            current.letters += 1;
            current.end = offset;
            return;
        }
        current = {script, text: character, letters: 1, start, end: offset};
        words.push(current);
    });
    return words;
}

/** 在语言目录范围内只由一种语言使用的文字；Myanmar、Ethiopic、Tibetan 承载多种语言，不在此列。 */
export const SCRIPT_UNIQUE_LANGUAGES: Readonly<Partial<Record<WritingScript, string>>> = {
    Greek: 'el', Hebrew: 'he', Thai: 'th', Bengali: 'bn', Gurmukhi: 'pa', Gujarati: 'gu', Oriya: 'or',
    Tamil: 'ta', Telugu: 'te', Kannada: 'kn', Malayalam: 'ml', Sinhala: 'si', Armenian: 'hy', Georgian: 'ka',
    Thaana: 'dv', Lao: 'lo', Khmer: 'km',
};

// 意第绪文连字、阿萨姆文专属字母和多调希腊文不能被当作现代希伯来文、孟加拉文或希腊文。
const SCRIPT_UNIQUE_VETOES: Readonly<Partial<Record<WritingScript, RegExp>>> = {
    Hebrew: /[װ-ײ]|ײַ/u,
    Bengali: /[ৰৱ]/u,
    Greek: /[ἀ-῿]/u,
};

export function hasScriptUniqueVeto(script: WritingScript, text: string): boolean {
    return SCRIPT_UNIQUE_VETOES[script]?.test(text) === true;
}
