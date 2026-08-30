/**
 * @file src/services/config/schema.ts
 *
 * 文件职责：定义浏览器存储中配置记录的修订字段与安全解析、序列化规则，作为配置服务的持久化 wire format。
 * 主要内容：提供 isConfigRecord、getStoredConfigRevision、parseStoredConfig 与 serializeConfig，过滤非对象或不可序列化输入并维护内部 revision。 可核对的公开符号包括 CONFIG_REVISION_FIELD、isConfigRecord、getStoredConfigRevision、parseStoredConfig、serializeConfig。
 * 模块边界：本文件位于配置 application service 层，可协调 core 规则与浏览器存储端口；不包含设置页面组件，也不实现具体翻译供应商协议，调用方应通过公开服务 API 订阅或提交配置。
 */

export const CONFIG_REVISION_FIELD = '__fluentConfigRevision' as const;

export function isConfigRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getStoredConfigRevision(value: unknown): number {
    if (!isConfigRecord(value)) return 0;
    const revision = value[CONFIG_REVISION_FIELD];
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
        ? revision
        : 0;
}

export function parseStoredConfig(value: unknown): Record<string, unknown> | null {
    let parsed = value;

    if (typeof parsed === 'string') {
        if (!parsed.trim()) return null;
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }

    if (!isConfigRecord(parsed)) return null;
    if (!['on', 'service', 'from', 'to'].every((key) => key in parsed)) return null;
    return parsed;
}

export function serializeConfig(value: unknown): string {
    return JSON.stringify(value);
}
