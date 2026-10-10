/**
 * @file src/services/translation/persistenceBarrier.ts
 * 文件职责：为翻译响应前的本地持久化提供短暂而有上限的等待窗口。
 * 主要内容：正常写入在响应前完成；失败会转为诊断，挂起超过宽限期后释放调用方，同时继续观察迟到失败以避免未处理拒绝。
 * 模块边界：本模块不拥有 IndexedDB、缓存代次或消息路由；调用方仍负责写入生命周期与清理语义。
 */

export const DEFAULT_TRANSLATION_PERSISTENCE_GRACE_MS = 400;

export interface BoundedPersistenceOptions {
    graceMs?: number;
    onFailure(error: unknown): void;
    onTimeout(error: Error): void;
}

function normalizeGraceMs(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : DEFAULT_TRANSLATION_PERSISTENCE_GRACE_MS;
}

/** 等待快速持久化；超时只释放响应，底层 Promise 仍由原所有者跟踪到真实结束。 */
export async function waitForBoundedPersistence(
    operation: PromiseLike<unknown>,
    options: BoundedPersistenceOptions,
): Promise<void> {
    const observed = Promise.resolve(operation).then(
        () => undefined,
        (error) => {
            try {
                options.onFailure(error);
            } catch {
                // 诊断回调也是旁路能力，不能重新阻断翻译响应。
            }
        },
    );
    const graceMs = normalizeGraceMs(options.graceMs);
    let timer!: ReturnType<typeof setTimeout>;
    const completed = await Promise.race([
        observed.then(() => true),
        new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), graceMs);
        }),
    ]);
    clearTimeout(timer);
    if (!completed) {
        try {
            options.onTimeout(new Error(`本地持久化超过 ${graceMs} ms 宽限期`));
        } catch {
            // 同上：自定义诊断器失败不改变持久化宽限语义。
        }
    }
}
