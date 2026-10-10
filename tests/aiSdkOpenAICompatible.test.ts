import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
  mockConfig: {
    service: 'custom',
    from: 'auto',
    to: 'zh-Hans',
    useCache: true,
    enableAIContext: false,
    token: {} as Record<string, string>,
    model: {} as Record<string, string>,
    customModel: {} as Record<string, string>,
    customBody: {} as Record<string, string>,
    system_role: {} as Record<string, string>,
    user_role: {} as Record<string, string>,
    requireApiKey: {} as Record<string, boolean>,
    proxy: {} as Record<string, string>,
    custom: 'http://127.0.0.1:11434/v1/chat/completions',
    deeplx: '',
    newApiUrl: '',
    azureOpenaiEndpoint: '',
    minimaxBillingPlan: 'payg',
    minimaxRegion: 'cn',
    mimoBillingPlan: 'payg',
    mimoRegion: 'cn',
    deepseekApiType: 'auto',
    deepseekThinkingMode: 'disabled',
    translationMaxRetries: 2,
    youdaoAppKey: '',
    youdaoAppSecret: '',
    tencentSecretId: '',
    tencentSecretKey: '',
  },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import {services} from '@/src/core/config/catalog';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import azureOpenai from '@/src/providers/translation/azure-openai';
import {normalizeAiSdkError} from '@/src/providers/translation/ai-sdk/errors';
import {
    attachTranslationModelUsageObserver,
    attachTranslationProviderConfig,
    attachTranslationRequestScheduler,
    createTranslationProviderConfigSnapshot,
} from '@/src/services/translation/requestSnapshot';
import {createTranslationRequestScheduler} from '@/src/services/translation/requestScheduler';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import type {TranslationModelUsageObservation} from '@/src/services/translation/types';

function successResponse(text = '译文') {
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [{index: 0, message: {role: 'assistant', content: text}, finish_reason: 'stop'}],
    usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
  }), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function errorResponse(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({error: {message, code: `code-${status}`}}), {
    status,
    statusText: 'Provider Error',
    headers: {'content-type': 'application/json', ...headers},
  });
}

describe('Vercel AI SDK OpenAI-compatible transport', () => {
  beforeEach(() => {
    vi.useRealTimers();
    setRuntimeFetch();
    mockConfig.service = services.custom;
    mockConfig.to = 'zh-Hans';
    mockConfig.token = {[services.custom]: 'sk-local-secret-value'};
    mockConfig.model = {[services.custom]: 'base-model'};
    mockConfig.customModel = {};
    mockConfig.customBody = {};
    mockConfig.system_role = {[services.custom]: 'You are a translator.'};
    mockConfig.user_role = {[services.custom]: 'Translate {{origin}} into {{to}}.'};
    mockConfig.proxy = {};
    mockConfig.requireApiKey = {};
    mockConfig.translationMaxRetries = 2;
    mockConfig.custom = 'http://127.0.0.1:11434/v1/chat/completions';
    mockConfig.newApiUrl = '';
    mockConfig.azureOpenaiEndpoint = '';
  });

  afterEach(() => {
    setRuntimeFetch();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('issue #626：Base URL 经真实 SDK 发往完整接口并保留模型和鉴权', async () => {
    mockConfig.custom = 'https://opencode.ai/zen/v1';
    mockConfig.model[services.custom] = 'big-pickle';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === 'https://opencode.ai/zen/v1/chat/completions'
      ? successResponse('你好')
      : new Response('<!DOCTYPE html><html><body>Not Found</body></html>', {status: 404, headers: {'content-type': 'text/html'}}));
    setRuntimeFetch(fetchMock);
    await expect(translateWithOpenAICompatibleAiSdk({origin: 'hello'})).resolves.toBe('你好');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-local-secret-value');
    expect(JSON.parse(String(init.body))).toMatchObject({model: 'big-pickle', stream: false});
    expect(mockConfig.custom).toBe('https://opencode.ai/zen/v1');
  });


  it('preserves custom top-level fields while keeping the SDK-owned stream mode', async () => {
    mockConfig.custom = 'http://127.0.0.1:11434/non-standard-generate';
    mockConfig.customBody[services.custom] = JSON.stringify({
      vendor_flag: 'kept',
      model: 'custom-model',
      stream: true,
    });
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 5_000,
    })).resolves.toBe('译文');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/non-standard-generate');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-local-secret-value');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'custom-model',
      stream: false,
      vendor_flag: 'kept',
    });
  });

  it.each([
    ['', 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions'],
    ['https://gateway.example.com/v1/chat/completions', 'https://gateway.example.com/v1/chat/completions'],
  ])('issue #513：混元使用官方接口且保留显式代理 %s', async (proxy, expectedEndpoint) => {
    mockConfig.service = services.huanYuan;
    mockConfig.model[services.huanYuan] = 'hy3';
    mockConfig.token[services.huanYuan] = 'hunyuan-test-key';
    mockConfig.proxy[services.huanYuan] = proxy;
    const fetchMock = vi.fn().mockResolvedValue(successResponse('你好'));
    setRuntimeFetch(fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({origin: 'hello'})).resolves.toBe('你好');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expectedEndpoint);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer hunyuan-test-key');
    expect(JSON.parse(String(init.body))).toMatchObject({model: 'hy3', stream: false});
    expect(mockConfig.token[services.huanYuan]).toBe('hunyuan-test-key');
    expect(mockConfig.proxy[services.huanYuan]).toBe(proxy);
  });

  it('通过 runtimeFetch 发起 AI SDK 请求，使 userscript 可复用 GM transport', async () => {
    const nativeFetch = vi.fn().mockRejectedValue(new Error('不应调用原生 fetch'));
    vi.stubGlobal('fetch', nativeFetch);
    const runtimeTransport = vi.fn().mockResolvedValue(successResponse('GM 译文'));
    setRuntimeFetch(runtimeTransport);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    })).resolves.toBe('GM 译文');

    expect(runtimeTransport).toHaveBeenCalledOnce();
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['https://reader.openai.azure.com', 'https://reader.openai.azure.com/openai/v1/chat/completions'],
    ['https://reader.services.ai.azure.com/openai/v1/', 'https://reader.services.ai.azure.com/openai/v1/chat/completions'],
    ['https://reader.openai.azure.com/openai/deployments/reader/chat/completions?api-version=2024-10-21', 'https://reader.openai.azure.com/openai/deployments/reader/chat/completions?api-version=2024-10-21'],
  ])('Azure provider 使用部署名称与 api-key 请求 %s', async (endpoint, expected) => {
    mockConfig.azureOpenaiEndpoint = endpoint;
    mockConfig.token[services.azureOpenai] = ' azure-test-key ';
    mockConfig.model[services.azureOpenai] = 'reader-deployment';
    const fetchMock = vi.fn().mockResolvedValue(successResponse('Azure 译文'));
    setRuntimeFetch(fetchMock);

    await expect(azureOpenai({origin: 'hello', serviceOverride: services.azureOpenai})).resolves.toBe('Azure 译文');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expected);
    expect(new Headers(init.headers).get('api-key')).toBe('azure-test-key');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({model: 'reader-deployment', stream: false});
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('Azure 前置校验和 transport 使用同一个请求快照', async () => {
    mockConfig.azureOpenaiEndpoint = 'https://snapshot.services.ai.azure.com';
    mockConfig.token[services.azureOpenai] = 'snapshot-key';
    mockConfig.model[services.azureOpenai] = 'snapshot-deployment';
    const snapshot = createTranslationProviderConfigSnapshot(mockConfig);
    mockConfig.azureOpenaiEndpoint = '';
    mockConfig.token[services.azureOpenai] = '';
    mockConfig.model[services.azureOpenai] = '';
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    setRuntimeFetch(fetchMock);

    await azureOpenai(attachTranslationProviderConfig({origin: 'hello', serviceOverride: services.azureOpenai}, snapshot));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://snapshot.services.ai.azure.com/openai/v1/chat/completions');
    expect(new Headers(init.headers).get('api-key')).toBe('snapshot-key');
    expect(JSON.parse(String(init.body)).model).toBe('snapshot-deployment');
  });

  it('Azure 在发送请求前拒绝缺失凭据、无效端点和空部署名称', async () => {
    mockConfig.service = services.azureOpenai;
    mockConfig.azureOpenaiEndpoint = 'https://reader.services.ai.azure.com';
    mockConfig.model[services.azureOpenai] = '   ';
    const fetchMock = vi.fn();
    setRuntimeFetch(fetchMock);

    await expect(azureOpenai({origin: 'hello'})).rejects.toThrow('Azure API Key 未配置');
    mockConfig.token[services.azureOpenai] = '   ';
    await expect(azureOpenai({origin: 'hello'})).rejects.toThrow('Azure API Key 未配置');
    mockConfig.token[services.azureOpenai] = 'azure-test-key';
    mockConfig.azureOpenaiEndpoint = 'https://reader.services.ai.azure.com/unexpected';
    await expect(azureOpenai({origin: 'hello'})).rejects.toThrow('Azure 端点地址格式不正确');
    mockConfig.azureOpenaiEndpoint = 'https://reader.services.ai.azure.com';
    await expect(azureOpenai({origin: 'hello'})).rejects.toThrow('模型尚未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Azure 允许通过模型覆盖和自定义请求体指定部署名称', async () => {
    mockConfig.service = services.azureOpenai;
    mockConfig.azureOpenaiEndpoint = 'http://localhost:3000/v1';
    mockConfig.requireApiKey[`${services.azureOpenai}:`] = false;
    const models: string[] = [];
    setRuntimeFetch(vi.fn(async (_input, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      expect(new Headers(init?.headers).has('api-key')).toBe(false);
      return successResponse();
    }));

    await azureOpenai({origin: 'hello', modelOverride: 'custom-deployment'});
    mockConfig.customBody[services.azureOpenai] = '{"model":"body-deployment"}';
    await azureOpenai({origin: 'hello'});
    expect(models).toEqual(['custom-deployment', 'body-deployment']);
  });

  it('逐次报告真实 transport 的服务商 Token，且不把 Kimi 缓存 Token 重复加入总量', async () => {
    const observations: TranslationModelUsageObservation[] = [];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'kimi-k2.6',
      choices: [{message: {role: 'assistant', content: 'Kimi 译文'}, finish_reason: 'stop'}],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 5,
        total_tokens: 20,
        cached_tokens: 6,
      },
    }), {status: 200, headers: {'content-type': 'application/json'}}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk(attachTranslationModelUsageObserver({
      origin: 'hello',
      serviceOverride: services.custom,
    }, (observation) => observations.push(observation)))).resolves.toBe('Kimi 译文');

    expect(observations).toEqual([
      expect.objectContaining({
        actualModel: 'kimi-k2.6',
        outcome: 'success',
        statusCode: 200,
        usageAvailability: 'reported',
        inputTokens: 15,
        outputTokens: 5,
        totalTokens: 20,
        cachedInputTokens: 6,
      }),
    ]);
  });

  it('把每次 HTTP 408 transport 尝试报告为 timeout', async () => {
    const observations: TranslationModelUsageObservation[] = [];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(errorResponse(
      408,
      'request timeout',
      {'retry-after': '0'},
    )));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk(attachTranslationModelUsageObserver({
      origin: 'hello',
      serviceOverride: services.custom,
    }, (observation) => observations.push(observation))).catch((reason) => reason);

    expect(error).toMatchObject({kind: 'timeout', statusCode: 408});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(observations).toHaveLength(3);
    expect(observations).toEqual(observations.map(() => expect.objectContaining({
      outcome: 'timeout',
      statusCode: 408,
      usageAvailability: 'unreported',
    })));
  });

  it('AI SDK 的首次请求和内部重试都经过共享 attempt scheduler', async () => {
    const scheduler = createTranslationRequestScheduler(() => ({
      maxConcurrentTranslations: 1,
      translationRequestsPerSecond: 0,
      translationRequestsPerMinute: 0,
    }));
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(408, 'request timeout'));
    setRuntimeFetch(fetchMock);

    const request = attachTranslationRequestScheduler({
      origin: 'hello',
      serviceOverride: services.custom,
    }, scheduler, {service: services.custom, model: 'base-model'});
    await expect(translateWithOpenAICompatibleAiSdk(request)).rejects.toMatchObject({statusCode: 408});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15_000);

  it('uses the broker-attached endpoint, credential, prompt, and custom body snapshot', async () => {
    mockConfig.custom = 'https://snapshot-a.example/v1/chat/completions';
    mockConfig.token[services.custom] = 'snapshot-token-a';
    mockConfig.model[services.custom] = 'snapshot-model-a';
    mockConfig.customBody[services.custom] = '{"temperature":0.2,"snapshot":"a"}';
    mockConfig.system_role[services.custom] = 'snapshot-system-a';
    mockConfig.user_role[services.custom] = 'snapshot-user-a {{origin}} to {{to}}';
    const snapshot = createTranslationProviderConfigSnapshot(mockConfig);

    mockConfig.custom = 'https://snapshot-b.example/v1/chat/completions';
    mockConfig.token[services.custom] = 'snapshot-token-b';
    mockConfig.model[services.custom] = 'snapshot-model-b';
    mockConfig.customBody[services.custom] = '{"temperature":0.9,"snapshot":"b"}';
    mockConfig.system_role[services.custom] = 'snapshot-system-b';
    mockConfig.user_role[services.custom] = 'snapshot-user-b {{origin}} to {{to}}';

    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(translateWithOpenAICompatibleAiSdk(attachTranslationProviderConfig({
      origin: 'hello',
      serviceOverride: services.custom,
      targetLanguage: 'fr',
    }, snapshot))).resolves.toBe('译文');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://snapshot-a.example/v1/chat/completions');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer snapshot-token-a');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'snapshot-model-a',
      temperature: 0.2,
      snapshot: 'a',
      messages: [
        {role: 'system', content: 'snapshot-system-a'},
        {role: 'user', content: 'snapshot-user-a hello to fr'},
      ],
    });
  });

  it('classifies a missing custom endpoint as a permanent configuration error', async () => {
    mockConfig.custom = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    }).catch((reason) => reason);

    expect(error).toMatchObject({kind: 'bad-request', retryable: false});
    expect(error.message).toContain('未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes OpenAI-specific custom messages without SDK prompt-schema rejection', async () => {
    const customMessages = [
      {role: 'developer', content: 'Return only a translation.'},
      {role: 'user', content: [{type: 'text', text: 'hello'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA=='}}]},
    ];
    mockConfig.customBody[services.custom] = JSON.stringify({messages: customMessages});
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    })).resolves.toBe('译文');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages).toEqual(customMessages);
  });

  it('accepts valid translation text when optional provider metadata is non-standard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 123,
      created: 'now',
      choices: [{message: {content: '兼容旧 Custom 的译文'}, finish_reason: 0}],
      usage: {prompt_tokens: '12', completion_tokens: '4', total_tokens: '16'},
    }), {
      status: 200,
      headers: {'content-type': 'application/json'},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    })).resolves.toBe('兼容旧 Custom 的译文');
  });

  it('does not retry permanent authentication errors and redacts secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(
      401,
      `invalid api_key=sk-local-secret-value`,
      {'x-request-id': 'req-auth-test-sk-local-secret-value'},
    ));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'authentication',
      retryable: false,
      statusCode: 401,
      code: 'code-401',
    });
    expect(error.message).toContain('HTTP 401');
    expect(error.requestId).not.toContain('sk-local-secret-value');
    expect(error.message).toContain('req-auth-test');
    expect(error.message).not.toContain('sk-local-secret-value');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [services.minimax, 'invalid api key (code 2049)', 'Token Plan Key'],
    [services.mimo, 'invalid api key', '集群不匹配'],
  ])('retains specialized credential diagnostics for %s', async (service, providerMessage, expectedDetail) => {
    mockConfig.token[service] = 'sk-provider-test';
    mockConfig.model[service] = 'provider-model';
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, providerMessage));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: service,
    }).catch((reason) => reason);

    expect(error).toMatchObject({kind: 'authentication', retryable: false, statusCode: 401});
    expect(error.message).toContain(expectedDetail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets the SDK retry transient 429 responses and retains Retry-After metadata', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(errorResponse(
      429,
      'rate limited',
      {'retry-after': '1', 'retry-after-ms': '250', 'x-request-id': 'req-rate-test'},
    )));
    vi.stubGlobal('fetch', fetchMock);

    const request = translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 30_000,
    });
    const outcome = request.catch((reason) => reason);
    await vi.runAllTimersAsync();
    const error = await outcome;

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'rate-limit',
      retryable: true,
      statusCode: 429,
      retryAfterMs: 250,
      requestId: 'req-rate-test',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the configured maximum retry count for SDK-owned HTTP retries', async () => {
    vi.useFakeTimers();
    mockConfig.translationMaxRetries = 1;
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(errorResponse(429, 'rate limited')));
    vi.stubGlobal('fetch', fetchMock);

    const request = translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 30_000,
    });
    const outcome = request.catch((reason) => reason);
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toMatchObject({kind: 'rate-limit', statusCode: 429});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies a rejected browser fetch for the outer network-only fallback', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'network',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not misclassify SDK prompt/schema failures as retryable network errors', () => {
    const invalidPrompt = new Error('messages must not be empty');
    invalidPrompt.name = 'AI_InvalidPromptError';
    expect(normalizeAiSdkError(services.custom, invalidPrompt)).toMatchObject({
      kind: 'bad-request',
      retryable: false,
    });

    expect(normalizeAiSdkError(services.custom, new Error('Unexpected SDK response state'))).toMatchObject({
      kind: 'response',
      retryable: false,
    });
  });

  it('classifies an SDK deadline during Retry-After as timeout, not user cancellation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(
      429,
      'rate limited',
      {'retry-after': '10'},
    ));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 1_000,
    }).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'timeout',
      retryable: true,
    });
    expect(error.message).toContain('请求超时');
  });

  it('shares one absolute deadline across a sequential batch', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_input, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(successResponse()), 600);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      }, {once: true});
    }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = translateWithOpenAICompatibleAiSdk({
      origin: ['first', 'second'],
      serviceOverride: services.custom,
      requestTimeoutMs: 1_000,
    }).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;

    expect(error).toMatchObject({kind: 'timeout', retryable: true});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
