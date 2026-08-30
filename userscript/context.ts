export interface UserscriptContentContext {
    readonly isInvalid: boolean;
    onInvalidated(callback: () => void): void;
    invalidate(): void;
}

/** 用显式失效回调模拟 WXT 内容脚本上下文，统一驱动共享功能在离页时清理资源。 */
export function createUserscriptContentContext(): UserscriptContentContext {
    const callbacks = new Set<() => void>();
    let invalid = false;
    return {
        get isInvalid() {
            return invalid;
        },
        onInvalidated(callback) {
            if (invalid) callback();
            else callbacks.add(callback);
        },
        invalidate() {
            if (invalid) return;
            invalid = true;
            callbacks.forEach((callback) => callback());
            callbacks.clear();
        },
    };
}
