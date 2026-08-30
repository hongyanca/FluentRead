/**
 * @file src/providers/translation/free-translation.ts
 *
 * 文件职责：编排无需用户密钥的微软、DeepLX 与谷歌翻译作为有序回退链，提高免费翻译路径的可用性。
 * 主要内容：声明 FREE_TRANSLATION_ORDER，按请求级语言依次调用 translateMicrosoftTexts、translateDeepLXText、translateGoogleText，记录失败并在全部不可用时汇总错误。 可核对的公开符号包括 FREE_TRANSLATION_ORDER、translateFreeText、default:freeTranslation。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {translateMicrosoftTexts} from "./microsoft";
import {translateDeepLXText} from "./deeplx";
import {translateGoogleText} from "./google";
import {services} from "@/src/core/config/catalog";
import {getTranslationLanguages, type TranslationLanguageOverride} from '@/src/services/translation/languages';
import {abortErrorFromSignal} from '@/src/platform/http/runtime';
import type {
    TranslationProviderRequest,
    TranslationProviderRequestContext,
} from '@/src/services/translation/requestSnapshot';

type FreeTranslationRequest = TranslationLanguageOverride & TranslationProviderRequestContext;

type FreeTranslationProvider = {
    label: string;
    translate: (text: string, languages: FreeTranslationRequest) => Promise<string>;
};

export const FREE_TRANSLATION_ORDER = [
    "微软翻译",
    "DeepLX",
    "谷歌翻译",
] as const;
export const FREE_TRANSLATION_BATCH_CONCURRENCY = 3;

function requireTranslation(text: string, label: string): string {
    if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`${label}未返回有效译文`);
    }
    return text;
}

const providers: FreeTranslationProvider[] = [
    {
        label: FREE_TRANSLATION_ORDER[0],
        translate: async (text, languages) => {
            const {sourceLanguage, targetLanguage} = getTranslationLanguages(languages);
            const translations = await translateMicrosoftTexts(
                [text],
                sourceLanguage,
                targetLanguage,
                languages.abortSignal,
            );
            return requireTranslation(translations[0] || "", FREE_TRANSLATION_ORDER[0]);
        },
    },
    {
        label: FREE_TRANSLATION_ORDER[1],
        translate: (text, languages) => translateDeepLXText(text, services.deeplx, languages),
    },
    {
        label: FREE_TRANSLATION_ORDER[2],
        translate: (text, languages) => {
            const {sourceLanguage, targetLanguage} = getTranslationLanguages(languages);
            return translateGoogleText(text, sourceLanguage, targetLanguage, languages.abortSignal);
        },
    },
];

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function translateFreeText(text: string, languages: FreeTranslationRequest = {}): Promise<string> {
    if (typeof text !== "string") {
        throw new Error("免费翻译服务仅支持文本输入");
    }

    const failures: string[] = [];
    for (const provider of providers) {
        if (languages.abortSignal?.aborted) throw abortErrorFromSignal(languages.abortSignal);
        try {
            return requireTranslation(await provider.translate(text, languages), provider.label);
        } catch (error) {
            if (languages.abortSignal?.aborted) throw abortErrorFromSignal(languages.abortSignal);
            failures.push(`${provider.label}: ${getErrorMessage(error)}`);
        }
    }

    throw new Error(`免费翻译服务均不可用（${FREE_TRANSLATION_ORDER.join(" → ")}）：${failures.join("；")}`);
}

async function translateFreeBatch(texts: string[], message: FreeTranslationRequest): Promise<string[]> {
    const translations = new Array<string>(texts.length);
    const batchController = new AbortController();
    const onCallerAbort = () => batchController.abort(message.abortSignal?.reason);
    if (message.abortSignal?.aborted) onCallerAbort();
    else message.abortSignal?.addEventListener('abort', onCallerAbort, {once: true});
    const batchMessage = {...message, abortSignal: batchController.signal};
    let nextIndex = 0;
    let stopped = false;

    // 每个 worker 串行领取下一段，避免 OCR 文本一次并发整条三层回退链。
    const worker = async () => {
        while (!stopped) {
            if (batchController.signal.aborted) throw abortErrorFromSignal(batchController.signal);
            const index = nextIndex;
            if (index >= texts.length) return;
            nextIndex += 1;
            try {
                translations[index] = await translateFreeText(texts[index], batchMessage);
            } catch (error) {
                stopped = true;
                if (!batchController.signal.aborted) batchController.abort(error);
                throw error;
            }
        }
    };

    const workerCount = Math.min(FREE_TRANSLATION_BATCH_CONCURRENCY, texts.length);
    try {
        await Promise.all(Array.from({length: workerCount}, () => worker()));
        return translations;
    } finally {
        message.abortSignal?.removeEventListener('abort', onCallerAbort);
    }
}

async function freeTranslation(message: TranslationProviderRequest) {
    if (typeof message.origin === "string") {
        return translateFreeText(message.origin, message);
    }

    if (Array.isArray(message.origin)) {
        return translateFreeBatch(message.origin, message);
    }

    throw new Error("免费翻译服务仅支持文本输入");
}

export default freeTranslation;
