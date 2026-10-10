/** 公共 outer 排队预算合同：检查公开 provider 参数及其 AbortSignal，不读 scheduler 内部状态。 */
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createTranslationBroker, type TranslationRequestMessage} from '@/src/services/translation/broker';

function request(origin: string | string[]): TranslationRequestMessage {
  return Array.isArray(origin)
    ? {origin, useCache: false, requestTimeoutMs: 20000}
    : {origin, useCache: false, requestTimeoutMs: 20000};
}
vi.mock('@/src/services/config/store', () => ({config: {}, configReady: Promise.resolve()}));
const flush = async () => {for (let i = 0; i < 80; i++) await Promise.resolve();};
function watch<T>(promise: Promise<T>) {
  const state: {at?: number; value?: T; error?: string} = {};
  void promise.then(value => Object.assign(state, {at: Date.now(), value}),
    error => Object.assign(state, {at: Date.now(), error: error.name + ': ' + error.message}));
  return state;
}
beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(0);
  vi.stubGlobal('fetch', vi.fn(() => {throw new Error('Finite review forbids network');}));});
afterEach(() => {expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});
it.each(['single', '63-slot'])('%s: 15s outer wait leaves precisely 5s in the provider request and aborts at 20s', async kind => {
  const starts: Array<{at: number; remaining: number; slots: number}> = [];
  let releaseFirst!: (value: string) => void;
  let secondSignal!: AbortSignal;
  const provider = vi.fn((m: any) => {
    starts.push({at: Date.now(), remaining: m.requestTimeoutMs, slots: Array.isArray(m.origin) ? m.origin.length : 1});
    if (starts.length === 1) return new Promise<string>(resolve => {releaseFirst = resolve;});
    secondSignal = m.abortSignal;
    return new Promise((_, reject) => m.abortSignal.addEventListener('abort',
      () => reject(Object.assign(new Error('fixture abort'), {name: 'AbortError'})), {once: true}));
  });
  const current = {service: 'freeTranslation', from: 'en', to: 'zh-Hans', useCache: false,
    enableAIContext: false, token: {}, proxy: {}, model: {}, customModel: {}, maxConcurrentTranslations: 1,
    translationRequestsPerSecond: 0, translationRequestsPerMinute: 0,
    freeTranslationTimeoutMs: 5000, freeTranslationCooldownMs: 60000};
  const translate = createTranslationBroker({ready: Promise.resolve(), getConfig: () => current,
    providers: {freeTranslation: provider},
    cache: {get: async () => null, set: async () => true, clear: async () => {}, cleanup: async () => {}},
    serviceTypes: {machine: new Set(['freeTranslation']), isAI: () => false, isAiSdk: () => false, isUseAIContext: () => false},
    endpointResolver: {resolveOpenAICompatibleEndpoint: () => '', aiSdkTransportProfile: ''},
    promptBuilder: {buildPageSummaryPrompt: () => '', buildPageSummarySystemPrompt: () => ''},
    getMissingCredentialMessage: () => '', getTranslationLanguages: () => ({sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
    resolveConfiguredModel: () => '', buildTranslationCacheKey: (identity: Record<string, unknown>) => JSON.stringify(identity),
  } as any).translateWithCache;
  const origin = kind === 'single' ? 'Queued readable English paragraph.'
    : Array.from({length: 63}, (_, i) => `Queued readable English paragraph ${i}.`);
  watch(translate({origin: 'Occupying readable English paragraph.', useCache: false, requestTimeoutMs: 20000}));
  const queued = watch(translate(request(origin))); await flush();
  await vi.advanceTimersByTimeAsync(15000); releaseFirst('有效中文译文'); await flush();
  expect(secondSignal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);

  expect(queued.at).toBe(20000); expect(queued.error).toContain('DeadlineError'); expect(secondSignal.aborted).toBe(true);
  expect(starts[1]).toEqual({at: 15000, remaining: 5000, slots: kind === 'single' ? 1 : 63});
});
