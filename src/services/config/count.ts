/**
 * @file src/services/config/count.ts
 * 文件职责：定义翻译计数增量的跨上下文协议、输入约束与可重试延迟队列，避免调用方为一次计数变化提交整份配置。
 * 主要内容：校验有界增量和幂等 operationId，生成客户端操作标识，并把高频计数合并为保留失败批次的单飞持久化任务。
 * 模块边界：本文件不读取当前配置、不修改历史也不直接访问存储或 runtime；原子累加由配置 store 完成，消息发送由 translation client 注入。
 */
export const CONFIG_COUNT_INCREMENT_MESSAGE = 'incrementConfigCount' as const;
export const CONFIG_COUNT_INCREMENT_MAX = 100_000;
const CONFIG_COUNT_OPERATION_ID_MAX_LENGTH = 128;

let operationSequence = 0;

export function parseConfigCountIncrement(value: unknown): number | null {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        && value <= CONFIG_COUNT_INCREMENT_MAX
        ? value
        : null;
}

export function parseConfigCountOperationId(value: unknown): string | null {
    return typeof value === 'string'
        && value.length >= 8
        && value.length <= CONFIG_COUNT_OPERATION_ID_MAX_LENGTH
        && /^[A-Za-z0-9._:-]+$/u.test(value)
        ? value
        : null;
}

/** 为一次待持久化批次生成稳定标识；同一批的全部重试必须复用该值。 */
export function createConfigCountOperationId(): string {
    operationSequence = (operationSequence + 1) % Number.MAX_SAFE_INTEGER;
    const randomPart = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `count-${Date.now().toString(36)}-${operationSequence.toString(36)}-${randomPart}`;
}

export interface ConfigCountPersistenceQueueOptions {
    delayMs: number;
    retryDelayMs: number;
    maxAutomaticRetries: number;
    persist(delta: number, operationId: string): Promise<unknown>;
    onError?(error: unknown): void;
    createOperationId?(): string;
}

export interface ConfigCountPersistenceQueue {
    record(delta?: number): void;
    flush(): Promise<void>;
}

interface CountPersistenceBatch {
    delta: number;
    operationId: string;
    failures: number;
}

/**
 * 合并高频增量，并在失败时保留原批次及 operationId。自动重试达到上限后，
 * 数据仍留在内存中，下一次用户活动或生命周期 flush 会重新尝试。
 */
export function createConfigCountPersistenceQueue(
    options: ConfigCountPersistenceQueueOptions,
): ConfigCountPersistenceQueue {
    const delayMs = Math.max(0, options.delayMs);
    const retryDelayMs = Math.max(1, options.retryDelayMs);
    const maxAutomaticRetries = Math.max(0, Math.trunc(options.maxAutomaticRetries));
    const pendingBatches: number[] = [];
    let retryBatch: CountPersistenceBatch | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    let recordedWhileInFlight = false;

    const hasWork = () => retryBatch !== null || pendingBatches.length > 0;
    const clearTimer = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    const arm = (delay: number) => {
        if (timer !== undefined || inFlight) return;
        timer = setTimeout(() => {
            timer = undefined;
            void drain();
        }, delay);
    };
    const nextBatch = (): CountPersistenceBatch => {
        if (retryBatch) return retryBatch;
        // record 已把待处理增量切成有界批次；drain 只会在 hasWork 为真时调用。
        const delta = pendingBatches.shift()!;
        retryBatch = {
            delta,
            operationId: (options.createOperationId ?? createConfigCountOperationId)(),
            failures: 0,
        };
        return retryBatch;
    };
    const drain = (): Promise<void> => {
        if (inFlight) return inFlight;
        const batch = nextBatch();
        recordedWhileInFlight = false;
        let failed = false;
        let persistence: Promise<unknown>;
        try {
            // flush 需要在当前调用栈内发出 runtime 消息，避免页面销毁前只排入微任务却尚未提交。
            persistence = Promise.resolve(options.persist(batch.delta, batch.operationId));
        } catch (error) {
            persistence = Promise.reject(error);
        }
        const work = persistence
            .then(() => {
                retryBatch = null;
            }, (error) => {
                failed = true;
                batch.failures += 1;
                options.onError?.(error);
            })
            .finally(() => {
                inFlight = null;
                if (!hasWork()) return;
                if (!failed) {
                    arm(delayMs);
                    return;
                }
                if (batch.failures <= maxAutomaticRetries) {
                    const exponent = Math.min(batch.failures - 1, 5);
                    arm(retryDelayMs * (2 ** exponent));
                    return;
                }
                if (recordedWhileInFlight) {
                    batch.failures = 0;
                    arm(delayMs);
                }
            });
        inFlight = work;
        return work;
    };

    return {
        record(delta = 1) {
            const normalizedDelta = parseConfigCountIncrement(delta);
            if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
            const lastIndex = pendingBatches.length - 1;
            const lastBatch = pendingBatches[lastIndex];
            if (lastBatch !== undefined && lastBatch + normalizedDelta <= CONFIG_COUNT_INCREMENT_MAX) {
                pendingBatches[lastIndex] = lastBatch + normalizedDelta;
            } else {
                pendingBatches.push(normalizedDelta);
            }
            if (inFlight) recordedWhileInFlight = true;
            if (retryBatch && retryBatch.failures > maxAutomaticRetries) retryBatch.failures = 0;
            arm(delayMs);
        },
        async flush() {
            clearTimer();
            if (inFlight) await inFlight;
            if (retryBatch && retryBatch.failures > maxAutomaticRetries) retryBatch.failures = 0;
            while (hasWork()) {
                const batch = retryBatch;
                await drain();
                // 失败批次已重新排定；flush 不在同一调用栈内无界重试。
                if (retryBatch && retryBatch === batch) break;
                clearTimer();
            }
        },
    };
}
