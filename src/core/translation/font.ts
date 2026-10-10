/**
 * @file src/core/translation/font.ts
 *
 * 文件职责：为译文节点解析目标书写体系所需的字体族，避免原文字体只覆盖部分目标字形时，同一段译文出现粗细与字形不一致。
 * 主要内容：detectTranslationTextScript 依据假名、谚文与简繁字形证据保守识别原文书写体系；resolveTargetTranslationScript 读取目标语言明确声明的 CJK 书写体系；resolveTranslationFontFamily 只在原文与译文分属不同 CJK 书写体系时，把目标字体族前置到宿主字体栈，其余情况一律返回 undefined 以保持网页原有排版。 可核对的公开符号包括 TranslationScript、CJK_TRANSLATION_FONT_STACKS、detectTranslationTextScript、resolveTargetTranslationScript、resolveTranslationFontFamily。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不读取计算样式、不访问配置存储、不发起网络请求、不触碰 DOM，宿主字体栈由渲染层读取后作为参数传入。
 */

import {getChineseScript} from '@/src/core/language/chinese';
import {detectChineseScript} from '@/src/core/language/detect';

/** 需要区分字体的 CJK 书写体系；拉丁等共享字形的书写体系不参与判断。 */
export type TranslationScript = 'Hans' | 'Hant' | 'Jpan' | 'Kore';

/**
 * 目标书写体系的首选字体族。日文字体只覆盖部分简体字形，简体字体也缺少日文
 * 专用字形，浏览器逐字回退时会在同一行混用不同字重与字形（Issue #47）。
 * 这里只提供目标书写体系的字体，宿主原有字体栈仍追加在后面承接其余字符。
 */
export const CJK_TRANSLATION_FONT_STACKS: Readonly<Record<TranslationScript, string>> = Object.freeze({
    Hans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC"',
    Hant: '"PingFang TC", "Hiragino Sans CNS", "Microsoft JhengHei", "Noto Sans CJK TC", "Source Han Sans TC"',
    Jpan: '"Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Source Han Sans JP"',
    Kore: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Source Han Sans KR"',
});

const KANA_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL_PATTERN = /\p{Script=Hangul}/u;

/**
 * 假名与谚文是日文、韩文的确定证据；只有汉字时交给保守的简繁判定，
 * 无法确认的文本返回 undefined，调用方据此保留网页原有字体。
 */
export function detectTranslationTextScript(text: string): TranslationScript | undefined {
    if (KANA_PATTERN.test(text)) return 'Jpan';
    if (HANGUL_PATTERN.test(text)) return 'Kore';
    return detectChineseScript(text);
}

/** 目标语言只在明确声明书写体系时参与判断，auto 与拉丁语言一律返回 undefined。 */
export function resolveTargetTranslationScript(language: string): TranslationScript | undefined {
    const chinese = getChineseScript(language);
    if (chinese) return chinese;
    const base = language.trim().replace(/_/gu, '-').toLowerCase().split('-')[0]!;
    if (base === 'ja') return 'Jpan';
    if (base === 'ko') return 'Kore';
    return undefined;
}

/**
 * 仅在原文与译文分属不同 CJK 书写体系时改写字体：此时宿主字体按源语言挑选，
 * 无法完整覆盖译文字形。返回值把目标字体族前置到宿主字体栈，拉丁字母、符号
 * 与图标仍由网页原有字体承接；任一侧书写体系不明确就返回 undefined，不改排版。
 */
export function resolveTranslationFontFamily(
    sourceText: string,
    targetLanguage: string,
    inheritedFontFamily = '',
): string | undefined {
    const target = resolveTargetTranslationScript(targetLanguage);
    if (!target) return undefined;
    const source = detectTranslationTextScript(sourceText);
    if (!source || source === target) return undefined;

    const inherited = inheritedFontFamily.trim().replace(/[\s,]+$/u, '');
    const stack = CJK_TRANSLATION_FONT_STACKS[target];
    return inherited ? `${stack}, ${inherited}` : `${stack}, sans-serif`;
}
