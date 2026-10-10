/**
 * @file src/core/config/visionProbe.ts
 * 文件职责：定义模型识图探测身份、缓存有效期与确定性结果校验。
 * 主要内容：绑定服务、模型、请求协议和既有凭据配置指纹，校验有界缓存记录；只接受严格匹配的图片答案或明确的图片输入拒绝。
 * 模块边界：纯策略，不保存原始密钥、图片、模型回答或错误正文，不发网络请求；运行和持久化由 services/platform 负责。
 */
import {createApiKeyCheckRevision, type ApiKeyCheckIdentitySource} from './apiKeyCheckIdentity';
import {sha256Hex} from '@/src/shared/function/sha256';
import {resolveModelVisionCapability, supportsVisionTransport, type ModelVisionCapability, type ModelVisionOverrides} from './vision';

export const VISION_PROBE_TTL_MS = 7 * 86_400_000;
export const VISION_PROBE_TIMEOUT_MS = 30_000;
export interface VisionProbeRecord {identity: string; capability: 'supported' | 'unsupported'; checkedAt: number;}
export interface VisionProbeResult {capability: ModelVisionCapability; source: 'override' | 'rule' | 'probe' | 'unknown'; checkedAt?: number;}
export function createVisionProbeIdentity(source: ApiKeyCheckIdentitySource, service: string, model: string): string {
    return sha256Hex(JSON.stringify(['vision-probe-v1', service, model, createApiKeyCheckRevision(source, service)]));
}
export function normalizeVisionProbeRecords(value: unknown, now: number): VisionProbeRecord[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is VisionProbeRecord => Boolean(item && typeof item === 'object'
        && /^[a-f0-9]{64}$/u.test(item.identity) && ['supported', 'unsupported'].includes(item.capability)
        && Number.isSafeInteger(item.checkedAt) && item.checkedAt <= now && now - item.checkedAt < VISION_PROBE_TTL_MS))
        .sort((a, b) => b.checkedAt - a.checkedAt).slice(0, 100)
        .map(({identity, capability, checkedAt}) => ({identity, capability, checkedAt}));
}
export function matchesVisionProbeAnswer(value: unknown, answer: string): boolean {
    return typeof value === 'string' && value.trim().toUpperCase() === answer;
}
/** 设置界面与运行时使用相同的手动、缓存和规则优先级，未知状态不会伪装为测试成功。 */
export function resolveVisionCapabilityWithProbe(source: ApiKeyCheckIdentitySource & {modelVision?: ModelVisionOverrides},
    service: string, model: string, records: unknown, now: number): VisionProbeResult {
    const rule = resolveModelVisionCapability(service, model, source.modelVision);
    if (!supportsVisionTransport(service, model)) return {capability: 'unsupported', source: 'rule'};
    if (typeof source.modelVision?.[service]?.[model] === 'boolean') return {capability: rule, source: 'override'};
    const identity = createVisionProbeIdentity(source, service, model);
    const record = normalizeVisionProbeRecords(records, now).find(item => item.identity === identity);
    return record ? {capability: record.capability, source: 'probe', checkedAt: record.checkedAt}
        : {capability: rule, source: rule === 'unknown' ? 'unknown' : 'rule'};
}

/** 只匹配图片模态的明确拒绝；图片损坏、大小超限或一般 400 不能判为不支持。 */
export function isExplicitImageInputRejection(status: number | undefined, detail: string): boolean {
    return (status === 400 || status === 422) && /(?:does not support|do not support|doesn't support|cannot accept|not supported|unsupported|不支持)[^\n.]{0,100}(?:image(?:s|_url)?|vision|图片|图像)|(?:image(?:s|_url)?|vision|图片|图像)[^\n.]{0,100}(?:not supported|unsupported|不支持)/iu.test(detail)
        && !/(?:format|mime|size|resolution|encoding|格式|尺寸|大小|编码)/iu.test(detail);
}
