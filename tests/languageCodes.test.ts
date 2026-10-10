/**
 * @file tests/languageCodes.test.ts
 * 语言标签规范化与比较的单元矩阵：两/三字母代码、ISO 639-2/B、宏语言成员、旧别名、大小写、下划线、
 * 地区、脚本、扩展段、非法值和 auto/und 类取值；中文简繁、检测器裸 zh/cmn 与配置裸 zh 的不对称语义；
 * 目录语言与 franc-min 全部输出的往返稳定性。
 */
import {describe, expect, it} from 'vitest';
import {data as francMinData} from 'franc-min/data.js';
import {translationLanguageOptions} from '@/src/core/language/catalog';
import {
    isLanguageCodeMatch,
    normalizeDetectedLanguageCode,
    normalizeLanguageCode,
    parseLanguageTag,
    resolveChineseScriptFromSubtags,
} from '@/src/core/language/codes';
import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';
import {normalizeExcludedLanguages} from '@/src/core/config/pageTranslation';

const catalogCodes = translationLanguageOptions.map(option => option.value);

describe('语言目录代码', () => {
    it.each(catalogCodes)('目录代码 %s 规范化后保持不变且与自身匹配', code => {
        expect(normalizeLanguageCode(code)).toBe(code);
        expect(normalizeLanguageCode(normalizeLanguageCode(code))).toBe(code);
        expect(isLanguageCodeMatch(code, code)).toBe(true);
    });

    it('目录中的每种语言互不相同，任何两种都不会被合并', () => {
        expect(new Set(catalogCodes.map(code => normalizeLanguageCode(code))).size).toBe(catalogCodes.length);
        for (const left of catalogCodes) {
            for (const right of catalogCodes) {
                if (left !== right) expect(isLanguageCodeMatch(left, right)).toBe(false);
            }
        }
    });
});

describe('两字母、三字母与旧别名', () => {
    it.each([
        ['eng', 'en'], ['fra', 'fr'], ['fre', 'fr'], ['deu', 'de'], ['ger', 'de'], ['spa', 'es'], ['por', 'pt'],
        ['ita', 'it'], ['rus', 'ru'], ['jpn', 'ja'], ['kor', 'ko'], ['ara', 'ar'], ['arb', 'ar'], ['hin', 'hi'],
        ['ben', 'bn'], ['urd', 'ur'], ['fas', 'fa'], ['per', 'fa'], ['pes', 'fa'], ['prs', 'fa'], ['heb', 'he'],
        ['tur', 'tr'], ['vie', 'vi'], ['tha', 'th'], ['ind', 'id'], ['msa', 'ms'], ['may', 'ms'], ['zlm', 'ms'],
        ['zsm', 'ms'], ['nld', 'nl'], ['dut', 'nl'], ['pol', 'pl'], ['ukr', 'uk'], ['ces', 'cs'], ['cze', 'cs'],
        ['slk', 'sk'], ['slo', 'sk'], ['dan', 'da'], ['swe', 'sv'], ['nob', 'nb'], ['nor', 'nb'], ['fin', 'fi'],
        ['ell', 'el'], ['gre', 'el'], ['ron', 'ro'], ['rum', 'ro'], ['mol', 'ro'], ['hun', 'hu'], ['bul', 'bg'],
        ['hrv', 'hr'], ['srp', 'sr'], ['slv', 'sl'], ['est', 'et'], ['ekk', 'et'], ['lav', 'lv'], ['lvs', 'lv'],
        ['lit', 'lt'], ['tam', 'ta'], ['tel', 'te'], ['mar', 'mr'], ['guj', 'gu'], ['kan', 'kn'], ['mal', 'ml'],
        ['pan', 'pa'], ['nep', 'ne'], ['npi', 'ne'], ['sin', 'si'], ['swa', 'sw'], ['swh', 'sw'], ['tgl', 'fil'],
    ])('ISO 639-2/3 代码 %s → %s', (code, expected) => {
        expect(normalizeLanguageCode(code)).toBe(expected);
        expect(normalizeDetectedLanguageCode(code.toUpperCase())).toBe(expected);
        expect(isLanguageCodeMatch(code, expected)).toBe(true);
    });

    it.each([
        ['iw', 'he'], ['in', 'id'], ['ji', 'yi'], ['jw', 'jv'], ['mo', 'ro'], ['tl', 'fil'], ['no', 'nb'],
    ])('已废弃或宏语言别名 %s → %s', (code, expected) => {
        expect(normalizeLanguageCode(code)).toBe(expected);
    });

    it.each(['yue', 'haw', 'nn', 'ceb', 'ilo', 'mai'])('未收录但形状合法的代码 %s 原样保留，不会被合并到相近语言', code => {
        expect(normalizeLanguageCode(code)).toBe(code);
        expect(isLanguageCodeMatch(code, 'zh-Hant')).toBe(false);
    });

    it('相近但不同的语言保持区分：印尼语/马来语、挪威书面语/新挪威语、塞尔维亚语/克罗地亚语/波斯尼亚语', () => {
        expect(isLanguageCodeMatch('ind', 'ms')).toBe(false);
        expect(isLanguageCodeMatch('zlm', 'id')).toBe(false);
        expect(isLanguageCodeMatch('nno', 'nb')).toBe(false);
        expect(isLanguageCodeMatch('hrv', 'sr')).toBe(false);
        expect(isLanguageCodeMatch('bos', 'hr')).toBe(false);
        expect(isLanguageCodeMatch('uk', 'ru')).toBe(false);
    });
});

describe('大小写、下划线、地区、脚本与扩展段', () => {
    it.each([
        [' EN ', 'en'], ['en_US', 'en'], ['EN-gb', 'en'], ['pt-BR', 'pt'], ['pt_PT', 'pt'], ['es-419', 'es'],
        ['de-CH-1996', 'de'], ['fr-CA-x-private', 'fr'], ['en-a-bbb-x-ccc', 'en'], ['en-Latn-US', 'en'],
        ['ja-Jpan-JP', 'ja'], ['ja-Hira', 'ja'], ['ko-Kore-KR', 'ko'], ['ru-Cyrl', 'ru'], ['hi-Deva-IN', 'hi'],
    ])('%s → %s（地区和默认脚本不改变阅读语言）', (code, expected) => {
        expect(normalizeLanguageCode(code)).toBe(expected);
    });

    it.each([
        ['sr-Latn', 'sr-Latn'], ['sr-Latn-RS', 'sr-Latn'], ['sr-Cyrl', 'sr'], ['pa-Arab', 'pa-Arab'],
        ['hi-Latn', 'hi-Latn'], ['ja-Latn', 'ja-Latn'], ['uz-Cyrl', 'uz-Cyrl'], ['az-Cyrl-AZ', 'az-Cyrl'],
        ['yue-Hans', 'yue-Hans'], ['yue-Hant', 'yue'],
    ])('非默认脚本 %s 保留为 %s，不与默认脚本匹配', (code, expected) => {
        expect(normalizeLanguageCode(code)).toBe(expected);
        if (expected.includes('-')) expect(isLanguageCodeMatch(expected, expected.split('-')[0])).toBe(false);
    });

    it.each([
        [123, ''], [null, ''], [undefined, ''], [{}, ''], ['', ''], ['   ', ''], ['auto', ''], ['AUTO', ''],
        ['detect', ''], ['unknown', ''], ['und', ''], ['mul', ''], ['zxx', ''], ['mis', ''], ['x-klingon', ''],
        ['i-klingon', ''], ['english', ''], ['e', ''], ['123', ''], ['en-', ''], ['-en', ''], ['en--US', ''],
        ['en-USA', ''], ['zh-Hans-Hant', ''], ['zh-TW-CN', ''], ['de-1996-CH', ''], ['en-Latn-Cyrl', ''],
    ])('非法或未知取值 %j 返回空代码且不匹配任何语言', (value, expected) => {
        expect(normalizeLanguageCode(value)).toBe(expected);
        expect(normalizeDetectedLanguageCode(value)).toBe(expected);
        expect(isLanguageCodeMatch(value, 'en')).toBe(false);
        expect(isLanguageCodeMatch('en', value)).toBe(false);
    });

    it('解析结果保留原始主语言、扩展语言、脚本和地区供调用方检查', () => {
        expect(parseLanguageTag('zh-yue-HK')).toEqual({language: 'yue', region: 'HK'});
        expect(parseLanguageTag('ar-arb-EG')).toEqual({language: 'arb', region: 'EG'});
        expect(parseLanguageTag('sr_latn_rs')).toEqual({language: 'sr', script: 'Latn', region: 'RS'});
        expect(parseLanguageTag('zh-CHT')).toEqual({language: 'zh', legacyChineseScript: 'Hant'});
        // 非宏语言前缀后的三字母段不是扩展语言。
        expect(parseLanguageTag('en-abc')).toBeUndefined();
    });
});

describe('中文简繁与检测器结果', () => {
    it.each([
        ['zh', 'zh-Hans'], ['ZH', 'zh-Hans'], ['zho', 'zh-Hans'], ['chi', 'zh-Hans'], ['zh-CN', 'zh-Hans'],
        ['zh_sg', 'zh-Hans'], ['zh-CHS', 'zh-Hans'], ['zh-Hans-TW', 'zh-Hans'], ['zh-TW', 'zh-Hant'],
        ['zh-HK', 'zh-Hant'], ['zh-MO', 'zh-Hant'], ['zh-CHT', 'zh-Hant'], ['zh-Hant-CN', 'zh-Hant'],
        ['zh-cmn-Hant-HK', 'zh-Hant'], ['cmn-Hans', 'zh-Hans'], ['zh-TW-CHS', 'zh-Hans'],
    ])('配置语言 %s → %s：脚本优先于地区，旧版裸 zh 为简体', (code, expected) => {
        expect(normalizeLanguageCode(code)).toBe(expected);
        expect(normalizeChineseLanguageCode(code)).toBe(expected);
    });

    it.each(['zh-US', 'zh-MY', 'cmn', 'zh-cmn', 'zh-Latn'])('无法确定简繁的中文标签 %s 规范为 zh，且不匹配任何简繁目标', code => {
        expect(normalizeLanguageCode(code)).toBe('zh');
        expect(isLanguageCodeMatch(code, 'zh-Hans')).toBe(false);
        expect(isLanguageCodeMatch(code, 'zh-Hant')).toBe(false);
        expect(isLanguageCodeMatch(code, code)).toBe(false);
    });

    it('检测器给出的裸 zh/zho/cmn 只证明是中文，不沿用配置的简体默认值', () => {
        for (const detected of ['zh', 'ZHO', 'cmn', 'chi']) {
            expect(normalizeDetectedLanguageCode(detected)).toBe('zh');
            expect(isLanguageCodeMatch(detected, 'zh')).toBe(false);
            expect(isLanguageCodeMatch(detected, 'zh-Hans')).toBe(false);
        }
        expect(isLanguageCodeMatch('zh-Hant', 'zh-TW')).toBe(true);
        expect(isLanguageCodeMatch('zh-Hans', 'zh')).toBe(true);
        expect(isLanguageCodeMatch('zh-Hans', 'zh-Hant')).toBe(false);
    });

    it('粤语与繁体中文是不同语言，zh-yue 扩展语言按粤语处理', () => {
        expect(normalizeLanguageCode('zh-yue')).toBe('yue');
        expect(normalizeLanguageCode('zh-yue-HK')).toBe('yue');
        expect(isLanguageCodeMatch('yue', 'zh-Hant')).toBe(false);
        expect(isLanguageCodeMatch('zh-Hant', 'yue')).toBe(false);
    });

    it('简繁解析函数只读取脚本、旧式 CHS/CHT 与已知地区', () => {
        expect(resolveChineseScriptFromSubtags({language: 'zh', script: 'Latn', region: 'CN'})).toBeUndefined();
        expect(resolveChineseScriptFromSubtags({language: 'zh', region: 'SG'})).toBe('Hans');
        expect(resolveChineseScriptFromSubtags({language: 'zh'})).toBeUndefined();
    });

    it('中文专用规范化对其他语言和不确定标签保持供应商映射所需的原文', () => {
        for (const value of [' en_US ', 'zh-US', 'cmn', 'yue-Hant', 'zh-Hans-Hant', 'zh-', ' auto ']) {
            expect(normalizeChineseLanguageCode(value)).toBe(value.trim());
        }
    });
});

describe('统计检测器输出', () => {
    const scriptSubtags: Record<string, string> = {Latin: 'Latn', Cyrillic: 'Cyrl', Arabic: 'Arab', Devanagari: 'Deva'};
    const outputs = Object.entries(francMinData).flatMap(([script, languages]) =>
        Object.keys(languages).map(code => [script, code] as const));

    it.each(outputs)('franc-min 在 %s 中的 %s 规范化为稳定、非空代码', (script, code) => {
        const tagged = scriptSubtags[script] ? `${code}-${scriptSubtags[script]}` : code;
        const canonical = normalizeDetectedLanguageCode(tagged);
        expect(canonical).not.toBe('');
        expect(normalizeDetectedLanguageCode(canonical)).toBe(canonical);
    });

    it('同一语言在非默认文字中保留脚本：Latin 塞尔维亚语、Cyrillic 波斯尼亚语、Arabic 马来语', () => {
        expect(normalizeDetectedLanguageCode('srp-Latn')).toBe('sr-Latn');
        expect(normalizeDetectedLanguageCode('srp-Cyrl')).toBe('sr');
        expect(normalizeDetectedLanguageCode('bos-Cyrl')).toBe('bs-Cyrl');
        expect(normalizeDetectedLanguageCode('zlm-Arab')).toBe('ms-Arab');
        expect(isLanguageCodeMatch('sr-Latn', 'sr')).toBe(false);
    });
});

describe('排除语言与目标语言共用规范化', () => {
    it('排除列表接受三字母、旧别名和地区标签，只保留目录语言并按目录排序', () => {
        expect(normalizeExcludedLanguages(['deu', 'iw', 'in', 'tl', 'no', 'pt-BR', 'zh_TW', 'zh', 'ZH-HK', 'auto', 'xx', 7, null]))
            .toEqual(['zh-Hans', 'zh-Hant', 'de', 'pt', 'he', 'id', 'nb', 'fil']);
        expect(normalizeExcludedLanguages('de')).toEqual([]);
    });

    it.each(catalogCodes)('目录语言 %s 作为目标或排除项得到相同规范代码', code => {
        expect(normalizeExcludedLanguages([code])).toEqual([normalizeLanguageCode(code)]);
    });
});
