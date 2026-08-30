/**
 * @file src/services/translation/serviceErrors.ts
 *
 * 文件职责：把未知 provider 异常转换为稳定、可读的服务错误文案，供连接测试和 UI 展示复用。
 * 主要内容：getServiceErrorMessage 从 Error、字符串或未知对象提取安全消息，formatServiceError 加入服务名称上下文而不泄漏任意结构。 可核对的公开符号包括 getServiceErrorMessage、formatServiceError。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

import {services} from '@/src/core/config/catalog';

export function getServiceErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 将供应商常见鉴权错误转换为可执行的设置提示，同时不暴露用户凭据。 */
export function formatServiceError(service: string, error: unknown): string {
    const message = getServiceErrorMessage(error).trim() || '未知错误';

    if (service === services.minimax && (/401|unauthorized|2049|invalid api key/i.test(message))) {
        return 'MiniMax API Key 无效（错误码 2049）。如果 Key 以 sk-cp- 开头，它是 Token Plan Key：请确认订阅仍有效，并选择与 Key 来源匹配的区域；中国版使用 api.minimaxi.com，全球版使用 api.minimax.io。Token Plan Key 与按量付费 API Key 不能互换。';
    }

    if (service === services.mimo && (/401|unauthorized|invalid api key/i.test(message))) {
        return '小米 MiMo API Key 无效或集群不匹配。按量付费 Key 通常以 sk- 开头，Token Plan Key 以 tp- 开头；Token Plan 还必须选择购买页面对应的中国、新加坡或欧洲集群。';
    }

    if (/failed to fetch|networkerror|网络错误|请求超时/i.test(message)) {
        return `网络连接失败：${message}`;
    }

    return message;
}
