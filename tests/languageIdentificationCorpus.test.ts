/**
 * @file tests/languageIdentificationCorpus.test.ts
 * 使用真实 franc-min 在可复现语料上验证同目标跳过的整体性质：每个文本对每个目录目标都不能错误跳过；
 * 明确样本必须跳过；目标语言与排除语言逐项等价；任意两种语言的整段拼接不会因主体语言而吞掉另一种语言；
 * 校准语料、阈值确定后编写的留出语料，以及相近语言反证修正后另写且只测量的第二份留出语料分别统计同目标跳过率，防止规则回退。
 */
import {describe, expect, it} from 'vitest';
import corpus from './fixtures/language-identification-corpus.json';
import holdout from './fixtures/language-identification-holdout.json';
import holdoutTwo from './fixtures/language-identification-holdout-2.json';
import {translationLanguageOptions} from '@/src/core/language/catalog';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import {identifyTextLanguage} from '@/src/core/language/identify';

interface CorpusCase {
    id: string;
    text: string;
    languages: string[];
    empty?: boolean;
    requireSkip?: boolean;
    tags: string[];
}

const targets = translationLanguageOptions.map(option => option.value);
const calibration = corpus.cases as CorpusCase[];
const heldOut = holdout.cases as CorpusCase[];
const heldOutTwo = holdoutTwo.cases as CorpusCase[];

function expectedSkips(item: CorpusCase): string[] {
    return item.empty ? targets : item.languages;
}

function evaluate(cases: readonly CorpusCase[]) {
    let wrong = 0;
    let expected = 0;
    let skipped = 0;
    for (const item of cases) {
        if (item.empty) continue;
        for (const target of targets) {
            const skip = shouldSkipTranslationForTarget(item.text, target);
            if (item.languages.includes(target)) {
                expected += 1;
                if (skip) skipped += 1;
            } else if (skip) {
                wrong += 1;
            }
        }
    }
    return {wrong, expected, skipped, recall: skipped / expected};
}

describe.each([
    ['校准语料', calibration],
    ['留出语料', heldOut],
    ['第二份留出语料', heldOutTwo],
] as const)('%s', (_name, cases) => {
    it('语料 id 唯一，语言标注都属于语言目录', () => {
        expect(new Set(cases.map(item => item.id)).size).toBe(cases.length);
        for (const item of cases) {
            for (const language of item.languages) expect(targets).toContain(language);
            if (item.empty) expect(/\p{L}/u.test(item.text)).toBe(false);
        }
    });

    it.each(cases.map(item => [item.id, item] as const))('%s：不跳过任何非本语言目标，目标与排除语言等价', (_id, item) => {
        const expected = expectedSkips(item);
        const identification = identifyTextLanguage(item.text);
        if (item.empty) expect(identification.status).toBe('empty');
        else if (item.languages.length === 0) {
            expect(identification.languages.filter(language => targets.includes(language))).toEqual([]);
        }
        for (const [index, target] of targets.entries()) {
            const skip = shouldSkipTranslationForTarget(item.text, target);
            if (!expected.includes(target)) expect(skip, `${item.id} → ${target}`).toBe(false);
            if (item.requireSkip && expected.includes(target)) expect(skip, `${item.id} → ${target}`).toBe(true);
            expect(shouldSkipTranslationForTarget(item.text, 'und', [target])).toBe(skip);
            const other = targets[(index + 1) % targets.length]!;
            expect(shouldSkipTranslationForTarget(item.text, other, [target]))
                .toBe(skip || shouldSkipTranslationForTarget(item.text, other));
        }
    });
});

describe('整体跳过率', () => {
    it('校准语料零错误跳过，同目标跳过率不低于 70%', () => {
        const result = evaluate(calibration);
        expect(result.wrong).toBe(0);
        expect(result.recall).toBeGreaterThanOrEqual(0.7);
    });

    it('留出语料零错误跳过，同目标跳过率不低于 58%', () => {
        const result = evaluate(heldOut);
        expect(result.wrong).toBe(0);
        expect(result.recall).toBeGreaterThanOrEqual(0.58);
    });

    // 第二份留出语料首次测量即为零错误跳过、74.4% 跳过率，此后只作为回归下限，不用于调参。
    it('第二份留出语料零错误跳过，同目标跳过率不低于 70%', () => {
        const result = evaluate(heldOutTwo);
        expect(result.wrong).toBe(0);
        expect(result.recall).toBeGreaterThanOrEqual(0.7);
    });
});

describe('外语句子插入', () => {
    // 每种语言选一段可信识别的长文本，两两拼接成两句话；任何一种语言都不能因另一种语言占多数而跳过。
    const representatives = new Map<string, string>();
    for (const item of calibration) {
        const [language] = item.languages;
        if (item.languages.length !== 1 || !item.tags.includes('long') || representatives.has(language!)) continue;
        if (shouldSkipTranslationForTarget(item.text, language!)) representatives.set(language!, item.text);
    }
    const pairs = [...representatives].flatMap(([left, leftText]) => [...representatives]
        .filter(([right]) => right !== left)
        .map(([right, rightText]) => [left, right, `${leftText} ${rightText}`] as const));

    it('代表文本覆盖 Latin、Cyrillic、Arabic、Devanagari、单一语言文字和中日韩', () => {
        for (const language of ['en', 'de', 'ru', 'uk', 'ar', 'fa', 'hi', 'el', 'he', 'th', 'zh-Hans', 'zh-Hant', 'ja', 'ko']) {
            expect(representatives.has(language), language).toBe(true);
        }
        expect(pairs.length).toBeGreaterThan(900);
    });

    it('任意两种语言的整段拼接对两种目标都保留翻译', () => {
        const swallowed = pairs.filter(([left, right, text]) =>
            shouldSkipTranslationForTarget(text, left) || shouldSkipTranslationForTarget(text, right));
        expect(swallowed.map(([left, right]) => `${left}+${right}`)).toEqual([]);
    });
});
