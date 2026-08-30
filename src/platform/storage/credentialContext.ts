/**
 * @file src/platform/storage/credentialContext.ts
 *
 * 文件职责：判断当前执行上下文是否可信任地访问扩展凭据存储，阻止普通网页 content 环境直接承担密钥验证。
 * 主要内容：维护允许的 chrome-extension、moz-extension 等协议集合，isTrustedCredentialStorageContext 接受可注入 protocol 并返回严格布尔结果。 可核对的公开符号包括 isTrustedCredentialStorageContext。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

const TRUSTED_EXTENSION_PROTOCOLS = new Set([
    'chrome-extension:',
    'moz-extension:',
    'safari-web-extension:',
]);

/**
 * 扩展构建只有自身页面能直接读取凭据；普通 content page 只能使用公开配置。
 * Userscript 构建会在 Vite 中把本模块替换为 GM 私有存储实现。
 */
export function isTrustedCredentialStorageContext(protocol = globalThis.location?.protocol): boolean {
    return typeof protocol === 'string' && TRUSTED_EXTENSION_PROTOCOLS.has(protocol);
}
