/**
 * @file src/providers/translation/azure-openai.ts
 *
 * 文件职责：适配 Azure OpenAI 翻译服务，校验其专用 endpoint、deployment/model 与凭据后复用 OpenAI 兼容 AI SDK transport。
 * 主要内容：从请求快照读取 service 和 token，执行 API Key 必需性判断，验证 Azure 端点与模型配置，并将消息交给 translateWithOpenAICompatibleAiSdk。 可核对的公开符号包括 default:azureOpenai。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {config} from "@/src/services/config/store";
import {isApiKeyRequired} from "@/src/core/config/validation";
import {translateWithOpenAICompatibleAiSdk} from './ai-sdk/openai-compatible';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function azureOpenai(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    const apiKey = current.token[service];
    if ((!apiKey || apiKey.trim() === '') && isApiKeyRequired(service, current)) {
        throw new Error('Azure OpenAI API Key 未配置，请在设置中输入有效的 API Key');
    }

    const endpoint = current.azureOpenaiEndpoint;
    if (!endpoint || endpoint.trim() === '') {
        throw new Error('Azure OpenAI 端点地址未配置，请在设置中输入完整的端点地址');
    }

    if (!endpoint.includes('openai.azure.com') || !endpoint.includes('/chat/completions')) {
        throw new Error('Azure OpenAI 端点地址格式不正确，请确保包含正确的域名和路径');
    }

    return translateWithOpenAICompatibleAiSdk({...message, serviceOverride: service});
}

export default azureOpenai;
