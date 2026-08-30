/**
 * @file src/providers/translation/microsoft.ts
 *
 * 文件职责：适配 Edge Microsoft 免费翻译端点，支持单条与批量文本并保留受控 HTML 片段。
 * 主要内容：映射源/目标语言，对文本进行 HTML 转义与分隔，调用 translatetext，解析 translations 数组并按原批次还原结果；导出 translateMicrosoftTexts。 可核对的公开符号包括 translateMicrosoftTexts、default:microsoft。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {getTranslationLanguages} from '@/src/services/translation/languages';
import type {TranslationLanguageOverride} from '@/src/services/translation/languages';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import type {TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';

const MICROSOFT_TRANSLATE_URL = "https://edge.microsoft.com/translate/translatetext";

type MicrosoftTranslation = {
    translations?: Array<{text?: string}>;
};

function escapeHtmlText(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function decodeHtmlText(text: string): string {
    return text
        .replace(/&#(?:0*39);|&#x0*27;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&gt;/gi, '>')
        .replace(/&lt;/gi, '<')
        .replace(/&amp;/gi, '&');
}

export async function translateMicrosoftTexts(
    texts: string[],
    fromLang: string,
    toLang: string,
    abortSignal?: AbortSignal,
): Promise<string[]> {
    if (texts.length === 0) return [];

    const url = new URL(MICROSOFT_TRANSLATE_URL);
    url.searchParams.set('from', fromLang === 'auto' ? '' : fromLang);
    url.searchParams.set('to', toLang);
    url.searchParams.set('isEnterpriseClient', 'false');

    const resp = await runtimeFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        // endpoint 始终会运行 HTML 标签对齐器。转义可避免纯文本比较运算符和用户输入
        // 被解释为标记。
        body: JSON.stringify(texts.map(escapeHtmlText)),
        signal: abortSignal,
    });

    if (!resp.ok) {
        throw createHttpStatusError(resp, '翻译失败');
    }

    const result = await readJsonResponse<MicrosoftTranslation[]>(resp, '微软翻译返回的不是有效 JSON');
    if (!Array.isArray(result) || result.length !== texts.length) {
        throw new Error(`微软翻译返回数量异常: 期望 ${texts.length} 条，实际 ${Array.isArray(result) ? result.length : 0} 条`);
    }

    return result.map((item, index) => {
        const translatedText = item?.translations?.[0]?.text;
        if (typeof translatedText !== 'string') {
            throw new Error(`微软翻译第 ${index + 1} 条结果缺少译文`);
        }
        return decodeHtmlText(translatedText);
    });
}

async function microsoft(message: TranslationProviderRequest & TranslationLanguageOverride) {
    const origin = message.origin;
    const isSingleText = typeof origin === 'string';
    const texts: string[] = typeof origin === 'string' ? [origin] : origin;
    const {sourceLanguage, targetLanguage} = getTranslationLanguages(message);
    const translations = await translateMicrosoftTexts(texts, sourceLanguage, targetLanguage, message.abortSignal);
    if (!isSingleText) return translations;

    const translatedText = translations[0];
    if (translatedText === undefined) {
        throw new Error('微软翻译未返回译文');
    }
    return translatedText;
}

export default microsoft;
