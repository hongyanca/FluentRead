/**
 * @file src/providers/translation/responses-api.ts
 *
 * 文件职责：集中处理 OpenAI Responses 协议的共用细节，让 DeepSeek、火山方舟等多家兼容端点复用同一套路由改写与输出文本读取规则。
 * 主要内容：buildOpenAIApiEndpoint 在 chat/completions 与 responses 之间互换路径并保留查询与 hash，readResponsesApiText 优先读取 output_text，其次按 output[].content[].output_text 拼接助手文本。 可核对的公开符号包括 OpenAIApiRoute、buildOpenAIApiEndpoint、readResponsesApiText。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

export type OpenAIApiRoute = 'chat' | 'responses';

const ROUTE_PATHS: Readonly<Record<OpenAIApiRoute, string>> = Object.freeze({
    chat: 'chat/completions',
    responses: 'responses',
});

const ROUTE_SUFFIX_PATTERN = /\/(?:chat\/completions|responses)\/?$/u;

/** 把配置中的端点改写为目标协议路径，供用户只填写其中一种地址时自动补全。 */
export function buildOpenAIApiEndpoint(endpoint: string, route: OpenAIApiRoute): string {
    const targetPath = ROUTE_PATHS[route];

    try {
        const url = new URL(endpoint);
        const basePath = url.pathname.replace(ROUTE_SUFFIX_PATTERN, '').replace(/\/+$/u, '');
        url.pathname = `${basePath}/${targetPath}`;
        return url.toString();
    } catch {
        // 兼容部分代理接受的非标准地址，同时确保查询参数和 hash 不会被拼到路径中。
        const match = endpoint.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/u);
        const path = (match?.[1] || endpoint)
            .replace(ROUTE_SUFFIX_PATTERN, '')
            .replace(/\/+$/u, '');
        return `${path}/${targetPath}${match?.[2] || ''}${match?.[3] || ''}`;
    }
}

/**
 * 读取 Responses API 的助手文本。缺少输出时返回空串，由各 provider 给出自己的错误文案；
 * 推理片段不是 output_text，因此不会被拼进页面译文。
 */
export function readResponsesApiText(result: unknown): string {
    const payload = result as {output_text?: unknown; output?: unknown} | null | undefined;
    if (typeof payload?.output_text === 'string' && payload.output_text) return payload.output_text;

    if (!Array.isArray(payload?.output)) return '';
    return payload.output
        .filter((item: any) => item?.type === 'message' && Array.isArray(item.content))
        .flatMap((item: any) => item.content)
        .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('');
}
