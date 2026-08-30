/**
 * @file src/providers/translation/gemini.ts
 *
 * 文件职责：适配 Google Gemini generateContent 协议，支持官方 endpoint、代理、自定义模型与 API Key 头部差异。
 * 主要内容：从配置快照选取模型和 URL，使用 geminiMsgTemplate 构造 contents，通过 runtimeFetch 请求，归一 usageMetadata 后再校验 candidates 文本响应。 可核对的公开符号包括 default:gemini。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {method} from "@/src/core/config/constants";
import {geminiMsgTemplate} from '@/src/services/translation/templates';
import {customModelString} from "@/src/core/config/catalog";
import {config} from "@/src/services/config/store";
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {
    getTranslationProviderConfig,
    reportTranslationModelUsage,
    reportTranslationModelUsageFailure,
    type TranslationProviderRequest,
} from '@/src/services/translation/requestSnapshot';
import {normalizeGeminiUsage} from './usage';


async function gemini(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;

    const model = message.modelOverride
        || (current.model[service] === customModelString ? current.customModel[service] : current.model[service]);
    const proxyUrl = current.proxy[service]?.trim();
    const usesOfficialEndpoint = !proxyUrl;
    const url = proxyUrl
        || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const headers = new Headers({'Content-Type': 'application/json'});
    // Google 文档规定，直接 Gemini REST 请求使用 x-goog-api-key；绝不能把 Google
    // 凭据转发给用户配置的代理。
    if (usesOfficialEndpoint) {
        appendOptionalHeader(headers, 'x-goog-api-key', current.token[service]);
    }

    const body = geminiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, current);
    const startedAt = Date.now();
    let attemptReported = false;
    try {
        const resp = await runtimeFetch(url, {
            method: method.POST,
            headers,
            body,
            signal: message.abortSignal,
        });
        if (!resp.ok) {
            reportTranslationModelUsageFailure(message, undefined, startedAt, model, resp.status);
            attemptReported = true;
            throw createHttpStatusError(resp, '翻译失败');
        }
        const result = await readJsonResponse<any>(resp, 'Gemini 返回的不是有效 JSON');
        const actualModel = typeof result?.modelVersion === 'string' && result.modelVersion.trim()
            ? result.modelVersion
            : model;
        const translatedText = result.candidates[0].content.parts[0].text;
        reportTranslationModelUsage(message, {
            ...normalizeGeminiUsage(result?.usageMetadata, actualModel),
            startedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
            outcome: 'success',
            statusCode: resp.status,
        });
        attemptReported = true;
        return translatedText;
    } catch (error) {
        if (!attemptReported) reportTranslationModelUsageFailure(message, error, startedAt, model);
        throw error;
    }
}

export default gemini;
