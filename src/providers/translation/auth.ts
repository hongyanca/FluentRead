/**
 * @file src/providers/translation/auth.ts
 *
 * 文件职责：提供构造 provider 请求头时的可选鉴权助手，防止空白 token 生成无效 Authorization 或自定义 header。
 * 主要内容：appendOptionalBearer 生成 Bearer 值，appendOptionalHeader 统一 trim 与存在性检查，仅在值非空时修改传入 Headers。 可核对的公开符号包括 appendOptionalBearer、appendOptionalHeader。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

export function appendOptionalBearer(headers: Headers, token?: string): void {
    const trimmedToken = token?.trim();
    appendOptionalHeader(headers, 'Authorization', trimmedToken ? `Bearer ${trimmedToken}` : '');
}

export function appendOptionalHeader(headers: Headers, name: string, value?: string): void {
    const trimmedValue = value?.trim();
    if (trimmedValue) headers.set(name, trimmedValue);
}
