import {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';
import {runTranslationServiceConnectionTest} from '@/src/providers/translation/connectionTest';
import {
    applyConfigHistoryAction,
    config,
    configReady,
    CONFIG_HISTORY_MESSAGE,
    CONFIG_PERSIST_MESSAGE,
    saveConfig,
} from '@/src/services/config/store';
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
    parseConfigCountOperationId,
} from '@/src/services/config/count';
import {incrementUserscriptConfigCount} from './count';
import {CONNECTION_TEST_MESSAGE} from '@/src/core/config/constants';
import {
    cleanupTranslationCache,
    clearTranslationCache,
    translateWithCache,
} from '@/src/app/translation/runtime';
import {lookupWord} from '@/src/features/selection-translation/services/wordDictionary';
import {UNHANDLED_RUNTIME_MESSAGE} from './browser';

const UNSUPPORTED_CAPABILITY_MESSAGE = '该功能依赖浏览器扩展权限，userscript 版本暂不支持';

/**
 * 把扩展后台消息契约映射到同页 userscript 服务；需要扩展权限的能力会返回明确失败，
 * 其余翻译、配置和缓存请求仍复用共享业务实现。
 */
export function createPlatformMessageHandler(openSettings: () => void) {
    return async (message: any): Promise<any> => {
        if (!message || typeof message !== 'object') return UNHANDLED_RUNTIME_MESSAGE;

        if (message.type === 'openOptionsPage') {
            openSettings();
            return {success: true};
        }

        if (message.type === 'fullPageTranslationState') return {success: true};

        if (message.type === CONFIG_PERSIST_MESSAGE) {
            await saveConfig(message.config, {recordHistory: true});
            return {success: true};
        }

        if (message.type === CONFIG_COUNT_INCREMENT_MESSAGE) {
            const delta = parseConfigCountIncrement(message.delta);
            if (delta === null) return {success: false, error: '无效的翻译计数增量'};
            const operationId = parseConfigCountOperationId(message.operationId);
            if (operationId === null) return {success: false, error: '无效的翻译计数操作标识'};
            const count = await incrementUserscriptConfigCount(delta, operationId);
            // local:config.count 只供当前 UI 展示；跨标签精确值始终可由专用副本重新聚合。
            config.count = count;
            await saveConfig(config);
            return {success: true, count};
        }

        if (message.type === CONFIG_HISTORY_MESSAGE) {
            const action = message.action === 'undo' || message.action === 'redo' || message.action === 'restore'
                ? message.action
                : null;
            if (!action) return {success: false, error: '无效的配置历史操作'};
            const history = await applyConfigHistoryAction(action, typeof message.version === 'number' ? message.version : undefined);
            return {success: true, history};
        }

        if (message.type === CONNECTION_TEST_MESSAGE) {
            await configReady;
            try {
                const result = await runTranslationServiceConnectionTest(String(message.service || ''));
                return {success: true, ...result};
            } catch (error) {
                return {success: false, error: error instanceof Error ? error.message : String(error)};
            }
        }

        if (message.type === 'inputBoxTranslation') {
            try {
                const translations = await translateMicrosoftTexts([String(message.text || '')], '', String(message.targetLang || 'zh-Hans'));
                return {success: true, translatedText: translations[0] || String(message.text || '')};
            } catch (error) {
                return {success: false, error: error instanceof Error ? error.message : String(error)};
            }
        }

        if (message.type === 'selectionWordLookup') {
            try {
                return {success: true, data: await lookupWord(String(message.word || ''))};
            } catch (error) {
                return {success: false, error: error instanceof Error ? error.message : String(error)};
            }
        }

        if (message.type === 'selectionTts' || message.type === 'selectionTtsGoogle' || message.type === 'selectionTtsStop') {
            // 当前 transport 报告不可用后，SelectionTranslator 会自动回退到
            // speechSynthesis 和页面音频播放。
            return {success: false, error: 'userscript 使用网页语音回退'};
        }

        if (message.type === 'clearTranslationCache') {
            await clearTranslationCache();
            return {success: true};
        }

        if (message.type === 'userscriptCacheMaintenance') {
            await cleanupTranslationCache();
            return {success: true};
        }

        if (typeof message.type === 'string' && (
            message.type === 'toggleSelectionAreaTranslator' ||
            message.type === 'toggleImageTranslator' ||
            message.type.startsWith('fluentReadImage') ||
            message.type.startsWith('fluentReadArea')
        )) {
            return {success: false, error: UNSUPPORTED_CAPABILITY_MESSAGE};
        }

        if (typeof message.origin === 'string' || Array.isArray(message.origin)) {
            return translateWithCache(message);
        }

        return UNHANDLED_RUNTIME_MESSAGE;
    };
}
