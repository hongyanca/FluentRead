/**
 * @file src/providers/translation/deepseek.ts
 *
 * 文件职责：适配 DeepSeek 官方或代理端点，并根据配置选择 Chat Completions 或 Responses 协议进行翻译。
 * 主要内容：从快照解析 thinking/API 模式和 endpoint，分别构造 deepseek 模板，执行 Bearer 请求、HTTP/JSON 校验、上报协议对应的 token 用量并清理模型推理标记；另导出 buildDeepSeekEndpoint。 可核对的公开符号包括 buildDeepSeekEndpoint、default:deepseek。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import { method, urls } from "@/src/core/config/constants";
import {
    deepseekMsgTemplate,
    deepseekResponsesMsgTemplate,
    getCurrentModel,
} from '@/src/services/translation/templates';
import { config } from "@/src/services/config/store";
import {stripTranslationReasoning as contentPostHandler} from '@/src/core/translation/prompts';
import { appendOptionalBearer } from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {
    getTranslationProviderConfig,
    reportTranslationModelUsage,
    reportTranslationModelUsageFailure,
    type TranslationProviderRequest,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderConfigSnapshot} from '@/src/services/translation/types';
import {normalizeDeepSeekResponsesUsage, normalizeOpenAICompatibleUsage} from './usage';

// 当前官方 V4 文档以 Chat Completion 为主；Responses API 仅在用户明确选择时启用，
// 便于兼容已经支持该协议的代理或网关。
function useResponsesApi(current: TranslationProviderConfigSnapshot) {
    const apiType = current.deepseekApiType;
    if (apiType === 'responses') return true;
    return false;
}

async function deepseek(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    const headers = new Headers({'Content-Type': 'application/json'});
    appendOptionalBearer(headers, current.token[service]);

    const endpoint = current.proxy[service] || urls[service];
    const isResponses = useResponsesApi(current);
    const url = buildDeepSeekEndpoint(endpoint, isResponses);
    const configuredModel = getCurrentModel(service, message.modelOverride, current);

    const body = isResponses
        ? deepseekResponsesMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
        : deepseekMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current);
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
            reportTranslationModelUsageFailure(message, undefined, startedAt, configuredModel, resp.status);
            attemptReported = true;
            throw createHttpStatusError(resp, '翻译失败');
        }

        const result = await readJsonResponse<any>(resp, 'DeepSeek 返回的不是有效 JSON');
        const actualModel = typeof result?.model === 'string' && result.model.trim()
            ? result.model
            : configuredModel;
        const translatedText = isResponses
            ? extractResponsesContent(result)
            : extractChatContent(result);
        reportTranslationModelUsage(message, {
            ...(isResponses
                ? normalizeDeepSeekResponsesUsage(result?.usage, actualModel)
                : normalizeOpenAICompatibleUsage(result?.usage, actualModel)),
            startedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
            outcome: 'success',
            statusCode: resp.status,
        });
        attemptReported = true;
        return translatedText;
    } catch (error) {
        if (!attemptReported) {
            reportTranslationModelUsageFailure(message, error, startedAt, configuredModel);
        }
        throw error;
    }
}

function extractChatContent(result: any): string {
    const content = result?.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
        throw new Error('DeepSeek 返回数据格式异常：缺少 choices[0].message.content');
    }

    // 页面只渲染最终的 message.content；reasoning_content 等 DeepSeek 思考字段会被
    // 主动忽略，绝不能进入页面。
    return contentPostHandler(content);
}

function extractResponsesContent(result: any): string {
    if (typeof result?.output_text === 'string' && result.output_text) {
        return contentPostHandler(result.output_text);
    }

    const text = Array.isArray(result?.output)
        ? result.output
            .filter((item: any) => item?.type === 'message' && Array.isArray(item.content))
            .flatMap((item: any) => item.content)
            .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
            .map((part: any) => part.text)
            .join('')
        : '';

    if (!text) {
        throw new Error('DeepSeek 返回数据格式异常：缺少 Responses API 输出文本');
    }

    return contentPostHandler(text);
}

export function buildDeepSeekEndpoint(endpoint: string, isResponses: boolean): string {
    const targetPath = isResponses ? 'responses' : 'chat/completions';

    try {
        const url = new URL(endpoint);
        const basePath = url.pathname
            .replace(/\/(?:chat\/completions|responses)\/?$/, '')
            .replace(/\/+$/, '');
        url.pathname = `${basePath}/${targetPath}`;
        return url.toString();
    } catch {
        // 兼容部分代理接受的非标准地址，同时确保查询参数和 hash 不会被拼到路径中。
        const match = endpoint.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
        const path = (match?.[1] || endpoint)
            .replace(/\/(?:chat\/completions|responses)\/?$/, '')
            .replace(/\/+$/, '');
        return `${path}/${targetPath}${match?.[2] || ''}${match?.[3] || ''}`;
    }
}

export default deepseek;
