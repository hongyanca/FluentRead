/**
 * @file src/core/config/azure.ts
 *
 * 文件职责：统一 Azure 服务设置与实际请求使用的端点规则，支持资源根地址、v1 接口前缀和旧版部署地址。
 * 主要内容：normalizeAzureEndpoint 使用 URL 解析 HTTP(S) 地址，补全 Chat Completions 路径并保留查询参数；isValidAzureEndpoint 为设置界面提供同一规则的布尔校验。
 * 模块边界：本文件属于 core 配置领域层，只执行纯 URL 转换与校验，不读取配置存储、不发起网络请求，也不依赖 provider 或 UI。
 */

/** 将 Azure 资源或接口地址统一为可直接请求的 Chat Completions URL。 */
export function normalizeAzureEndpoint(rawEndpoint: string): string {
    const endpoint = rawEndpoint.trim();
    if (!endpoint) throw new Error('Azure 接口地址未配置');

    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error('Azure 端点地址格式不正确');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Azure 端点地址仅支持 HTTP 或 HTTPS 协议');
    }
    if (url.username || url.password) {
        throw new Error('Azure 端点地址不能包含用户名或密码，请在 API Key 中填写凭据');
    }

    const path = url.pathname.replace(/\/+$/, '');
    if (!path) {
        url.pathname = '/openai/v1/chat/completions';
    } else if (path === '/openai/v1' || path === '/v1') {
        url.pathname = `${path}/chat/completions`;
    } else if (/\/chat\/completions$/.test(path)) {
        // 保留旧版 deployments 路径与自定义网关前缀，不替换显式 api-version。
        url.pathname = path;
    } else {
        throw new Error('Azure 端点地址格式不正确，请填写资源根地址、v1 地址或完整的 Chat Completions 地址');
    }
    url.hash = '';
    return url.toString();
}

/** 设置保存前使用与请求端相同的规范化规则，避免界面通过而请求阶段拒绝。 */
export function isValidAzureEndpoint(rawEndpoint: string): boolean {
    try {
        normalizeAzureEndpoint(rawEndpoint);
        return true;
    } catch {
        return false;
    }
}
