import {describe, expect, it} from 'vitest';

import {
    firstConfiguredModel,
    defaultOption,
    services,
    servicesType,
} from '@/src/core/config/catalog';
import {
    extractConfigCredentials,
    isSensitiveConfigKey,
    parseStoredCredentials,
    sanitizeConfigCredentials,
    sanitizeConfigHistoryCredentials,
} from '@/src/core/config/credentials';
import {parseCustomBody} from '@/src/core/config/customBody';
import {DEFAULT_DEEPLX_ENDPOINT, getDeepLXEndpoints} from '@/src/core/config/deeplx';
import {normalizeConfig} from '@/src/core/config/model';
import {sanitizeConfigForExport} from '@/src/core/config/transfer';
import {
    getApiKeyRequirementKey,
    getMissingCredentialMessage,
    isApiKeyRequired,
} from '@/src/core/config/validation';

describe('配置领域边界与防御分支', () => {
    it('服务能力查询覆盖正反例与复合供应商判断', () => {
        expect(servicesType.isAiSdk(services.openai)).toBe(true);
        expect(servicesType.isAiSdk(services.gemini)).toBe(false);
        expect(servicesType.isUseProxy(services.google)).toBe(true);
        expect(servicesType.isUseProxy(services.chromeTranslator)).toBe(false);
        expect(servicesType.isCustom(services.custom)).toBe(true);
        expect(servicesType.isCustom(services.openai)).toBe(false);
        expect(servicesType.isNewApi(services.newapi)).toBe(true);
        expect(servicesType.isNewApi(services.openai)).toBe(false);
        expect(servicesType.isUseModel(services.openai)).toBe(true);
        expect(servicesType.isUseModel(services.microsoft)).toBe(false);
        expect(servicesType.isYoudao(services.youdao)).toBe(true);
        expect(servicesType.isYoudao(services.openai)).toBe(false);
        expect(servicesType.isTencent(services.tencent)).toBe(true);
        expect(servicesType.isTencent(services.huanYuanTranslation)).toBe(true);
        expect(servicesType.isTencent(services.openai)).toBe(false);
        expect(servicesType.isAzureOpenai(services.azureOpenai)).toBe(true);
        expect(servicesType.isAzureOpenai(services.openai)).toBe(false);
        expect(servicesType.isUseCustomUrl(services.deeplx)).toBe(true);
        expect(servicesType.isUseCustomUrl(services.google)).toBe(false);
        expect(firstConfiguredModel([])).toBe('');
        expect(firstConfiguredModel(['model-a'])).toBe('model-a');
    });

    it('凭据边界拒绝非对象与无凭据记录，并清洗混合历史条目', () => {
        expect(extractConfigCredentials(null)).toMatchObject({token: {}, extra: {}});
        expect(parseStoredCredentials({unrelated: true})).toBeNull();
        expect(sanitizeConfigCredentials('not-an-object')).toEqual({});
        expect(sanitizeConfigHistoryCredentials({
            entries: [null, {config: {token: {openai: 'secret'}, on: true}}],
        })).toEqual({
            entries: [null, {config: {on: true}}],
        });
        expect(isSensitiveConfigKey('key')).toBe(true);
        expect(isSensitiveConfigKey('token')).toBe(true);
        expect(isSensitiveConfigKey('authorization')).toBe(true);
        expect(isSensitiveConfigKey('apiToken')).toBe(true);
        expect(isSensitiveConfigKey('requireApiKey')).toBe(false);
        expect(isSensitiveConfigKey('displayName')).toBe(false);
    });

    it('自定义请求体和 DeepLX 代理对不支持输入安全回退', () => {
        expect(parseCustomBody(123)).toBeUndefined();
        expect(getDeepLXEndpoints('', 'https://proxy.test/{{apiKey}}/translate')).toEqual([
            DEFAULT_DEEPLX_ENDPOINT,
        ]);
    });

    it('配置规范化修复非对象、错误类型和不可用自定义快捷键', () => {
        expect(normalizeConfig(null)).toMatchObject({on: true, service: services.freeTranslation});

        const normalized = normalizeConfig({
            on: true,
            service: services.openai,
            from: 'auto',
            to: 'zh-Hans',
            custom: 123,
            newApiUrl: false,
            videoTranslationEnabled: 'yes',
            deepseekApiType: 'legacy',
            selectionTranslatorMode: 'bilingual',
            selectionTranslatorTrigger: 'custom',
            customSelectionTranslatorHotkey: ' ',
        });

        expect(normalized.custom).toBe(defaultOption.custom);
        expect(normalized.newApiUrl).toBe('http://localhost:3000');
        expect(normalized.videoTranslationEnabled).toBe(false);
        expect(normalized.deepseekApiType).toBe('auto');
        expect(normalized.selectionTranslatorTrigger).toBe('icon');
        expect(normalized.selectionTranslatorHotkey).toBe('none');
    });

    it('导出拒绝非对象，凭据提示覆盖未知服务和可选字段短路', () => {
        expect(() => sanitizeConfigForExport(null)).toThrow('配置必须是 JSON 对象');
        expect(getApiKeyRequirementKey('unknown-service', {})).toBe('unknown-service:');
        expect(getApiKeyRequirementKey(services.openai, {
            model: {[services.openai]: '自定义模型'},
        })).toBe(`${services.openai}:自定义模型`);
        expect(getApiKeyRequirementKey(services.openai, {
            model: {[services.openai]: '自定义模型'},
            customModel: {[services.openai]: 'local-model'},
        })).toBe(`${services.openai}:local-model`);
        expect(isApiKeyRequired(services.microsoft, {})).toBe(true);
        expect(getMissingCredentialMessage('unknown-service', {})).toBeNull();
        expect(getMissingCredentialMessage(services.youdao, {
            youdaoAppKey: 'key',
        })).toContain('App Secret');
        expect(getMissingCredentialMessage(services.youdao, {
            youdaoAppSecret: 'secret',
        })).toContain('App Key');
        expect(getMissingCredentialMessage(services.youdao, {
            youdaoAppKey: 'key',
            youdaoAppSecret: 'secret',
        })).toBeNull();
        expect(getMissingCredentialMessage(services.tencent, {
            tencentSecretId: 'id',
        })).toContain('SecretKey');
        expect(getMissingCredentialMessage(services.tencent, {
            tencentSecretKey: 'key',
        })).toContain('SecretId');
    });

});
