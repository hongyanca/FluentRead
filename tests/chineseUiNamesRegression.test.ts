import {describe, expect, it} from 'vitest';
import {identifyTextLanguage} from '@/src/core/language/identify';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';

describe('短中文操作提示中的服务名称', () => {
    // 2026-10-08 用户所给 X 页面匿名 DOM 中的实际按钮文字；宿主页为中文或英文均不影响判断。
    it.each(['继续使用 Apple', '继续使用 Google', '通过 Google 继续操作'])('%s 不再中译中', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans']});
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });

    it.each(['繼續使用 Apple', '透過 Google 繼續操作', '继续使用 Arbor', '继续使用 AcmeCloud'])
    ('规则不依赖特定品牌且保留简繁转换：%s', text => {
        const target = text.includes('繼續') ? 'zh-Hant' : 'zh-Hans';
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, target === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans')).toBe(false);
    });

    it.each(['继续使用 "Apple"', '继续使用 Please', '继续使用 welcome', '继续使用 read the guide',
        '通过 Google read this message', '继续使用 Google。Please read the guide.', '翻译一下 Apple',
        '继续使用单词 Download', '运行 Harbor', 'Apple', 'Continue with phone'])
    ('引述、外语正文、过短中文和独立名称不能被吞掉：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });
});
