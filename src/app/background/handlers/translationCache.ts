/**
 * @file src/app/background/handlers/translationCache.ts
 * 文件职责：把清空翻译缓存能力封装为类型化后台消息处理器，为 popup 和旧 content 消息提供一致响应。
 * 主要内容：声明 clearTranslationCache 消息与 success/error 响应，调用注入的异步 clearCache，并把未知异常规范化为可传输的错误字符串。
 * 模块边界：本文件不直接访问 IndexedDB、内存缓存或页面 localStorage，也不决定清理代次；缓存一致性和旧写入排空由 translation cache 服务负责。
 */
import type {BackgroundMessageHandler} from '../messageRouter';

export const CLEAR_TRANSLATION_CACHE_MESSAGE = 'clearTranslationCache' as const;

export interface ClearTranslationCacheMessage {
    type: typeof CLEAR_TRANSLATION_CACHE_MESSAGE;
}
export interface ClearTranslationCacheResponse {
    success: true;
}

/** 创建翻译缓存清理 handler；具体缓存实现由 composition root 注入。 */
export function createTranslationCacheHandler(
    clearTranslationCache: () => Promise<void>,
): BackgroundMessageHandler<unknown, ClearTranslationCacheMessage, ClearTranslationCacheResponse> {
    return {
        type: CLEAR_TRANSLATION_CACHE_MESSAGE,
        async handle() {
            // 步骤 1：同时清理持久译文缓存和 broker 的页面摘要缓存。
            await clearTranslationCache();
            // 步骤 2：只有底层清理成功后才向调用方报告成功。
            return {success: true};
        },
    };
}
