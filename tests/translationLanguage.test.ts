import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/services/config/store', () => ({
    config: {
        from: 'auto',
        to: 'zh-Hans',
    },
}));

import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import {containsEnglishMonthDate} from '@/src/core/language/detect';
import {getTranslationLanguages} from '@/src/services/translation/languages';

describe('翻译请求语言隔离', () => {
    it('识别常见英文月份日期并忽略 HTML 标签', () => {
        expect(containsEnglishMonthDate('26 April 2026')).toBe(true);
        expect(containsEnglishMonthDate('<time>Apr 25, 2026</time>')).toBe(true);
        expect(containsEnglishMonthDate('April release notes')).toBe(false);
    });
    it('优先使用请求级语言而不需要改写默认配置', () => {
        expect(getTranslationLanguages({
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        })).toEqual({
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        });
    });

    it('缺少或为空的请求级语言会回退到默认配置', () => {
        expect(getTranslationLanguages({
            sourceLanguage: ' ',
        })).toEqual({
            sourceLanguage: 'auto',
            targetLanguage: 'zh-Hans',
        });
    });

    it('纯解析器清理请求值，并使用显式默认快照', () => {
        expect(resolveTranslationLanguages({
            sourceLanguage: '  de ',
            targetLanguage: '',
        }, {
            sourceLanguage: 'auto',
            targetLanguage: 'fr',
        })).toEqual({
            sourceLanguage: 'de',
            targetLanguage: 'fr',
        });
    });

    it('纯解析器允许 null 请求并完整回退', () => {
        expect(resolveTranslationLanguages(null, {
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        })).toEqual({sourceLanguage: 'en', targetLanguage: 'ja'});
    });
});
