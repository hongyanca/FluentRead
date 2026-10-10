/**
 * @file src/shared/onnx/resources.ts
 * 文件职责：为本地推理复用有界并行、WASM 线程选择和计算间歇预算，保留浏览器与用户任务的资源。
 * 主要内容：低核或低内存设备单任务，其余最多两个独立 Worker 任务；隔离且支持共享内存时每个 WASM 最多两个线程；推理与初始化按 70% 计算时间预算让出线程，为预处理与调度保留余量以控制持续占用，排队取消不打断其他任务。
 * 模块边界：不加载模型、不配置跨源隔离、不创建 Worker；预算按运行上下文持有，Offscreen 共享并行闸门，Worker 持有自己的计算间歇。不能保证不可中断的原生算子瞬时 CPU 低于 80%。
 */
export function localInferenceLimits(cores: number = globalThis.navigator?.hardwareConcurrency ?? 1, memory: number = (globalThis.navigator as {deviceMemory?: number})?.deviceMemory ?? 8) {
    const hardware = Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) : 1;
    return {jobs: hardware >= 8 && memory > 4 ? 2 : 1, threads: hardware >= 4 ? 2 : 1};
}

let singleThread = false;
/** 失败后的全新 Worker 将线程数锁定为一，避免重复尝试不可用的 pthread。 */
export function forceSingleThreadInference(): void { singleThread = true; }
export function localWasmThreads(): number {
    return !singleThread && globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined'
        ? localInferenceLimits().threads : 1;
}

export function createLocalInferenceBudget(limit: number) {
    let active = 0;
    const waiting: Array<{start(): void; cancel(): void}> = [];
    return async function run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) throw new DOMException('本地推理已取消', 'AbortError');
        if (active < limit) active++;
        else await new Promise<void>((resolve, reject) => {
            const entry = {
                start() { signal?.removeEventListener('abort', entry.cancel); active++; resolve(); },
                cancel() { waiting.splice(waiting.indexOf(entry), 1); reject(new DOMException('本地推理已取消', 'AbortError')); },
            };
            waiting.push(entry); signal?.addEventListener('abort', entry.cancel, {once: true});
        });
        try {
            if (signal?.aborted) throw new DOMException('本地推理已取消', 'AbortError');
            return await operation();
        } finally { active--; waiting.shift()?.start(); }
    };
}

export function createInferencePacer(now = () => performance.now(), sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
    let readyAt = 0;
    let tail: Promise<void> = Promise.resolve();
    return function run<T>(operation: () => Promise<T>): Promise<T> {
        const result = tail.then(async () => {
            const rest = readyAt - now();
            if (rest > 0) await sleep(rest);
            const started = now();
            try { return await operation(); }
            finally { const finished = now(); readyAt = finished + (finished - started) * 3 / 7; }
        });
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
}

export const withLocalInferenceBudget = createLocalInferenceBudget(localInferenceLimits().jobs);
export const paceLocalInference = createInferencePacer();
// 推理失败时可能在尚未返回的 run() 中重建会话；独立初始化队列避免与推理队列互等。
export const paceLocalInitialization = createInferencePacer();
