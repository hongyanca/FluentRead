import {describe, expect, it, vi} from 'vitest';

// 注册表测试只需核对适配器身份，避免在 Node 环境启动 WXT 存储监听。
vi.mock('@/src/services/config/store', () => ({config: {}}));
import {services} from '@/src/core/config/catalog';
import {translationProviderRegistry} from '@/src/providers/translation/registry';
import {
    AI_SDK_SERVICE_IDS,
} from '@/src/providers/translation/ai-sdk/endpoints';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';

describe('translation provider registry', () => {
    it('每个公开翻译服务都有唯一适配器，迁移不能遗漏 provider', () => {
        expect(Object.keys(translationProviderRegistry).sort()).toEqual(Object.values(services).sort());
    });

    it('AI SDK 服务共享统一 transport，Azure 继续保留专用前置校验', () => {
        for (const service of AI_SDK_SERVICE_IDS) {
            if (service === services.azureOpenai) continue;
            expect(translationProviderRegistry[service]).toBe(translateWithOpenAICompatibleAiSdk);
        }
        expect(translationProviderRegistry[services.azureOpenai]).not.toBe(translateWithOpenAICompatibleAiSdk);
    });
});
