/**
 * @file src/core/config/credentials.ts
 *
 * 文件职责：定义配置中的敏感凭据边界，并提供从完整配置提取、解析、比较和清除凭据的纯函数。
 * 主要内容：列出 token、ak/sk、应用密钥等敏感字段，声明 session/local 专用存储键与 schema 版本，构造 PublicConfig、ConfigCredentials，并校验未知存储值是否为可接受的凭据记录。 可核对的公开符号包括 SESSION_CREDENTIALS_STORAGE_KEY、LOCAL_CREDENTIALS_STORAGE_KEY、CREDENTIALS_SCHEMA_VERSION、CONFIG_CREDENTIAL_FIELDS、ConfigCredentialField、PublicConfig、ConfigCredentials、extractConfigCredentials。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

import type { Config } from './model';
import {isSensitiveConfigKey} from './sensitiveKeys';

export {isSensitiveConfigKey} from './sensitiveKeys';

export const SESSION_CREDENTIALS_STORAGE_KEY = 'session:credentials' as const;
export const LOCAL_CREDENTIALS_STORAGE_KEY = 'local:credentials' as const;
export const CREDENTIALS_SCHEMA_VERSION = 1 as const;

export const CONFIG_CREDENTIAL_FIELDS = [
    'token',
    'ak',
    'sk',
    'appid',
    'key',
    'youdaoAppKey',
    'youdaoAppSecret',
    'tencentSecretId',
    'tencentSecretKey',
    'extra',
] as const;

export type ConfigCredentialField = typeof CONFIG_CREDENTIAL_FIELDS[number];
export type PublicConfig = Omit<Config, ConfigCredentialField>;

export interface ConfigCredentials {
    schemaVersion: typeof CREDENTIALS_SCHEMA_VERSION;
    token: Record<string, string>;
    ak: string;
    sk: string;
    appid: string;
    key: string;
    youdaoAppKey: string;
    youdaoAppSecret: string;
    tencentSecretId: string;
    tencentSecretKey: string;
    extra: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;

    const cloned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) cloned[key] = cloneValue(item);
    return cloned;
}

function cloneWithoutSensitiveKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneWithoutSensitiveKeys);
    if (!isRecord(value)) return value;

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (CONFIG_CREDENTIAL_FIELDS.includes(key as ConfigCredentialField) || isSensitiveConfigKey(key)) {
            continue;
        }
        sanitized[key] = cloneWithoutSensitiveKeys(item);
    }
    return sanitized;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function stringMapping(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}

function extraMapping(value: unknown): Record<string, unknown> {
    return isRecord(value) ? cloneValue(value) as Record<string, unknown> : {};
}

export function extractConfigCredentials(value: unknown): ConfigCredentials {
    const source = isRecord(value) ? value : {};
    return {
        schemaVersion: CREDENTIALS_SCHEMA_VERSION,
        token: stringMapping(source.token),
        ak: stringValue(source.ak),
        sk: stringValue(source.sk),
        appid: stringValue(source.appid),
        key: stringValue(source.key),
        youdaoAppKey: stringValue(source.youdaoAppKey),
        youdaoAppSecret: stringValue(source.youdaoAppSecret),
        tencentSecretId: stringValue(source.tencentSecretId),
        tencentSecretKey: stringValue(source.tencentSecretKey),
        extra: extraMapping(source.extra),
    };
}

export function parseStoredCredentials(value: unknown): ConfigCredentials | null {
    if (!isRecord(value)) return null;
    if (!CONFIG_CREDENTIAL_FIELDS.some((field) => field in value)) return null;
    return extractConfigCredentials(value);
}

export function hasCredentialFields(value: unknown): boolean {
    return isRecord(value) && CONFIG_CREDENTIAL_FIELDS.some((field) => field in value);
}

export function hasCredentialData(value: ConfigCredentials): boolean {
    return Object.keys(value.token).length > 0
        || Boolean(value.ak || value.sk || value.appid || value.key)
        || Boolean(value.youdaoAppKey || value.youdaoAppSecret)
        || Boolean(value.tencentSecretId || value.tencentSecretKey)
        || Object.keys(value.extra).length > 0;
}

export function credentialsEqual(left: ConfigCredentials, right: ConfigCredentials): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function sanitizeConfigCredentials(value: unknown): Record<string, unknown> {
    return isRecord(value) ? cloneWithoutSensitiveKeys(value) as Record<string, unknown> : {};
}

export function mergeConfigCredentials(value: unknown, credentials: ConfigCredentials): Record<string, unknown> {
    const {schemaVersion: _schemaVersion, ...credentialFields} = credentials;
    return {
        ...sanitizeConfigCredentials(value),
        ...cloneValue(credentialFields) as Omit<ConfigCredentials, 'schemaVersion'>,
    };
}

export function sanitizeConfigHistoryCredentials(value: unknown): unknown {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            // 损坏的旧历史无法可靠判断哪些片段属于凭据；继续保留原字符串会让
            // 已知敏感信息永久滞留在 local storage，因此按不可恢复历史丢弃。
            return null;
        }
    }
    const sanitized = cloneValue(parsed);
    if (!isRecord(sanitized) || !Array.isArray(sanitized.entries)) return sanitized;

    sanitized.entries = sanitized.entries.map((entry) => {
        if (!isRecord(entry)) return entry;
        return {
            ...entry,
            config: sanitizeConfigCredentials(entry.config),
        };
    });
    return sanitized;
}
