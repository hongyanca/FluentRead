/**
 * @file src/providers/translation/connectionTest.ts
 *
 * 文件职责：通过真实 provider registry 执行最小翻译连接测试，覆盖服务鉴权、端点、模型配置和响应解析。
 * 主要内容：使用固定英文测试文本调用指定适配器，验证非空结果并返回耗时；formatConnectionTestError 将失败转换为带服务名的可读消息。 可核对的公开符号包括 CONNECTION_TEST_ORIGIN、runTranslationServiceConnectionTest、formatConnectionTestError。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {translationProviderRegistry} from './registry';
import {formatServiceError} from '@/src/services/translation/serviceErrors';
import {
    attachTranslationModelUsageObserver,
} from '@/src/services/translation/requestSnapshot';
import type {
    TranslationModelUsageObservation,
    TranslationModelUsageOutcome,
    TranslationModelUsageRecord,
} from '@/src/services/translation/types';

export const CONNECTION_TEST_ORIGIN = 'Hello from FluentRead.';
export const CONNECTION_TEST_TIMEOUT_MS = 30_000;

export interface ConnectionTestUsageOptions {
    configuredModel?: string;
    recordModelUsage?: (events: readonly TranslationModelUsageRecord[]) => Promise<void>;
    now?: () => number;
    warn?: (message: string, error: unknown) => void;
}

function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** 通过现有服务适配器发出真实的最小翻译请求，覆盖鉴权、端点、模型和响应解析。 */
export async function runTranslationServiceConnectionTest(
    service: string,
    usageOptions: ConnectionTestUsageOptions = {},
): Promise<{durationMs: number}> {
    const adapter = translationProviderRegistry[service];
    if (!adapter) {
        throw new Error(`未找到翻译服务适配器: ${service}`);
    }

    const now = usageOptions.now ?? Date.now;
    const startedAt = now();
    const observations: TranslationModelUsageObservation[] = [];
    const configuredModel = usageOptions.configuredModel?.trim() || 'unknown';
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('翻译请求超时'));
        }, CONNECTION_TEST_TIMEOUT_MS);
    });

    let result: unknown;
    try {
        result = await Promise.race([
            Promise.resolve().then(() => adapter(attachTranslationModelUsageObserver({
                origin: CONNECTION_TEST_ORIGIN,
                context: '',
                pageContext: '',
                summaryPrompt: '',
                summarySystemPrompt: '',
                serviceOverride: service,
                useCache: false,
                requestTimeoutMs: CONNECTION_TEST_TIMEOUT_MS,
                abortSignal: controller.signal,
            }, (observation) => observations.push({...observation})))),
            timeout,
        ]);
        if (!isNonEmptyText(result)) {
            throw new Error('服务已响应，但没有返回有效译文');
        }
        scheduleConnectionTestUsage('success');
    } catch (error) {
        const lastObservation = observations.at(-1);
        const outcome = timedOut || isTimeoutError(error) || lastObservation?.statusCode === 408
            ? 'timeout'
            : error instanceof Error && error.name === 'AbortError'
                ? 'cancelled'
                : 'error';
        if (
            outcome === 'timeout'
            && (lastObservation?.outcome === 'cancelled' || lastObservation?.outcome === 'error')
        ) {
            lastObservation.outcome = 'timeout';
        }
        scheduleConnectionTestUsage(outcome);
        if (timedOut) throw new Error('翻译请求超时');
        throw error;
    } finally {
        clearTimeout(timer!);
    }

    return {durationMs: Math.max(0, now() - startedAt)};

    function scheduleConnectionTestUsage(fallbackOutcome: TranslationModelUsageOutcome): void {
        if (!usageOptions.recordModelUsage || observations.length === 0) return;
        const elapsed = Math.max(0, now() - startedAt);
        const records: TranslationModelUsageRecord[] = observations.map((observation) => ({
            ...observation,
            startedAt: typeof observation.startedAt === 'number' && Number.isFinite(observation.startedAt)
                ? observation.startedAt
                : startedAt,
            durationMs: typeof observation.durationMs === 'number' && Number.isFinite(observation.durationMs)
                ? Math.max(0, observation.durationMs)
                : observations.length === 1 ? elapsed : 0,
            serviceId: service,
            configuredModel,
            purpose: 'connection-test',
            outcome: observation.outcome ?? fallbackOutcome,
        }));
        try {
            void Promise.resolve(usageOptions.recordModelUsage(records)).catch((error) => {
                usageOptions.warn?.('[FluentRead] connection test usage write failed:', error);
            });
        } catch (error) {
            usageOptions.warn?.('[FluentRead] connection test usage write failed:', error);
        }
    }
}

function isTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {kind?: unknown; name?: unknown; statusCode?: unknown};
    return candidate.kind === 'timeout'
        || candidate.name === 'TimeoutError'
        || candidate.statusCode === 408;
}

export function formatConnectionTestError(service: string, error: unknown): string {
    return formatServiceError(service, error);
}
