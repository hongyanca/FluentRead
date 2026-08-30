/**
 * @file src/app/popup/cache.ts
 * 文件职责：为 Popup 的缓存清理按钮提供小型协议适配器，把 runtime.sendMessage 的未知返回值收窄成明确成功或抛错行为。
 * 主要内容：定义 clearTranslationCache 请求结构，发送消息后验证 response.success；失败时优先使用后台返回的 error 字符串，否则抛出统一的缓存清理失败错误。
 * 模块边界：本文件不访问任何缓存介质、不更新 Popup 通知状态，也不安装消息监听；实际清理由 background handler 与 translation cache 服务执行。
 */
export interface TranslationCacheClearRequest {
    type: 'clearTranslationCache';
}

/** Popup 直接请求后台清库，并且只把后台明确确认的成功当作成功。 */
export async function requestTranslationCacheClear(
    sendMessage: (message: TranslationCacheClearRequest) => Promise<unknown>,
): Promise<void> {
    const response = await sendMessage({type: 'clearTranslationCache'});
    if (response && typeof response === 'object' && (response as {success?: unknown}).success === true) return;

    const error = response && typeof response === 'object'
        && typeof (response as {error?: unknown}).error === 'string'
        ? (response as {error: string}).error
        : '后台未确认缓存清理成功';
    throw new Error(error);
}
