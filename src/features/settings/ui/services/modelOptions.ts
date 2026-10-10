/**
 * @file src/features/settings/ui/services/modelOptions.ts
 *
 * 文件职责：为设置页翻译服务目录与高级配置派生当前实际模型、Thinking 状态和可选择模型列表。
 * 主要内容：统一内置服务与动态 OpenAI-compatible 服务的模型解析、自定义模型去重、当前 Thinking 状态和数量统计。
 * 模块边界：本文件只创建 Vue 计算状态，不修改配置、不持久化数据也不发起翻译；模型增删仍由 SettingsSections 的原子更新边界负责。
 */

import {computed, type Ref} from 'vue';
import {customModelString, models, resolveConfiguredModel} from '@/src/core/config/catalog';
import type {Config} from '@/src/core/config/model';
import {isModelThinkingEnabled} from '@/src/core/config/modelThinking';
import {getCustomOpenAIProvider} from '@/src/core/config/customOpenAI';

export interface ConfigurationModelOption {
    value: string;
    label?: string;
    removable?: boolean;
}

export function useServiceModelOptions(config: Ref<Config>, service: Readonly<Ref<string>>) {
    const selectedCustomProvider = computed(() => getCustomOpenAIProvider(
        config.value.customOpenAIProviders,
        service.value,
    ));
    const selectedModel = computed(() => resolveConfiguredModel(
        config.value.model[service.value],
        config.value.customModel[service.value],
    ));
    const selectedModelThinking = computed(() => isModelThinkingEnabled(
        config.value.modelThinking,
        service.value,
        selectedModel.value,
    ));
    const builtInModels = computed(() => (
        models.get(service.value) || []
    ).filter((model) => model !== customModelString));
    const option = (model: string, removable = false): ConfigurationModelOption => ({
        value: model,
        ...(removable ? {removable: true} : {}),
    });
    const modelOptions = computed<ConfigurationModelOption[]>(() => {
        const provider = selectedCustomProvider.value;
        if (provider) return provider.models.map((model) => option(model, true));

        const builtIn = builtInModels.value.map((model) => option(model));
        const activeCustomModel = config.value.model[service.value] === customModelString
            ? config.value.customModel[service.value]?.trim()
            : '';
        const customModels = Array.from(new Set([
            ...(config.value.customModels[service.value] || []),
            activeCustomModel,
        ].filter((model): model is string => Boolean(model))))
            .filter((model) => !builtIn.some((item) => item.value === model));
        return [...builtIn, ...customModels.map((model) => option(model, true))];
    });
    const customModelCount = computed(() => (
        selectedCustomProvider.value?.models.length
        ?? config.value.customModels[service.value]?.length
        ?? 0
    ));

    return {
        builtInModels,
        customModelCount,
        modelOptions,
        selectedCustomProvider,
        selectedModel,
        selectedModelThinking,
    };
}
