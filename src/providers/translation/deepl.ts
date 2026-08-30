/**
 * @file src/providers/translation/deepl.ts
 *
 * 文件职责：适配 DeepL 文本翻译 API，处理 FluentRead 语言代码转换、代理选择、鉴权及响应解析。
 * 主要内容：将 zh-Hans 等目标语言映射为 DeepL 接受的代码，从配置快照构造 URL 与请求体，通过 runtimeFetch 调用并验证 translations 结果。 可核对的公开符号包括 default:deepl。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {method, urls} from "@/src/core/config/constants";
import {services} from "@/src/core/config/catalog";
import {config} from "@/src/services/config/store";
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {
    getTranslationProviderConfig,
    type TranslationProviderRequest,
} from '@/src/services/translation/requestSnapshot';

async function deepl(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    // deepl 不支持 zh-Hans，需要转换为 zh
    const {targetLanguage} = getTranslationLanguages(message);
    let targetLang = targetLanguage === 'zh-Hans' ? 'zh' : targetLanguage;

    // 判断是否使用代理
    let url: string = current.proxy[service] ? current.proxy[service] : urls[services.deepL]

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'DeepL-Auth-Key ' + current.token[service]
        },
        body: JSON.stringify({
            text: [message.origin],
            target_lang: targetLang,
            tag_handling: 'html',
            context: message.context,  // 添加上下文辅助信息
            preserve_formatting: true
        }),
        signal: message.abortSignal,
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'DeepL 返回的不是有效 JSON');
        return result.translations[0].text
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default deepl;
