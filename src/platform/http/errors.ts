/**
 * @file src/platform/http/errors.ts
 *
 * 文件职责：封装 provider HTTP 与 JSON 响应的安全错误构造，统一状态文案和外部错误码长度限制。
 * 主要内容：提供 createHttpStatusError、getSafeProviderErrorCode、createProviderCodeError 与 readJsonResponse，在协议适配器中复用并避免直接信任任意响应字段；图片错误仅保留明确模态拒绝的布尔标记，绝不回显第三方正文。 可核对的公开符号包括 createHttpStatusError、getSafeProviderErrorCode、createProviderCodeError、readJsonResponse。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

type HttpStatus = Pick<Response, 'status' | 'statusText'> & {headers?: Pick<Headers, 'get'>};
type JsonResponse = Pick<Response, 'json'>;
import {isExplicitImageInputRejection} from '@/src/core/config/visionProbe';

const MAX_PROVIDER_CODE_LENGTH = 16;

/**
 * 构造不回显第三方响应正文的 HTTP 错误。
 * 正文可能包含原文、译文、provider 诊断或代理回显的凭据，因此只暴露协议状态码。
 */
export function createHttpStatusError(response: HttpStatus, label = '请求失败'): Error {
    const retryAfter = response.headers?.get('Retry-After');
    let retryAfterMs: number | undefined;
    if (retryAfter?.trim()) {
        const value = retryAfter.trim();
        const duration = /^\d+(?:\.\d+)?$/u.test(value)
            ? Number(value) * 1000 : Date.parse(value) - Date.now();
        if (Number.isFinite(duration) && duration > 0) retryAfterMs = Math.min(duration, 7 * 86_400_000);
    }
    return Object.assign(new Error(`${label}: ${response.status}`), {
        statusCode: response.status,
        ...(retryAfterMs === undefined ? {} : {retryAfterMs}),
    });
}

/** 图片错误只提取可验证的能力标记，第三方正文不进入错误、日志或能力缓存。 */
export async function createImageInputHttpError(response: Response, label = '请求失败'): Promise<Error> {
    const error = createHttpStatusError(response, label);
    if (response.status !== 400 && response.status !== 422) return error;
    try {
        const body = await response.clone().json();
        const detail = body?.error?.message ?? body?.message;
        if (typeof detail === 'string' && detail.length <= 2048 && isExplicitImageInputRejection(response.status, detail)) {
            Object.assign(error, {imageInputUnsupported: true});
        }
    } catch { /* 非 JSON 或未知错误只保留 HTTP 状态，不能认定模型没有视觉能力。 */ }
    return error;
}

/** 只有短小且确实形似数字错误码的 provider 字段可以回显。 */
export function getSafeProviderErrorCode(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;

    const code = String(value).trim();
    if (
        code.length === 0
        || code.length > MAX_PROVIDER_CODE_LENGTH
        || !/^\d+$/.test(code)
    ) {
        return undefined;
    }
    return code;
}

export function createProviderCodeError(label: string, value: unknown): Error {
    const code = getSafeProviderErrorCode(value);
    return new Error(code ? `${label}（错误码 ${code}）` : label);
}

/**
 * 解析第三方 JSON，但不传播 parser 自带的输入预览。
 * V8 的 SyntaxError 可能包含损坏 JSON 的片段，其中可能有原文或代理诊断。
 */
export async function readJsonResponse<T = unknown>(
    response: JsonResponse,
    label = '返回的不是有效 JSON',
): Promise<T> {
    try {
        return await response.json() as T;
    } catch {
        throw new Error(label);
    }
}
