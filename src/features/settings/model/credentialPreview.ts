/**
 * @file src/features/settings/model/credentialPreview.ts
 * 文件职责：为配置和备份导入预览生成不泄露明文的凭据变化清单。
 * 主要内容：比较服务 Token、多 Key 列表、旧版标量凭据和扩展凭据，只返回新增、替换或清除状态，并用内置目录或导入配置中的动态 profile 名称生成用户可读标签。
 * 模块边界：该模块只做纯比较，不返回凭据内容、不读写配置，也不决定导入是否执行。
 */

import {getCloudCredentialLabels, options} from '@/src/core/config/catalog';
import {
    getCustomOpenAIProviderLabel,
    normalizeCustomOpenAIProviders,
} from '@/src/core/config/customOpenAI';
import {extractConfigCredentials} from '@/src/core/config/credentials';
import {getServiceApiKeys} from '@/src/core/config/apiKeys';

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
    const recordProviders = (value: unknown) => normalizeCustomOpenAIProviders(
        value && typeof value === 'object'
            ? (value as Record<string, unknown>).customOpenAIProviders
            : undefined,
    );
    const customProviders = normalizeCustomOpenAIProviders([
        ...recordProviders(afterValue),
        ...recordProviders(beforeValue),
    ]);
    const changes: CredentialPreviewChange[] = [];

    for (const service of new Set([...Object.keys(before.token), ...Object.keys(after.token), ...Object.keys(before.apiKeys), ...Object.keys(after.apiKeys)])) {
        const serviceLabel = options.services.find((item: any) => item.value === service)?.label
            || getCustomOpenAIProviderLabel(customProviders, service);
        const previousKeys = getServiceApiKeys(before, service);
        const nextKeys = getServiceApiKeys(after, service);
        const multipleKeys = previousKeys.length > 1 || nextKeys.length > 1;
        const change = credentialChange(
            `${multipleKeys ? 'apiKeys' : 'token'}.${service}`,
            `${serviceLabel} ${getCloudCredentialLabels(service).token}${multipleKeys ? ' 列表' : ''}`,
            previousKeys,
            nextKeys,
        );
        if (change) changes.push(change);
    }
    // 云服务厂商的第二段密钥与主密钥同属一个服务，预览里必须分别列出，
    // 否则用户无法判断导入会替换哪一半。
    for (const service of new Set([...Object.keys(before.secret), ...Object.keys(after.secret)])) {
        const serviceLabel = options.services.find((item: any) => item.value === service)?.label || service;
        const change = credentialChange(
            `secret.${service}`,
            `${serviceLabel} ${getCloudCredentialLabels(service).secret || 'Secret'}`,
            before.secret[service],
            after.secret[service],
        );
        if (change) changes.push(change);
    }
    for (const service of new Set([...Object.keys(before.customHeaders), ...Object.keys(after.customHeaders)])) {
        const change = credentialChange(
            `customHeaders.${service}`,
            `${getCustomOpenAIProviderLabel(customProviders, service)} 自定义请求头`,
            before.customHeaders[service], after.customHeaders[service],
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
