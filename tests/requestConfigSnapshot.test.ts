import {describe, expect, it, vi} from 'vitest';
import {
    TRANSLATION_MODEL_USAGE_OBSERVER,
    TRANSLATION_PROVIDER_CONFIG,
    attachTranslationModelUsageObserver,
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    getTranslationProviderConfig,
    reportTranslationModelUsage,
    reportTranslationModelUsageFailure,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';

function configSource(overrides: Partial<TranslationConfigSource> = {}): TranslationConfigSource {
    return {
        service: 'aiSdk',
        from: 'auto',
        to: 'zh-Hans',
        useCache: true,
        enableAIContext: true,
        model: {aiSdk: 'model-a'},
        customModel: {aiSdk: 'custom-model-a'},
        proxy: {aiSdk: 'https://a.example/v1'},
        custom: 'https://custom-a.example/v1',
        deeplx: 'https://deeplx-a.example',
        newApiUrl: 'https://newapi-a.example',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        azureOpenaiEndpoint: 'https://azure-a.example/chat/completions',
        customBody: {aiSdk: '{"snapshot":"a"}'},
        system_role: {aiSdk: 'system-a'},
        user_role: {aiSdk: 'user-a'},
        deepseekApiType: 'chat',
        deepseekThinkingMode: 'disabled',
        ...overrides,
    };
}

describe('translation provider request config snapshot', () => {
    it('clones and freezes every provider-visible nested map and credential', () => {
        const source = configSource({
            token: {aiSdk: 'token-a'},
            requireApiKey: {'aiSdk:model-a': true},
            youdaoAppKey: 'youdao-key-a',
            youdaoAppSecret: 'youdao-secret-a',
            tencentSecretId: 'tencent-id-a',
            tencentSecretKey: 'tencent-key-a',
        });
        const snapshot = createTranslationProviderConfigSnapshot(source);

        source.model.aiSdk = 'model-b';
        source.customModel.aiSdk = 'custom-model-b';
        source.proxy.aiSdk = 'https://b.example/v1';
        source.customBody.aiSdk = '{"snapshot":"b"}';
        source.system_role.aiSdk = 'system-b';
        source.user_role.aiSdk = 'user-b';
        source.token!.aiSdk = 'token-b';
        source.requireApiKey!['aiSdk:model-a'] = false;

        expect(snapshot).toMatchObject({
            model: {aiSdk: 'model-a'},
            customModel: {aiSdk: 'custom-model-a'},
            proxy: {aiSdk: 'https://a.example/v1'},
            customBody: {aiSdk: '{"snapshot":"a"}'},
            system_role: {aiSdk: 'system-a'},
            user_role: {aiSdk: 'user-a'},
            token: {aiSdk: 'token-a'},
            requireApiKey: {'aiSdk:model-a': true},
            youdaoAppKey: 'youdao-key-a',
            youdaoAppSecret: 'youdao-secret-a',
            tencentSecretId: 'tencent-id-a',
            tencentSecretKey: 'tencent-key-a',
        });
        expect([
            snapshot,
            snapshot.model,
            snapshot.customModel,
            snapshot.proxy,
            snapshot.customBody,
            snapshot.system_role,
            snapshot.user_role,
            snapshot.token,
            snapshot.requireApiKey,
        ].every(Object.isFrozen)).toBe(true);
    });

    it('uses safe credential defaults and resolves attached context without trusting message JSON', () => {
        const snapshot = createTranslationProviderConfigSnapshot(configSource());
        const fallback = createTranslationProviderConfigSnapshot(configSource({service: 'fallback'}));
        const message = {origin: 'hello'};
        const attached = attachTranslationProviderConfig(message, snapshot);

        expect(attached).toBe(message);
        expect(attached[TRANSLATION_PROVIDER_CONFIG]).toBe(snapshot);
        expect(getTranslationProviderConfig(attached, fallback)).toBe(snapshot);
        expect(getTranslationProviderConfig({}, fallback)).toBe(fallback);
        expect(getTranslationProviderConfig(null, fallback)).toBe(fallback);
        expect(getTranslationProviderConfig('not-an-object', fallback)).toBe(fallback);
        expect(snapshot).toMatchObject({
            token: {},
            requireApiKey: {},
            youdaoAppKey: '',
            youdaoAppSecret: '',
            tencentSecretId: '',
            tencentSecretKey: '',
        });
        expect(Object.getOwnPropertySymbols(attached)).toEqual([TRANSLATION_PROVIDER_CONFIG]);
        expect(JSON.stringify(attached)).toBe('{"origin":"hello"}');
    });

    it('keeps model usage observers process-local and isolates observer failures', () => {
        const observer = vi.fn();
        const message = attachTranslationModelUsageObserver({origin: 'hello'}, observer);
        const observation = {usageAvailability: 'unreported' as const};

        expect(message[TRANSLATION_MODEL_USAGE_OBSERVER]).toBe(observer);
        expect(JSON.stringify(message)).toBe('{"origin":"hello"}');
        reportTranslationModelUsage(message, observation);
        expect(observer).toHaveBeenCalledWith(observation);

        reportTranslationModelUsage(null, observation);
        reportTranslationModelUsage('not-an-object', observation);
        reportTranslationModelUsage({}, observation);

        const throwingMessage = attachTranslationModelUsageObserver({origin: 'safe'}, () => {
            throw new Error('telemetry failed');
        });
        expect(() => reportTranslationModelUsage(throwingMessage, observation)).not.toThrow();
    });

    it('reports only safe transport failure metadata and classifies aborted attempts', () => {
        vi.spyOn(Date, 'now').mockReturnValue(160);
        const observer = vi.fn();
        const controller = new AbortController();
        const message = attachTranslationModelUsageObserver({
            origin: 'hello',
            abortSignal: controller.signal,
        }, observer);

        reportTranslationModelUsageFailure(message, {statusCode: 429}, 100, 'model-a');
        reportTranslationModelUsageFailure(message, undefined, 120, 'model-b', 408);
        const abortError = new Error('cancelled');
        abortError.name = 'AbortError';
        reportTranslationModelUsageFailure(message, abortError, 200, undefined, 999);
        controller.abort();
        reportTranslationModelUsageFailure(message, new Error('network'), 170);
        reportTranslationModelUsageFailure(message, 'plain failure', 160);

        expect(observer.mock.calls).toEqual([
            [expect.objectContaining({
                startedAt: 100,
                durationMs: 60,
                actualModel: 'model-a',
                outcome: 'error',
                statusCode: 429,
            })],
            [expect.objectContaining({
                startedAt: 120,
                durationMs: 40,
                actualModel: 'model-b',
                outcome: 'timeout',
                statusCode: 408,
            })],
            [expect.objectContaining({
                startedAt: 200,
                durationMs: 0,
                outcome: 'cancelled',
            })],
            [expect.objectContaining({
                startedAt: 170,
                durationMs: 0,
                outcome: 'cancelled',
            })],
            [expect.objectContaining({
                startedAt: 160,
                durationMs: 0,
                outcome: 'cancelled',
            })],
        ]);
        expect(observer.mock.calls[2][0]).not.toHaveProperty('statusCode');
        expect(observer.mock.calls[3][0]).not.toHaveProperty('actualModel');
    });
});
