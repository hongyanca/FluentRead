import {describe, expect, it, vi} from 'vitest';

import {
    CUSTOM_OPENAI_PROVIDER_ID_PREFIX,
    CUSTOM_OPENAI_RESERVED_MODEL_ID,
    createNextCustomOpenAIProviderId,
    getCustomOpenAIProvider,
    getCustomOpenAIProviderLabel,
    getCustomOpenAIProviderModels,
    getCustomOpenAIServiceOptions,
    isConfiguredCustomOpenAIProvider,
    isCustomOpenAIProviderId,
    LEGACY_CUSTOM_OPENAI_PROVIDER_ID,
    MAX_CUSTOM_OPENAI_MODELS_PER_PROVIDER,
    MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH,
    MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH,
    normalizeCustomOpenAIProviders,
    removeCustomOpenAIProvider,
    withCustomOpenAIServiceOptions,
    type CustomOpenAIProvider,
} from '@/src/core/config/customOpenAI';

const provider = (overrides: Partial<CustomOpenAIProvider> = {}): CustomOpenAIProvider => ({
    id: 'custom:1',
    name: '本地模型',
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    models: ['model-a'],
    ...overrides,
});

describe('自定义 OpenAI-compatible 服务配置', () => {
    it('只接受旧 custom 与合法的 custom: 短 ID', () => {
        expect(isCustomOpenAIProviderId(LEGACY_CUSTOM_OPENAI_PROVIDER_ID)).toBe(true);
        expect(isCustomOpenAIProviderId('custom:1')).toBe(true);
        expect(isCustomOpenAIProviderId('custom:abc_DEF-2')).toBe(true);
        expect(isCustomOpenAIProviderId(42)).toBe(false);
        expect(isCustomOpenAIProviderId('openai')).toBe(false);
        expect(isCustomOpenAIProviderId('custom:')).toBe(false);
        expect(isCustomOpenAIProviderId('custom:bad value')).toBe(false);
    });

    it('规范化字段、模型与重复 ID，并为缺失名称生成稳定回退', () => {
        const longName = ` ${'名'.repeat(MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH + 5)} `;
        const longEndpoint = ` https://example.com/${'a'.repeat(MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH + 5)} `;
        const normalized = normalizeCustomOpenAIProviders([
            null,
            {id: 'bad', name: '忽略'},
            {
                id: ' custom:1 ',
                name: longName,
                endpoint: longEndpoint,
                models: [' model-a ', '', 42, 'model-a', CUSTOM_OPENAI_RESERVED_MODEL_ID, 'model-b'],
            },
            {id: 'custom:1', name: '重复项', endpoint: '', models: []},
            {id: 'custom:2', name: '', endpoint: '', models: 'invalid'},
            {id: 'custom', name: '', endpoint: '', models: []},
        ]);

        expect(normalized).toHaveLength(3);
        expect(normalized[0]).toMatchObject({id: 'custom:1', models: ['model-a', 'model-b']});
        expect(normalized[0].name).toHaveLength(MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH);
        expect(normalized[0].endpoint).toHaveLength(MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH);
        expect(normalized[1].name).toBe('自定义接口 2');
        expect(normalized[1].models).toEqual([]);
        expect(normalized[2].name).toBe('自定义接口');
        expect(normalizeCustomOpenAIProviders({})).toEqual([]);
    });

    it('保留任意数量的服务，并限制每服务模型数量且保持首见顺序', () => {
        const models = Array.from(
            {length: MAX_CUSTOM_OPENAI_MODELS_PER_PROVIDER + 5},
            (_, index) => `model-${index}`,
        );
        const providerCount = 64;
        const providers = Array.from(
            {length: providerCount},
            (_, index) => provider({id: `custom:${index + 1}`, name: `服务 ${index + 1}`, models}),
        );
        const normalized = normalizeCustomOpenAIProviders(providers);

        expect(normalized).toHaveLength(providerCount);
        expect(normalized[0].models).toHaveLength(MAX_CUSTOM_OPENAI_MODELS_PER_PROVIDER);
        expect(normalized[0].models.at(0)).toBe('model-0');
        expect(normalized[0].models.at(-1)).toBe(`model-${MAX_CUSTOM_OPENAI_MODELS_PER_PROVIDER - 1}`);
        expect(normalized.at(-1)?.id).toBe(`custom:${providerCount}`);
    });

    it('提供查询、动态目录、标签和防御性模型副本', () => {
        const providers = [provider()];
        expect(getCustomOpenAIProvider(providers, 'custom:1')).toBe(providers[0]);
        expect(getCustomOpenAIProvider(undefined, 'custom:1')).toBeUndefined();
        expect(isConfiguredCustomOpenAIProvider(providers, 'custom:1')).toBe(true);
        expect(isConfiguredCustomOpenAIProvider(providers, 'custom:2')).toBe(false);
        expect(getCustomOpenAIProviderLabel(providers, 'custom:1')).toBe('本地模型');
        expect(getCustomOpenAIProviderLabel(providers, 'custom:2')).toBe('custom:2');

        const copiedModels = getCustomOpenAIProviderModels(providers, 'custom:1');
        copiedModels.push('mutated');
        expect(providers[0].models).toEqual(['model-a']);
        expect(getCustomOpenAIProviderModels(undefined, 'custom:1')).toEqual([]);
        expect(getCustomOpenAIServiceOptions(providers)).toEqual([{
            value: 'custom:1',
            label: '本地模型',
            description: 'http://127.0.0.1:11434/v1/chat/completions',
        }]);
        expect(getCustomOpenAIServiceOptions(undefined)).toEqual([]);
        expect(getCustomOpenAIServiceOptions([provider({endpoint: ''})])[0].description)
            .toBe('OpenAI-compatible 自定义接口');
    });

    it('替换静态 custom 目录项、生成不可复用的高熵 ID，并不可变删除 profile', () => {
        const providers = [provider(), provider({id: 'custom:2', name: '远程模型'})];
        const options = withCustomOpenAIServiceOptions([
            {value: 'openai', label: 'OpenAI'},
            {value: 'custom', label: '旧自定义接口'},
        ], providers);
        expect(options.map((item) => item.value)).toEqual(['openai', 'custom:1', 'custom:2']);
        const generated = createNextCustomOpenAIProviderId(undefined);
        expect(generated).toMatch(new RegExp(`^${CUSTOM_OPENAI_PROVIDER_ID_PREFIX}.+`));
        expect(isCustomOpenAIProviderId(generated)).toBe(true);
        const suffixes = ['1', 'bad value', 'replacement-profile'];
        expect(createNextCustomOpenAIProviderId(providers, () => suffixes.shift() || 'unused'))
            .toBe('custom:replacement-profile');

        const retained = removeCustomOpenAIProvider(providers, 'custom:1');
        expect(retained).toEqual([provider({id: 'custom:2', name: '远程模型'})]);
        expect(retained[0]).not.toBe(providers[1]);
        expect(retained[0].models).not.toBe(providers[1].models);
        expect(createNextCustomOpenAIProviderId(retained, () => 'replacement-profile'))
            .not.toBe('custom:1');
        expect(removeCustomOpenAIProvider(undefined, 'custom:1')).toEqual([]);
    });

    it('缺少 randomUUID 时仍生成合法身份，并在候选持续无效时明确失败', () => {
        vi.stubGlobal('crypto', {});
        vi.spyOn(Date, 'now').mockReturnValue(1_788_000_000_000);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            const generated = createNextCustomOpenAIProviderId(undefined);
            expect(isCustomOpenAIProviderId(generated)).toBe(true);
            expect(generated).toMatch(/^custom:[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/u);
            expect(() => createNextCustomOpenAIProviderId(undefined, () => 'bad value'))
                .toThrow('无法生成唯一的自定义服务 ID');
        } finally {
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        }
    });
});
