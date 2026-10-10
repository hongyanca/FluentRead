/**
 * @file src/services/translation/freeFallback.ts
 * 文件职责：在健康免费服务间加权均衡并自动回退，持久遵守各类错误的恢复窗口。
 * 主要内容：协调总预算、单次超时、服务并发与间隔、错误退避、恢复单探测、异步持久化、有预算的延迟备用竞争、取消代际保护；在线路容量或间隔等待时归还全局许可并于唤醒后重新校验，结构化区分总截止时间和线路耗尽，把特定文本的原文回显或明显错语种结果作为不冷却线路的请求失败，并向调用方旁路上报每次线路尝试的结果与耗时。
 * 模块边界：只接收匿名身份、provider 回调和注入的存储端口；不读取用户配置或供应商凭据。
 */
import {abortErrorFromSignal} from '@/src/platform/http/runtime';
import {FREE_TRANSLATION_TOTAL_TIMEOUT_MS} from '@/src/core/config/freeTranslation';
import {
    getFreeFailureStatus, getFreeFailureCooldown, selectWeightedFreeCandidate, getFreeHedgeDelayMs,
    MAX_FREE_COOLDOWN_MS, type FreeFailureCategory,
    getDynamicFreeProviderWeight, observeFreeProviderPerformance, type FreeProviderPerformance,
} from './freeRoutingPolicy';

export interface FreeFallbackCandidate {
    readonly identity: string;
    readonly label: string;
    readonly weight?: number;
    readonly maxConcurrency?: number;
    readonly minIntervalMs?: number;
    readonly translate: (signal: AbortSignal) => Promise<unknown>;
}
export type FreeFallbackAttemptOutcome = 'success' | 'error' | 'timeout' | 'cancelled';
export interface FreeFallbackAttempt {
    readonly identity: string;
    readonly outcome: FreeFallbackAttemptOutcome;
    readonly durationMs: number;
}
export interface FreeFallbackOptions {
    readonly signal?: AbortSignal;
    /** 每次真实线路尝试结束后的旁路观察；只接收身份、结果和耗时。 */
    readonly onAttempt?: (attempt: FreeFallbackAttempt) => void;
    readonly timeoutMs: number;
    readonly cooldownMs: number;
    readonly mode?: 'balanced' | 'sequential';
    /** 同一批次共享截止时间，排队与各备用服务共同消费预算。 */
    readonly deadline?: number;
}
export interface PersistedFreeHealth {
    identity: string;
    retryAt: number;
    failures: number;
    category: FreeFailureCategory;
    performance?: FreeProviderPerformance;
}
export interface FreeHealthPersistence {
    load(): Promise<unknown>;
    save(entries: readonly PersistedFreeHealth[]): Promise<void>;
}
export interface FreeFallbackDependencies {
    readonly random?: () => number;
    readonly persistence?: FreeHealthPersistence;
}
export interface FreeFallbackRunner {
    (candidates: readonly FreeFallbackCandidate[], options: FreeFallbackOptions): Promise<string>;
    /** 读取当前后台 worker 的健康快照；快照只包含服务身份摘要和时间/性能数据。 */
    getHealthSnapshot(): Promise<readonly PersistedFreeHealth[]>;
}
interface Health {
    retryAt: number;
    generation: number;
    probing: boolean;
    failures: number;
    category: FreeFailureCategory;
    active: number;
    nextAttemptAt: number;
    performance?: FreeProviderPerformance;
}
class AttemptTimeoutError extends Error { readonly kind = 'timeout'; readonly retryable = false; constructor() { super('请求超时'); } }
class FreePoolExhaustedError extends Error { readonly kind = 'provider'; readonly retryable = false; }

/** 响应只对当前文本无效，换线重试但不降低该服务对其他文本的权重。 */
export class UntranslatedFreeResultError extends Error {
    readonly freeFailure = 'request';
    constructor() { super('返回未翻译原文'); }
}

export class WrongLanguageFreeResultError extends Error {
    readonly freeFailure = 'request';
    constructor() { super('返回的译文语言与目标语言不符'); }
}

function attemptOutcome(error: unknown, signal?: AbortSignal): FreeFallbackAttemptOutcome {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return 'cancelled';
    return error instanceof AttemptTimeoutError ? 'timeout' : 'error';
}
class InvalidTranslationError extends Error { constructor() { super('未返回有效译文'); } }

function safeFailure(error: unknown): string {
    const status = getFreeFailureStatus(error);
    if (status !== undefined) return `HTTP ${status}`;
    if (error instanceof AttemptTimeoutError || error instanceof InvalidTranslationError
        || error instanceof UntranslatedFreeResultError || error instanceof WrongLanguageFreeResultError) return error.message;
    return '请求失败';
}

async function runAttempt(candidate: FreeFallbackCandidate, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const result = new Promise<string>((resolve, reject) => {
        onAbort = () => { reject(abortErrorFromSignal(signal!)); controller.abort(signal?.reason); };
        signal?.addEventListener('abort', onAbort, {once: true});
        timer = setTimeout(() => { reject(new AttemptTimeoutError()); controller.abort(); }, timeoutMs);
        Promise.resolve().then(() => {
            if (controller.signal.aborted) throw abortErrorFromSignal(controller.signal);
            return candidate.translate(controller.signal);
        }).then(value => {
            if (typeof value !== 'string' || !value.trim()) reject(new InvalidTranslationError());
            else resolve(value);
        }, reject);
    });
    try { return await result; }
    finally { clearTimeout(timer!); signal?.removeEventListener('abort', onAbort!); }
}

/** 存储故障或挂起不阻断翻译；迟到的加载值不会覆盖已开始服务的健康状态。 */
async function boundedStorage<T>(request: Promise<T>, limitMs = 1000, signal?: AbortSignal): Promise<T | undefined> {
    // 调用方已在同一同步段检查取消；此处只监听等待期间发生的取消。
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: (() => void) | undefined;
    try {
        return await Promise.race([
            request.catch(() => undefined),
            new Promise<undefined>((resolve, reject) => {
                timer = setTimeout(() => resolve(undefined), Math.max(0, limitMs));
                onAbort = () => reject(abortErrorFromSignal(signal!));
                signal?.addEventListener('abort', onAbort, {once: true});
            }),
        ]);
    } finally { clearTimeout(timer!); if (onAbort) signal?.removeEventListener('abort', onAbort); }
}

export function createFreeFallbackRunner(maxConcurrency = 3, dependencies: FreeFallbackDependencies = {}): FreeFallbackRunner {
    const health = new Map<string, Health>();
    const queue: Array<{deadline: number; wake: () => void}> = [];
    const availabilityWaiters = new Set<() => void>();
    const concurrency = Math.max(1, Math.floor(maxConcurrency));
    const random = dependencies.random ?? Math.random;
    let active = 0;
    // 全局最多一条额外在途线路；初始允许一次，之后每五次成功补充一次。
    let hedgeActive = false;
    let hedgeCredit = 1;
    let loaded: Promise<void> | undefined;
    let saving: Promise<void> | undefined;
    let pendingSave: readonly PersistedFreeHealth[] | undefined;

    function getHealth(identity: string): Health {
        let state = health.get(identity);
        if (!state) {
            state = {retryAt: 0, generation: 0, probing: false, failures: 0, category: 'unavailable', active: 0, nextAttemptAt: 0};
            health.set(identity, state);
            if (health.size > 128) {
                const evict = [...health].find(([key, item]) => key !== identity && !item.active && !item.probing);
                if (evict) health.delete(evict[0]);
            }
        } else {
            health.delete(identity);
            health.set(identity, state);
        }
        return state;
    }

    async function loadHealth(): Promise<void> {
        loaded ??= (async () => {
            const entries = await boundedStorage(Promise.resolve().then(() => dependencies.persistence!.load()));
            if (!Array.isArray(entries)) return;
            for (const entry of entries.slice(0, 128)) {
                if (!entry || typeof entry !== 'object') continue;
                const {identity, retryAt, failures, category, performance} = entry as Partial<PersistedFreeHealth>;
                const validPerformance = performance && typeof performance === 'object'
                    && Number.isFinite(performance.reliability) && performance.reliability >= 0 && performance.reliability <= 1
                    && Number.isFinite(performance.latencyMs) && performance.latencyMs >= 1 && performance.latencyMs <= 60_000
                    && Number.isFinite(performance.observedAt) && performance.observedAt >= 0;
                if (typeof identity !== 'string' || !/^[a-zA-Z0-9:._-]{1,160}$/u.test(identity)
                    || typeof retryAt !== 'number' || !Number.isFinite(retryAt) || retryAt < 0
                    || typeof failures !== 'number' || !Number.isInteger(failures) || failures < 0 || failures > 100
                    || (failures === 0 && !validPerformance)
                    || !['rate-limit', 'quota', 'blocked', 'unavailable', 'request'].includes(category as string)) continue;
                const state = getHealth(identity);
                state.retryAt = Math.min(retryAt, Date.now() + MAX_FREE_COOLDOWN_MS);
                state.failures = failures;
                state.category = category!;
                if (validPerformance) state.performance = {
                    reliability: performance.reliability, latencyMs: performance.latencyMs,
                    observedAt: Math.min(Date.now(), performance.observedAt),
                };
            }
        })();
        await loaded;
    }

    function persistHealth(): void {
        const persistence = dependencies.persistence;
        if (!persistence) return;
        pendingSave = [...health].filter(([, item]) => item.failures > 0 || item.performance).slice(-128)
            .map(([identity, item]) => ({identity, retryAt: item.retryAt, failures: item.failures, category: item.category,
                ...(item.performance ? {performance: {...item.performance}} : {}),
            }));
        // 写入按变更顺序串行，旧失败不能在恢复成功之后把冷却写回磁盘。
        // 挂起期间只保留最新快照，不为每个失败段落积累 Promise/旧状态队列。
        saving ??= Promise.resolve().then(async () => {
            while (pendingSave) {
                const entries = pendingSave;
                pendingSave = undefined;
                try { await persistence.save(entries); } catch { /* 存储失败不阻断翻译。 */ }
            }
        }).finally(() => { saving = undefined; });

    }

    async function acquire(deadline: number, signal?: AbortSignal): Promise<() => void> {
        if (Date.now() >= deadline) throw new AttemptTimeoutError();
        if (signal?.aborted) throw abortErrorFromSignal(signal);
        if (active >= concurrency) {
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    const index = queue.findIndex(item => item.wake === onReady);
                    if (index >= 0) queue.splice(index, 1);
                };
                const onReady = () => { cleanup(); resolve(); };
                const onAbort = () => { cleanup(); reject(abortErrorFromSignal(signal!)); };
                const timer = setTimeout(() => { cleanup(); reject(new AttemptTimeoutError()); }, Math.max(1, deadline - Date.now()));
                signal?.addEventListener('abort', onAbort, {once: true});
                // 同一批次的后续槽仍沿用原截止时间；优先服务更早到期的请求，
                // 避免持续到达的新段落把已完成大半的旧批次排到队尾耗尽预算。
                let low = 0, high = queue.length;
                while (low < high) {
                    const middle = (low + high) >>> 1;
                    if (queue[middle]!.deadline <= deadline) low = middle + 1;
                    else high = middle;
                }
                // 相同截止时间保持到达顺序，取消/到期仍由每个等待者自己的句柄清理。
                queue.splice(low, 0, {deadline, wake: onReady});
            });
        } else active += 1;
        return () => { const next = queue.shift(); if (next) next.wake(); else active -= 1; };
    }

    async function waitForAvailability(durationMs: number, signal?: AbortSignal): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => { clearTimeout(timer); availabilityWaiters.delete(wake); signal?.removeEventListener('abort', onAbort); };
            const wake = () => { cleanup(); resolve(); };
            const onAbort = () => { cleanup(); reject(abortErrorFromSignal(signal!)); };
            const timer = setTimeout(wake, Math.max(1, durationMs));
            availabilityWaiters.add(wake);
            signal?.addEventListener('abort', onAbort, {once: true});
        });
    }

    const execute = async (candidates: readonly FreeFallbackCandidate[], options: FreeFallbackOptions): Promise<string> => {
        if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
        if (!candidates.length) throw new FreePoolExhaustedError('免费翻译服务均不可用：未选择可用的免密钥服务');
        const deadline = Math.min(options.deadline ?? Infinity, Date.now() + FREE_TRANSLATION_TOTAL_TIMEOUT_MS);
        if (dependencies.persistence) await boundedStorage(loadHealth(), Math.min(1000, deadline - Date.now()), options.signal);
        // 保留首次调度前的异步取消边界，但不为不可用线路领取全局许可。
        await Promise.resolve();
        let release: () => void = () => undefined;
        let ownsPermit = false;
        const attempted = new Set<string>();
        const failures: string[] = [];
        let hedged = false;
        const pendingCandidates = () => candidates.filter(item => !attempted.has(item.identity));
        const readyCandidates = () => pendingCandidates().filter(candidate => {
            const state = getHealth(candidate.identity);
            return state.retryAt <= Date.now() && !state.probing
                && state.active < (candidate.maxConcurrency ?? Infinity) && state.nextAttemptAt <= Date.now();
        });
        const choose = (ready: readonly FreeFallbackCandidate[]) => {
            if (options.mode !== 'balanced') return ready[0];
            return selectWeightedFreeCandidate(ready.map(candidate => ({...candidate,
                weight: getDynamicFreeProviderWeight(candidate.weight ?? 1, getHealth(candidate.identity).performance, Date.now())
                    / (getHealth(candidate.identity).active + 1),
            })), random());
        };
        const observe = (attempt: FreeFallbackAttempt) => {
            // 统计是旁路，观察器故障不能触发换线、重复上报或吞掉有效译文。
            try { options.onAttempt?.(attempt); } catch { /* 观察失败不改变翻译。 */ }
        };
        type Outcome = {value: string} | {error: unknown};
        const attempt = async (candidate: FreeFallbackCandidate, signal: AbortSignal): Promise<Outcome> => {
            attempted.add(candidate.identity);
            const state = getHealth(candidate.identity);
            const generation = state.generation;
            const probing = state.failures > 0;
            if (probing) state.probing = true;
            state.active += 1;
            state.nextAttemptAt = Date.now() + Math.max(0, candidate.minIntervalMs ?? 0);
            const startedAt = Date.now();
            const remaining = deadline - startedAt;
            let outcome: Outcome;
            try {
                const result = await runAttempt(candidate, Math.min(options.timeoutMs, remaining), signal);
                if (signal.aborted) throw abortErrorFromSignal(signal);
                observe({identity: candidate.identity, outcome: 'success', durationMs: Date.now() - startedAt});
                state.generation += 1;
                state.retryAt = 0;
                state.failures = 0;
                state.performance = observeFreeProviderPerformance(state.performance, true, Date.now() - startedAt, Date.now());
                persistHealth();
                outcome = {value: result};
            } catch (error) {
                observe({identity: candidate.identity, outcome: attemptOutcome(error, signal), durationMs: Date.now() - startedAt});
                if (signal.aborted) return {error: abortErrorFromSignal(signal)};
                if (error instanceof Error && error.name === 'AbortError') return {error};
                if (error instanceof AttemptTimeoutError && remaining < options.timeoutMs && Date.now() >= deadline) return {error};
                const cooldown = getFreeFailureCooldown(error, state.failures + 1, options.cooldownMs, random());
                // 原文回显、错语种、长度等只属于当前文本，不暂停其他段落的线路。
                if (state.generation === generation && cooldown.durationMs > 0) {
                    state.performance = observeFreeProviderPerformance(state.performance, false, Date.now() - startedAt, Date.now());
                    state.generation += 1;
                    state.retryAt = Date.now() + cooldown.durationMs;
                    state.failures = Math.min(100, state.failures + 1);
                    state.category = cooldown.category;
                    persistHealth();
                }
                failures.push(`${candidate.label}: ${safeFailure(error)}`);
                outcome = {error};
            } finally {
                state.active -= 1;
                if (probing) state.probing = false;
                [...availabilityWaiters].forEach(wake => wake());
            }
            return outcome;
        };
        try {
            while (pendingCandidates().length) {
                if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new AttemptTimeoutError();
                const ready = readyCandidates();
                if (!ready.length) {
                    const waiting = pendingCandidates().filter(item => getHealth(item.identity).retryAt <= Date.now());
                    if (!waiting.length) break;
                    const nextInterval = Math.min(...waiting.map(item => {
                        const time = getHealth(item.identity).nextAttemptAt - Date.now();
                        return time > 0 ? time : remaining;
                    }));
                    // 等线路容量或间隔时没有在途 attempt，不能占住全局许可阻塞其他可用线路。
                    // 先放弃本次许可所有权；等待失败时 finally 只调用空操作，避免重复归还。
                    release();
                    release = () => undefined;
                    ownsPermit = false;
                    await waitForAvailability(Math.min(remaining, nextInterval), options.signal);
                    continue;
                }
                if (!ownsPermit) {
                    // 没有可用线路的 owner 不进入全局队列；取得许可后重新校验线路容量和取消。
                    release = await acquire(deadline, options.signal);
                    ownsPermit = true;
                    continue;
                }
                // ready 已通过非空检查；两种选择策略都从该数组返回一项。
                const candidate = choose(ready)!;
                const controller = new AbortController();
                const onAbort = () => controller.abort(options.signal?.reason);
                options.signal?.addEventListener('abort', onAbort, {once: true});
                let timer: ReturnType<typeof setTimeout> | undefined;
                let ownsHedge = false;
                const primary = attempt(candidate, controller.signal);
                let backup: Promise<Outcome> | undefined;
                try {
                    const delay = getFreeHedgeDelayMs(getHealth(candidate.identity).performance);
                    const canHedge = options.mode === 'balanced' && !hedged && !hedgeActive && hedgeCredit >= 1
                        && pendingCandidates().length > 0 && delay < Math.min(options.timeoutMs, remaining);
                    let outcome = canHedge ? await Promise.race([
                        primary,
                        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), delay); }),
                    ]) : await primary;
                    if (!outcome) {
                        // 延迟到期后重新检查容量、冷却与预算，不挤占已在限流中的线路。
                        const alternative = !controller.signal.aborted && !hedgeActive && hedgeCredit >= 1
                            ? choose(readyCandidates()) : undefined;
                        if (alternative) {
                            hedged = true;
                            ownsHedge = hedgeActive = true;
                            hedgeCredit -= 1;
                            backup = attempt(alternative, controller.signal);
                            const first = await Promise.race([
                                primary.then(result => ({result, other: backup!})),
                                backup.then(result => ({result, other: primary})),
                            ]);
                            outcome = 'value' in first.result ? first.result : await first.other;
                        } else outcome = await primary;
                    }
                    if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
                    if ('value' in outcome) {
                        hedgeCredit = Math.min(1, hedgeCredit + 0.2);
                        return outcome.value;
                    }
                    if (outcome.error instanceof Error && outcome.error.name === 'AbortError') throw outcome.error;
                    if (Date.now() >= deadline) throw new AttemptTimeoutError();
                } finally {
                    clearTimeout(timer);
                    controller.abort();
                    options.signal?.removeEventListener('abort', onAbort);
                    // runAttempt 会立即处理取消，即便供应商忽略信号也不占着调度槽。
                    await Promise.all([primary, backup]);
                    if (ownsHedge) hedgeActive = false;
                    if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
                }
            }
            const reason = failures.length ? failures.join('；') : '所选服务正在冷却，请稍后重试';
            throw new FreePoolExhaustedError(`免费翻译服务均不可用：${reason}`);
        } finally { release(); }
    };

    const getHealthSnapshot = async (): Promise<readonly PersistedFreeHealth[]> => {
        if (dependencies.persistence) await boundedStorage(loadHealth(), 1_000);
        return [...health]
            .filter(([, item]) => item.failures > 0 || item.performance)
            .map(([identity, item]) => ({
                identity,
                retryAt: item.retryAt,
                failures: item.failures,
                category: item.category,
                ...(item.performance ? {performance: {...item.performance}} : {}),
            }));
    };
    return Object.assign(execute, {getHealthSnapshot});
}
