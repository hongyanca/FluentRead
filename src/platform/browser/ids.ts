/**
 * @file src/platform/browser/ids.ts
 *
 * 文件职责：提供浏览器标签页标识的边界校验，避免将 0 这类合法 ID 因 truthy 判断误判为缺失。
 * 主要内容：isBrowserTabId 仅接受有限、非负的整数 number，供 background 消息路由和标签页定向操作复用。 可核对的公开符号包括 isBrowserTabId。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

/** 浏览器 tab/window id 可以为 0；只接受非负安全整数。 */
export function isBrowserTabId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
