import {describe, expect, it} from 'vitest';
import {ref} from 'vue';

import {customModelString, defaultModelIds, services} from '@/src/core/config/catalog';
import {Config} from '@/src/core/config/model';
import {useServiceModelOptions} from '@/src/features/settings/ui/services/modelOptions';

describe('设置页服务模型选项', () => {
    it('组合内置、已保存及当前自定义模型，并派生 Thinking 状态', () => {
        const current = new Config();
        current.model[services.openai] = customModelString;
        current.customModel[services.openai] = 'active-private-model';
        current.customModels[services.openai] = [
            defaultModelIds[services.openai],
            'saved-private-model',
            'active-private-model',
        ];
        current.modelThinking = {
            [services.openai]: {
                'active-private-model': true,
                'saved-private-model': false,
            },
        };
        const config = ref(current);
        const service = ref(services.openai);
        const state = useServiceModelOptions(config, service);

        expect(state.selectedCustomProvider.value).toBeUndefined();
        expect(state.selectedModel.value).toBe('active-private-model');
        expect(state.selectedModelThinking.value).toBe(true);
        expect(state.builtInModels.value).toContain(defaultModelIds[services.openai]);
        expect(state.modelOptions.value.filter((item) => item.value === 'active-private-model'))
            .toEqual([{value: 'active-private-model', removable: true}]);
        expect(state.modelOptions.value.find((item) => item.value === defaultModelIds[services.openai]))
            .toEqual({value: defaultModelIds[services.openai]});
        expect(state.customModelCount.value).toBe(3);
    });

    it('动态服务只显示 profile 模型并随服务切换重新计算', () => {
        const current = new Config();
        current.customOpenAIProviders = [{
            id: 'custom:team',
            name: '团队模型',
            endpoint: 'https://example.com/v1/chat/completions',
            models: ['model-a', 'model-b'],
        }];
        current.model['custom:team'] = 'model-b';
        current.modelThinking = {'custom:team': {'model-a': true}};
        const config = ref(current);
        const service = ref('custom:team');
        const state = useServiceModelOptions(config, service);

        expect(state.builtInModels.value).toEqual([]);
        expect(state.modelOptions.value).toEqual([
            {value: 'model-a', removable: true},
            {value: 'model-b', removable: true},
        ]);
        expect(state.customModelCount.value).toBe(2);
        expect(state.selectedModel.value).toBe('model-b');
        expect(state.selectedModelThinking.value).toBe(false);

        service.value = services.microsoft;
        expect(state.modelOptions.value).toEqual([]);
        expect(state.customModelCount.value).toBe(0);
        expect(state.selectedModel.value).toBe('');
    });

    it('没有已保存列表时仍保留活跃自定义模型', () => {
        const current = new Config();
        current.model[services.grok] = customModelString;
        current.customModel[services.grok] = 'only-active-model';
        delete current.customModels[services.grok];
        const state = useServiceModelOptions(ref(current), ref(services.grok));

        expect(state.modelOptions.value).toContainEqual({
            value: 'only-active-model',
            removable: true,
        });
        expect(state.customModelCount.value).toBe(0);
    });
});
