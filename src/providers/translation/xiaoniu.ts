/**
 * @file src/providers/translation/xiaoniu.ts
 *
 * 文件职责：适配小牛翻译 REST API，处理目标语言映射、代理选择和 token 参数。
 * 主要内容：从请求级配置获得 service 与语言，将简体中文代码转换为接口格式，构造表单请求，通过 runtimeFetch 校验状态并提取目标文本。 可核对的公开符号包括 default:xiaoniu。
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

async function xiaoniu(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    // 根据需要调整目标语言
    const {targetLanguage} = getTranslationLanguages(message);
    let targetLang = targetLanguage === 'zh-Hans' ? 'zh' : targetLanguage;

    // 判断是否使用代理
    let url: string = current.proxy[service] ? current.proxy[service] : urls[services.xiaoniu]

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `from=auto&to=${targetLang}&apikey=${current.token[service]}&src_text=${encodeURIComponent(message.origin)}`,
        signal: message.abortSignal,
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '小牛翻译返回的不是有效 JSON');
        return result.tgt_text
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default xiaoniu;
