/**
 * @file src/features/settings/model/credentialPreview.ts
 * 文件职责：为配置和备份导入预览生成不泄露明文的凭据变化清单。
 * 主要内容：比较服务 Token、旧版标量凭据和扩展凭据，只返回新增、替换或清除状态及用户可读标签。
 * 模块边界：该模块只做纯比较，不返回凭据内容、不读写配置，也不决定导入是否执行。
 */

import {options} from '@/src/core/config/catalog';
import {extractConfigCredentials} from '@/src/core/config/credentials';

export interface CredentialPreviewChange {
    key: string;
    label: string;
    before: string;
    after: string;
}

const scalarCredentialLabels = {
    ak: 'Access Key',
    sk: 'Secret Key',
    appid: '旧版 App ID',
    key: '旧版服务 Key',
    youdaoAppKey: '有道 AppKey',
    youdaoAppSecret: '有道 AppSecret',
    tencentSecretId: '腾讯云 SecretId',
    tencentSecretKey: '腾讯云 SecretKey',
} as const;

function isCredentialConfigured(value: unknown): boolean {
    if (typeof value === 'string') return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== null && value !== undefined && value !== false;
}

function credentialChange(
    key: string,
    label: string,
    before: unknown,
    after: unknown,
): CredentialPreviewChange | null {
    if (JSON.stringify(before ?? '') === JSON.stringify(after ?? '')) return null;
    const hadValue = isCredentialConfigured(before);
    const hasValue = isCredentialConfigured(after);
    if (!hadValue && !hasValue) return null;
    return {
        key,
        label,
        before: hadValue ? '已配置（内容已隐藏）' : '未设置',
        after: hasValue
            ? hadValue ? '将替换（内容已隐藏）' : '将新增（内容已隐藏）'
            : '将清除',
    };
}

export function buildCredentialPreviewChanges(beforeValue: unknown, afterValue: unknown): CredentialPreviewChange[] {
    const before = extractConfigCredentials(beforeValue);
    const after = extractConfigCredentials(afterValue);
    const changes: CredentialPreviewChange[] = [];

    for (const service of new Set([...Object.keys(before.token), ...Object.keys(after.token)])) {
        const serviceLabel = options.services.find((item: any) => item.value === service)?.label || service;
        const change = credentialChange(
            `token.${service}`,
            `${serviceLabel} API Key`,
            before.token[service],
            after.token[service],
        );
        if (change) changes.push(change);
    }
    for (const field of Object.keys(scalarCredentialLabels) as Array<keyof typeof scalarCredentialLabels>) {
        const change = credentialChange(field, scalarCredentialLabels[field], before[field], after[field]);
        if (change) changes.push(change);
    }
    for (const key of new Set([...Object.keys(before.extra), ...Object.keys(after.extra)])) {
        const change = credentialChange(`extra.${key}`, `${key} 扩展凭据`, before.extra[key], after.extra[key]);
        if (change) changes.push(change);
    }
    return changes;
}
