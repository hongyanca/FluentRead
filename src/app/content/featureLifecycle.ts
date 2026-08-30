/**
 * @file src/app/content/featureLifecycle.ts
 * 文件职责：解决 content 异步功能在快速禁用再启用时复用旧挂载 Promise 的竞态，保证仍被需要的功能最终拥有实际宿主。
 * 主要内容：声明 mount、isMounted、isStillDesired 三个所有权回调；先等待功能自己的挂载，再校验当前激活与 DOM 状态，仅在“仍需要但未挂载”时额外重试一次。
 * 模块边界：本文件不持有 feature 实例、不创建 Shadow DOM，也不无限重试；requestId、宿主节点和卸载资源仍由各具体 feature 管理。
 */
export interface EnsureContentFeatureMountedOptions {
    mount: () => unknown | PromiseLike<unknown>;
    isMounted: () => boolean;
    isStillDesired: () => boolean;
}

/**
 * 页面功能恢复时，新的激活可能先复用到刚被禁用的旧挂载 Promise。
 * 旧 Promise 结束后，如果当前激活仍需要该功能且宿主节点还没出现，就重试一次。
 * 每个具体挂载器仍然拥有自己的 requestId、DOM 宿主和清理逻辑。
 */
export async function ensureContentFeatureMounted(options: EnsureContentFeatureMountedOptions): Promise<void> {
    // 步骤 1：先执行功能自己的挂载逻辑，兼容已有的异步 UI mount。
    await options.mount();

    // 步骤 2：若激活已失效，或宿主已经挂上，则不做额外动作。
    if (!options.isStillDesired() || options.isMounted()) return;

    // 步骤 3：仅在“还需要但未挂载”的场景重试一次，避免无限循环。
    await options.mount();
}
