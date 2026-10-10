/**
 * @file src/core/config/deepl.ts
 * 文件职责：定义 DeepL API 套餐及官方端点，供配置归一化、请求和缓存身份共同使用。
 * 主要内容：归一化 API Free / Pro 套餐，优先使用有效代理，否则返回对应官方翻译端点。
 * 模块边界：仅做纯配置转换，不读取存储或发起网络请求。
 */

export type DeepLApiPlan = 'free' | 'pro';

export const DEFAULT_DEEPL_API_PLAN: DeepLApiPlan = 'free';

export const DEEPL_API_ENDPOINTS: Readonly<Record<DeepLApiPlan, string>> = Object.freeze({
    free: 'https://api-free.deepl.com/v2/translate',
    pro: 'https://api.deepl.com/v2/translate',
});

export function normalizeDeepLApiPlan(value: unknown): DeepLApiPlan {
    return value === 'pro' ? 'pro' : DEFAULT_DEEPL_API_PLAN;
}

export function getDeepLEndpoint(plan: unknown, proxy?: unknown): string {
    const customEndpoint = typeof proxy === 'string' ? proxy.trim() : '';
    return customEndpoint || DEEPL_API_ENDPOINTS[normalizeDeepLApiPlan(plan)];
}
