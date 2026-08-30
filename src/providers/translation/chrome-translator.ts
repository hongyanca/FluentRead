/**
 * @file src/providers/translation/chrome-translator.ts
 *
 * 文件职责：适配 Chrome 内置 Translation API，通过受能力约束的 Offscreen document 执行浏览器本地翻译。
 * 主要内容：createChromeTranslator 注入 BrowserCapabilities 与 OffscreenClient，校验平台可用性和响应结果，默认实例使用 chromeOffscreenClient 与请求级语言 payload。 可核对的公开符号包括 ChromeTranslatorDependencies、createChromeTranslator、default:chromeTranslator。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {config} from '@/src/services/config/store';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {
    browserCapabilities,
    type BrowserCapabilities,
} from '@/src/platform/browser/capabilities';
import {
    chromeOffscreenClient,
    OFFSCREEN_CANCEL_CHROME_TRANSLATION_MESSAGE_TYPE,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';
import {
    buildChromeOffscreenTranslationData,
    type ChromeTranslatorMessage,
} from './chromeTranslatorRequest';

interface ChromeTranslationOffscreenResponse {
    readonly success?: boolean;
    readonly result?: unknown;
    readonly error?: string;
    readonly requestId?: unknown;
}

const DEFAULT_CHROME_TRANSLATION_TIMEOUT_MS = 45_000;

export interface ChromeTranslatorDependencies {
    readonly capabilities: Pick<BrowserCapabilities, 'chromeTranslation'>;
    readonly offscreenClient: Pick<OffscreenClient, 'send'>;
    readonly createRequestId: () => string;
}

export function createChromeTranslationRequestId(): string {
    return crypto.randomUUID();
}

/** Chrome Translation provider；Offscreen 生命周期与 transport 由 platform client 所有。 */
export function createChromeTranslator(dependencies: ChromeTranslatorDependencies) {
    return async (message: ChromeTranslatorMessage): Promise<string> => {
        if (typeof message.origin !== 'string' || !message.origin.trim()) {
            throw new Error('翻译文本不能为空');
        }
        if (!dependencies.capabilities.chromeTranslation) {
            throw new Error('当前浏览器不支持 Chrome 内置翻译，请在设置中切换翻译服务');
        }

        try {
            const current = getTranslationProviderConfig(message, config);
            const requestId = dependencies.createRequestId();
            const response = await dependencies.offscreenClient.send<ChromeTranslationOffscreenResponse>({
                type: 'CHROME_TRANSLATE_OFFSCREEN',
                requestId,
                data: buildChromeOffscreenTranslationData(message, {
                    sourceLanguage: current.from,
                    targetLanguage: current.to,
                }),
            }, {
                signal: message.abortSignal,
                timeoutMs: typeof message.requestTimeoutMs === 'number'
                    ? message.requestTimeoutMs
                    : DEFAULT_CHROME_TRANSLATION_TIMEOUT_MS,
                cancelMessage: {
                    type: OFFSCREEN_CANCEL_CHROME_TRANSLATION_MESSAGE_TYPE,
                    requestId,
                },
            });
            if (response?.requestId !== requestId) throw new Error('Offscreen 翻译响应 requestId 不匹配');
            if (!response.success || typeof response.result !== 'string') {
                throw new Error(response?.error || '无效的翻译响应');
            }
            return response.result;
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            throw new Error(`Chrome Translation API 不可用：${message}`);
        }
    };
}

const chromeTranslator = createChromeTranslator({
    capabilities: browserCapabilities,
    offscreenClient: chromeOffscreenClient,
    createRequestId: createChromeTranslationRequestId,
});

export default chromeTranslator;
