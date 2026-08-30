/**
 * @file src/app/background/providerRuntime.ts
 * 文件职责：为后台组合根集中提供翻译供应商相关运行时能力，隔离 app/messageRuntime 对 providers 内部文件结构的直接依赖。
 * 主要内容：重导出连接测试错误格式化与 Microsoft 翻译，并为连接测试注入配置模型、本地用量代次和非阻塞 IndexedDB 记录。
 * 模块边界：这是窄化的 app 层出口，不注册消息、不实现 HTTP 协议；供应商请求和错误解释仍由 providers/translation 模块拥有。
 */
// Background entrypoint 只依赖 app composition root；这里集中组装翻译 provider 能力。
import {
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
import {config} from '@/src/services/config/store';
import {resolveConfiguredModel} from '@/src/core/config/catalog';
import {modelUsageRepository} from '@/src/platform/storage/modelUsageRepository';

export {formatConnectionTestError};
export {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';

export function runTranslationServiceConnectionTestWithUsage(service: string) {
    const usageGeneration = modelUsageRepository.captureGeneration();
    return runTranslationServiceConnectionTest(service, {
        configuredModel: resolveConfiguredModel(config.model[service], config.customModel[service]),
        recordModelUsage: async (events) => {
            await modelUsageRepository.recordMany(events, usageGeneration);
        },
        warn: (message, error) => console.warn(message, error),
    });
}
