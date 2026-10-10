/**
 * @file src/services/translation/freeRoutingPolicy.ts
 * 文件职责：把免费服务错误转换为有界恢复时间，并按权重选择可用服务。
 * 主要内容：区分故障并尊重恢复时间，结合峰值平滑耗时、可靠性与在途负载分流，计算慢请求的备用启动时间。
 * 模块边界：纯策略函数，不请求网络、不读存储、不保留网页正文或凭据。
 */
export type FreeFailureCategory = 'rate-limit' | 'quota' | 'blocked' | 'unavailable' | 'request';
export const MAX_FREE_COOLDOWN_MS = 7 * 86_400_000;

/** 后台维护近期可靠性和请求耗时的指数移动平均，不包含待译内容。 */
export interface FreeProviderPerformance {
    reliability: number;
    latencyMs: number;
    observedAt: number;
}

export function observeFreeProviderPerformance(
    previous: FreeProviderPerformance | undefined, success: boolean, latencyMs: number, now: number,
): FreeProviderPerformance {
    const observedLatency = Math.min(60_000, Math.max(1, latencyMs));
    return {
        reliability: (previous?.reliability ?? 1) * 0.75 + (success ? 0.25 : 0),
        // 变慢立即反映，变快平滑恢复；冷启动直接使用首个真实观测。
        latencyMs: success ? Math.max(observedLatency,
            (previous?.latencyMs ?? observedLatency) * 0.75 + observedLatency * 0.25)
            : previous?.latencyMs ?? 1000,
        observedAt: now,
    };
}

/** 老观测在一天内逐渐回到默认先验，避免一次历史故障永久压低恢复后的服务。 */
export function getDynamicFreeProviderWeight(
    baseWeight: number, performance: FreeProviderPerformance | undefined, now: number,
): number {
    if (!performance) return baseWeight;
    const age = Math.min(1, Math.max(0, now - performance.observedAt) / 86_400_000);
    const reliability = performance.reliability + (1 - performance.reliability) * age;
    const latency = performance.latencyMs + (1000 - performance.latencyMs) * age;
    return Math.max(0.05, baseWeight * reliability ** 2 * Math.min(4, 1000 / Math.max(1, latency)));
}

/** 仅明显慢于近期表现时争取备用，冷启动为 1.5 秒；短超时仍按用户设置执行。 */
export function getFreeHedgeDelayMs(performance?: FreeProviderPerformance): number {
    return Math.min(2000, Math.max(800, (performance?.latencyMs ?? 1000) * 1.5));
}

export function getFreeFailureStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as {statusCode?: unknown; status?: unknown};
    const value = record.statusCode ?? record.status;
    return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

export function classifyFreeFailure(error: unknown): FreeFailureCategory {
    const explicit = error && typeof error === 'object' ? (error as {freeFailure?: unknown}).freeFailure : undefined;
    if (explicit === 'request' || explicit === 'rate-limit' || explicit === 'quota'
        || explicit === 'blocked' || explicit === 'unavailable') return explicit;
    const status = getFreeFailureStatus(error);
    if (status === 402 || status === 456) return 'quota';
    if (status === 401 || status === 403) return 'blocked';
    if (status === 429) return 'rate-limit';
    // 固定供应商端点消失需要较长时间恢复；文本或语言错误不影响其他段落。
    if (status === 404 || status === 410) return 'blocked';
    if (status !== undefined && status >= 400 && status < 500 && status !== 408) return 'request';
    return 'unavailable';
}

export function getFreeFailureCooldown(
    error: unknown, consecutiveFailures: number, transientBaseMs: number, random: number,
): {category: FreeFailureCategory; durationMs: number} {
    const category = classifyFreeFailure(error);
    if (category === 'request') return {category, durationMs: 0};
    const retryAfter = error && typeof error === 'object' ? (error as {retryAfterMs?: unknown}).retryAfterMs : undefined;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
        return {category, durationMs: Math.min(MAX_FREE_COOLDOWN_MS, Math.max(1000, retryAfter))};
    }
    const exponent = Math.min(8, Math.max(0, consecutiveFailures - 1));
    const base = category === 'quota' ? 86_400_000
        : category === 'blocked' ? 6 * 3_600_000
        : category === 'rate-limit' ? 5 * 60_000 : Math.max(1000, transientBaseMs);
    const maximum = category === 'quota' ? 86_400_000
        : category === 'blocked' ? 86_400_000
        : category === 'rate-limit' ? 6 * 3_600_000 : 30 * 60_000;
    // 抖动只延后恢复，不提前消费服务端规定的等待窗口。
    const jitter = 1 + (Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0) * 0.2;
    return {category, durationMs: Math.min(MAX_FREE_COOLDOWN_MS, Math.round(Math.min(maximum, base * 2 ** exponent) * jitter))};
}

export function selectWeightedFreeCandidate<T extends {identity: string; weight?: number}>(
    candidates: readonly T[], random: number,
): T | undefined {
    // 不再强制避开上一条成功线路：两个服务时会退化为 50/50，抵消速度权重。
    const pool = candidates;
    if (!pool.length) return undefined;
    const weights = pool.map(candidate => typeof candidate.weight === 'number' && Number.isFinite(candidate.weight)
        ? Math.min(100, Math.max(0.05, candidate.weight)) : 1);
    let position = (Number.isFinite(random) ? Math.min(1 - Number.EPSILON, Math.max(0, random)) : 0)
        * weights.reduce((sum, weight) => sum + weight, 0);
    let selected = pool[pool.length - 1];
    for (let index = 0; index < pool.length; index += 1) {
        position -= weights[index]!;
        if (position < 0) {
            selected = pool[index];
            break;
        }
    }
    return selected;
}
