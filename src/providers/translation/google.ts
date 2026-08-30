/**
 * @file src/providers/translation/google.ts
 *
 * 文件职责：适配无需密钥的 Google Translate Web RPC 与 legacy 接口，并在统一截止时间内执行候选端点回退。
 * 主要内容：编码 batchexecute 请求、解析嵌套 RPC 和 legacy 数组响应，映射请求语言，识别 CAPTCHA 提示，并导出 parse 与 translateGoogleText 供免费链复用。 可核对的公开符号包括 parseGoogleBatchResponse、parseGoogleLegacyResponse、translateGoogleText、default:google。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError} from '@/src/platform/http/errors';
import {
    abortErrorFromSignal,
    createRuntimeAbortContext,
    runtimeFetch,
} from '@/src/platform/http/runtime';
import type {TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';

const GOOGLE_TRANSLATE_RPC_ID = 'MkEWBc';
const GOOGLE_TRANSLATE_BATCH_URLS = [
    `https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=${GOOGLE_TRANSLATE_RPC_ID}`,
    `https://translate.google.co.uk/_/TranslateWebserverUi/data/batchexecute?rpcids=${GOOGLE_TRANSLATE_RPC_ID}`,
] as const;
const GOOGLE_TRANSLATE_LEGACY_URL = 'https://translate.googleapis.com/translate_a/single';
const GOOGLE_TRANSLATE_TOTAL_TIMEOUT_MS = 15_000;
const GOOGLE_TRANSLATE_ATTEMPT_TIMEOUT_MS = 8_000;
const GOOGLE_CAPTCHA_HINT = '可能触发了 CAPTCHA，请稍后重试';

type GoogleProvider = {
    name: string;
    translate: (timeoutMs: number) => Promise<string>;
};

function createGoogleBatchRequest(text: string, fromLang: string, toLang: string): string {
    const request = JSON.stringify([[text, fromLang, toLang, true], [null]]);
    return JSON.stringify([[[GOOGLE_TRANSLATE_RPC_ID, request, null, 'generic']]]);
}

function getArrayItem(value: unknown, index: number): unknown {
    return Array.isArray(value) ? value[index] : undefined;
}

function joinTranslationSegments(value: unknown): string | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const translatedText = value
        .map(segment => Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '')
        .join('');
    return translatedText.length > 0 ? translatedText : null;
}

function getGoogleBatchSegments(payload: unknown): unknown {
    const translationGroups = getArrayItem(payload, 1);
    const firstGroup = getArrayItem(translationGroups, 0);
    const firstTranslation = getArrayItem(firstGroup, 0);
    return getArrayItem(firstTranslation, 5);
}

export function parseGoogleBatchResponse(responseBody: string): string {
    const lines = responseBody
        .replace(/^\)\]\}'(?:\r?\n)?/, '')
        .split(/\r?\n/);

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith('[')) {
            continue;
        }

        let records: unknown;
        try {
            records = JSON.parse(trimmedLine);
        } catch {
            continue;
        }

        if (!Array.isArray(records)) {
            continue;
        }

        for (const record of records) {
            if (
                !Array.isArray(record)
                || record[0] !== 'wrb.fr'
                || record[1] !== GOOGLE_TRANSLATE_RPC_ID
                || typeof record[2] !== 'string'
            ) {
                continue;
            }

            let payload: unknown;
            try {
                payload = JSON.parse(record[2]);
            } catch {
                continue;
            }

            const translatedText = joinTranslationSegments(getGoogleBatchSegments(payload));
            if (translatedText !== null) {
                return translatedText;
            }
        }
    }

    throw new Error('返回格式异常');
}

export function parseGoogleLegacyResponse(responseBody: string): string {
    let result: unknown;
    try {
        result = JSON.parse(responseBody);
    } catch {
        throw new Error('返回的不是 JSON');
    }

    const translatedText = joinTranslationSegments(getArrayItem(result, 0));
    if (translatedText === null) {
        throw new Error('返回格式异常');
    }
    return translatedText;
}

function isHtmlResponse(responseBody: string): boolean {
    return /<!doctype html|<html[\s>]/i.test(responseBody);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createGoogleParseError(error: unknown, responseBody: string): Error {
    const message = getErrorMessage(error);
    return new Error(isHtmlResponse(responseBody) ? `${message}（${GOOGLE_CAPTCHA_HINT}）` : message);
}

async function fetchGoogleResponse(
    url: string | URL,
    init: RequestInit,
    timeoutMs: number,
    callerSignal?: AbortSignal,
): Promise<{responseBody: string}> {
    const abortContext = createRuntimeAbortContext(timeoutMs, callerSignal);

    try {
        let response: Response;
        try {
            response = await runtimeFetch(url, {...init, signal: abortContext.signal});
        } catch {
            if (callerSignal?.aborted) throw abortErrorFromSignal(callerSignal);
            if (abortContext.didTimeout()) {
                throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
            }
            throw new Error('网络请求失败');
        }

        let responseBody: string;
        try {
            responseBody = await response.text();
        } catch {
            if (callerSignal?.aborted) throw abortErrorFromSignal(callerSignal);
            if (abortContext.didTimeout()) {
                throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
            }
            throw new Error('响应读取失败');
        }
        if (!response.ok) {
            const statusError = createHttpStatusError(response);
            if (response.status === 429 || isHtmlResponse(responseBody)) {
                throw new Error(`${statusError.message}（${GOOGLE_CAPTCHA_HINT}）`);
            }
            throw statusError;
        }
        return {responseBody};
    } finally {
        abortContext.cleanup();
    }
}

async function translateGoogleBatch(
    endpoint: string,
    text: string,
    fromLang: string,
    toLang: string,
    timeoutMs: number,
    callerSignal?: AbortSignal,
): Promise<string> {
    const {responseBody} = await fetchGoogleResponse(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams({
            'f.req': createGoogleBatchRequest(text, fromLang, toLang),
        }).toString(),
    }, timeoutMs, callerSignal);
    try {
        return parseGoogleBatchResponse(responseBody);
    } catch (error) {
        throw createGoogleParseError(error, responseBody);
    }
}

async function translateGoogleLegacy(
    text: string,
    fromLang: string,
    toLang: string,
    timeoutMs: number,
    callerSignal?: AbortSignal,
): Promise<string> {
    const url = new URL(GOOGLE_TRANSLATE_LEGACY_URL);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', fromLang);
    url.searchParams.set('tl', toLang);
    url.searchParams.set('dt', 't');
    url.searchParams.set('strip', '1');
    url.searchParams.set('nonced', '1');
    url.searchParams.set('q', text);

    const {responseBody} = await fetchGoogleResponse(url, {method: 'GET'}, timeoutMs, callerSignal);
    try {
        return parseGoogleLegacyResponse(responseBody);
    } catch (error) {
        throw createGoogleParseError(error, responseBody);
    }
}

export async function translateGoogleText(
    text: string,
    fromLang: string,
    toLang: string,
    abortSignal?: AbortSignal,
): Promise<string> {
    const providers: GoogleProvider[] = [
        ...GOOGLE_TRANSLATE_BATCH_URLS.map((endpoint, index) => ({
            name: index === 0 ? '主网页 RPC' : '备用网页 RPC',
            translate: (timeoutMs: number) => translateGoogleBatch(
                endpoint,
                text,
                fromLang,
                toLang,
                timeoutMs,
                abortSignal,
            ),
        })),
        {
            name: '旧版 gtx 接口',
            translate: (timeoutMs: number) => translateGoogleLegacy(
                text,
                fromLang,
                toLang,
                timeoutMs,
                abortSignal,
            ),
        },
    ];
    const deadline = Date.now() + GOOGLE_TRANSLATE_TOTAL_TIMEOUT_MS;
    const failures: string[] = [];

    for (const provider of providers) {
        if (abortSignal?.aborted) throw abortErrorFromSignal(abortSignal);
        const remainingTime = deadline - Date.now();
        if (remainingTime <= 0) {
            break;
        }

        try {
            return await provider.translate(Math.min(GOOGLE_TRANSLATE_ATTEMPT_TIMEOUT_MS, remainingTime));
        } catch (error) {
            if (abortSignal?.aborted) throw abortErrorFromSignal(abortSignal);
            failures.push(`${provider.name}: ${getErrorMessage(error)}`);
        }
    }

    const failureSummary = failures.length > 0 ? failures.join('；') : '总请求时间已耗尽';
    throw new Error(`谷歌翻译所有匿名接口均失败：${failureSummary}`);
}

async function google(message: TranslationProviderRequest<string>) {
    if (typeof message.origin !== 'string') {
        throw new Error('谷歌翻译仅支持单条文本');
    }
    const {sourceLanguage, targetLanguage} = getTranslationLanguages(message);
    return translateGoogleText(message.origin, sourceLanguage, targetLanguage, message.abortSignal);
}

export default google;
