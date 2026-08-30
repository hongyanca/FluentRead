/**
 * @file src/core/config/validation.ts
 *
 * 文件职责：表达各翻译服务对 API Key 的领域校验规则，为保存、连接测试和请求前检查提供一致判定。
 * 主要内容：定义 CredentialConfig，结合服务类型及代理等配置计算凭据要求键，判断是否必须提供密钥，并生成面向用户的缺失凭据消息。 可核对的公开符号包括 CredentialConfig、getApiKeyRequirementKey、isApiKeyRequired、getMissingCredentialMessage。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

import { customModelString, options, services, servicesType } from './catalog';

export interface CredentialConfig {
    token?: Record<string, string | undefined>;
    model?: Record<string, string | undefined>;
    customModel?: Record<string, string | undefined>;
    requireApiKey?: Record<string, boolean | undefined>;
    youdaoAppKey?: string;
    youdaoAppSecret?: string;
    tencentSecretId?: string;
    tencentSecretKey?: string;
}

function getServiceLabel(service: string): string {
    return options.services.find((item) => item.value === service)?.label || service;
}

/** 使用服务和实际模型共同定位开关，避免切换模型时误用另一模型的设置。 */
export function getApiKeyRequirementKey(service: string, config: CredentialConfig): string {
    const selectedModel = config.model?.[service] || '';
    const actualModel = selectedModel === customModelString
        ? config.customModel?.[service] || selectedModel
        : selectedModel;
    return `${service}:${actualModel}`;
}

export function isApiKeyRequired(service: string, config: CredentialConfig): boolean {
    if (!servicesType.isAI(service)) return true;
    return config.requireApiKey?.[getApiKeyRequirementKey(service, config)] !== false;
}

/** 返回设置页和翻译前校验共用的凭据提示；返回 null 表示当前服务不缺凭据。 */
export function getMissingCredentialMessage(
    service: string,
    config: CredentialConfig,
): string | null {
    const serviceLabel = getServiceLabel(service);

    if (servicesType.isUseToken(service) && service !== services.deeplx && isApiKeyRequired(service, config)) {
        if (!config.token?.[service]?.trim()) {
            return `${serviceLabel} 需要 API Key（访问令牌），当前尚未配置；请先在设置中填写，再开始翻译。`;
        }
    }

    if (service === services.youdao
        && (!config.youdaoAppKey?.trim() || !config.youdaoAppSecret?.trim())) {
        return `${serviceLabel} 需要 App Key 和 App Secret，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }

    if (service === services.tencent
        && (!config.tencentSecretId?.trim() || !config.tencentSecretKey?.trim())) {
        return `${serviceLabel} 需要 SecretId 和 SecretKey，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }

    return null;
}
