/** 公共预算验收：允许沿用现有成功合并，但旧 owner 的早到超时不能耗尽后发调用自己的预算。 */
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createTranslationBroker, type TranslationRequestMessage} from '@/src/services/translation/broker';

function request(origin: string | string[]): TranslationRequestMessage {
  return Array.isArray(origin)
    ? {origin, useCache: false, requestTimeoutMs: 20000}
    : {origin, useCache: false, requestTimeoutMs: 20000};
}
vi.mock('@/src/services/config/store', () => ({config: {}, configReady: Promise.resolve()}));
const batch = Array.from({length: 63}, (_, i) => `The United States paragraph contains readable English text, slot ${i}.`);
const translated = (source: string | string[]) => Array.isArray(source) ? source.map((_, i) => `第${i}槽有效中文译文`) : '有效中文译文';
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function watch<T>(request: Promise<T>) {
  const state: {at?: number; value?: T; error?: string} = {};
  void request.then(value => Object.assign(state, {at: Date.now(), value}),
    error => Object.assign(state, {at: Date.now(), error: error.name + ': ' + error.message}));
  return state;
}
function harness(provider: any) {
  const current = {service: 'freeTranslation', from: 'en', to: 'zh-Hans', useCache: false,
    enableAIContext: false, token: {}, proxy: {}, model: {}, customModel: {}, maxConcurrentTranslations: 6,
    translationRequestsPerSecond: 0, translationRequestsPerMinute: 0,
    freeTranslationTimeoutMs: 5000, freeTranslationCooldownMs: 60000};
  return createTranslationBroker({ready: Promise.resolve(), getConfig: () => current,
    providers: {freeTranslation: provider},
    cache: {get: async () => null, set: async () => true, clear: async () => {}, cleanup: async () => {}},
    serviceTypes: {machine: new Set(['freeTranslation']), isAI: () => false, isAiSdk: () => false, isUseAIContext: () => false},
    endpointResolver: {resolveOpenAICompatibleEndpoint: () => '', aiSdkTransportProfile: ''},
    promptBuilder: {buildPageSummaryPrompt: () => '', buildPageSummarySystemPrompt: () => ''},
    getMissingCredentialMessage: () => '', getTranslationLanguages: () => ({sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
    resolveConfiguredModel: () => '', buildTranslationCacheKey: (identity: Record<string, unknown>) => JSON.stringify(identity),
  } as any).translateWithCache;
}
beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(0);
  vi.stubGlobal('fetch', vi.fn(() => {throw new Error('Finite review forbids network');}));});
afterEach(() => {expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each(['single', '63-slot'])('%s: recover an inherited timeout within the original later-caller deadline', async kind => {
  const origin = kind === 'single' ? batch[0] : batch;
  const starts: Array<{at: number; remaining: number}> = [];
  const provider = vi.fn((m: any) => {
    starts.push({at: Date.now(), remaining: m.requestTimeoutMs});
    if (starts.length === 1) return new Promise((_, reject) => m.abortSignal.addEventListener('abort',
      () => reject(Object.assign(new Error('fixture aborted'), {name: 'AbortError'})), {once: true}));
    return new Promise(resolve => setTimeout(() => resolve(translated(m.origin)), 3000));
  });
  const translate = harness(provider);
  const first = watch(translate(request(origin))); await flush();
  await vi.advanceTimersByTimeAsync(15000);
  const later = watch(translate(request(origin))); await flush();
  await vi.advanceTimersByTimeAsync(8000);

  expect(later.value).toEqual(translated(origin)); expect(later.error).toBeUndefined();
  expect(later.at).toBeLessThanOrEqual(35000); expect(starts).toHaveLength(2);
  expect(starts[1].remaining).toBe(35000 - starts[1].at);
  expect(first.error).toContain('DeadlineError');
});

it.each(['single', '63-slot'])('%s: preserve one provider call when shared work succeeds for staggered callers', async kind => {
  const origin = kind === 'single' ? batch[0] : batch;
  const starts: number[] = [];
  const provider = vi.fn((m: any) => {starts.push(Date.now());
    return new Promise(resolve => setTimeout(() => resolve(translated(m.origin)), 18000));});
  const translate = harness(provider);
  const first = watch(translate(request(origin))); await flush();
  await vi.advanceTimersByTimeAsync(15000);
  const later = watch(translate(request(origin))); await flush();
  await vi.advanceTimersByTimeAsync(3000);

  expect(first.value).toEqual(translated(origin)); expect(later.value).toEqual(translated(origin));
  expect(starts).toEqual([0]);
});

it('63-slot: recovery consumes remaining 15s, ends at the original 35s and cannot retry a third time', async () => {
  const starts: Array<{at: number; remaining: number}> = [];
  const provider = vi.fn((m: any) => {starts.push({at: Date.now(), remaining: m.requestTimeoutMs});
    return new Promise((_, reject) => m.abortSignal.addEventListener('abort',
      () => reject(Object.assign(new Error('fixture aborted'), {name: 'AbortError'})), {once: true}));});
  const translate = harness(provider);
  watch(translate({origin: batch, useCache: false, requestTimeoutMs: 20000})); await flush();
  await vi.advanceTimersByTimeAsync(15000);
  const later = watch(translate({origin: batch, useCache: false, requestTimeoutMs: 20000})); await flush();
  await vi.advanceTimersByTimeAsync(20000);

  expect(later.at).toBe(35000); expect(later.error).toContain('DeadlineError');
  expect(starts).toEqual([{at: 0, remaining: 20000}, {at: 20000, remaining: 15000}]);
});

it('63-slot: ordinary shared provider failure never triggers a budget recovery', async () => {
  const starts: number[] = [];
  const provider = vi.fn(() => {starts.push(Date.now());
    return new Promise((_, reject) => setTimeout(() => reject(new Error('fixture provider failure')), 18000));});
  const translate = harness(provider);
  watch(translate({origin: batch, useCache: false, requestTimeoutMs: 20000})); await flush();
  await vi.advanceTimersByTimeAsync(15000);
  const later = watch(translate({origin: batch, useCache: false, requestTimeoutMs: 20000})); await flush();
  await vi.advanceTimersByTimeAsync(3000);

  expect(later.error).toContain('fixture provider failure'); expect(starts).toEqual([0]);
});
