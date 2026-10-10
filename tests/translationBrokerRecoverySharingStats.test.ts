import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createTranslationBroker, type TranslationRequestMessage} from '@/src/services/translation/broker';
import {isTranslationLatencySample} from '@/src/services/translation-stats/aggregation';

function request(origin: string | string[]): TranslationRequestMessage {
  return Array.isArray(origin)
    ? {origin, useCache: false, requestTimeoutMs: 20000}
    : {origin, useCache: false, requestTimeoutMs: 20000};
}
vi.mock('@/src/services/config/store',()=>({config:{},configReady:Promise.resolve()}));
const batch=Array.from({length:63},(_,i)=>`Readable English paragraph for source slot ${i}.`);
const translated=(source:string|string[])=>Array.isArray(source)?source.map((_,i)=>`有效中文译文第${i}槽`):'有效中文译文';
function watch<T>(request:Promise<T>){const state:{at?:number;value?:T;error?:string}={};void request.then(value=>Object.assign(state,{at:Date.now(),value}),error=>Object.assign(state,{at:Date.now(),error:error.name+': '+error.message}));return state;}
function harness(provider: any, cache: any = undefined, events: any[] = []) {
  const current = {service: 'freeTranslation', from: 'en', to: 'zh-Hans', useCache: Boolean(cache),
    enableAIContext: false, token: {}, proxy: {}, model: {}, customModel: {}, maxConcurrentTranslations: 6,
    translationRequestsPerSecond: 0, translationRequestsPerMinute: 0,
    freeTranslationTimeoutMs: 5000, freeTranslationCooldownMs: 60000};
  return createTranslationBroker({ready: Promise.resolve(), getConfig: () => current,
    providers: {freeTranslation: provider},
    cache: cache ?? {get: async () => null, set: async () => true, clear: async () => {}, cleanup: async () => {}},
    recordTranslationRequest: (event: any) => events.push(event),
    serviceTypes: {machine: new Set(['freeTranslation']), isAI: () => false, isAiSdk: () => false, isUseAIContext: () => false},
    endpointResolver: {resolveOpenAICompatibleEndpoint: () => '', aiSdkTransportProfile: ''},
    promptBuilder: {buildPageSummaryPrompt: () => '', buildPageSummarySystemPrompt: () => ''},
    getMissingCredentialMessage: () => '', getTranslationLanguages: () => ({sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
    resolveConfiguredModel: () => '', buildTranslationCacheKey: (identity: Record<string, unknown>) => JSON.stringify(identity),
  } as any);
}

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No network in finite control');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();vi.unstubAllGlobals();});
function boundedProvider(starts:Array<{at:number;remaining:number}>){return vi.fn((m:any)=>{starts.push({at:Date.now(),remaining:m.requestTimeoutMs});if(starts.length===1)return new Promise((_,reject)=>m.abortSignal.addEventListener('abort',()=>reject(Object.assign(new Error('fixture aborted'),{name:'AbortError'})),{once:true}));return new Promise(resolve=>setTimeout(()=>resolve(translated(m.origin)),3000));});}
it.each(['single','63-slot'])('%s: identical simultaneous waiters keep one replacement provider work',async kind=>{
 const origin=kind==='single'?batch[0]:batch, starts:Array<{at:number;remaining:number}>=[],events:any[]=[];
 const broker=harness(boundedProvider(starts),undefined,events);
 const first=watch(broker.translateWithCache(request(origin)));
 await vi.advanceTimersByTimeAsync(15000);
 const later=[watch(broker.translateWithCache(request(origin))),watch(broker.translateWithCache(request(origin)))];
 await vi.advanceTimersByTimeAsync(20000);

 expect(first.error).toContain('DeadlineError');expect(later.every(x=>x.at!==undefined)).toBe(true);
 // Root may fail all shared waiters; a bounded recovery is allowed to add ONE shared replacement.
 // Same origin/key/budget and same absolute late deadline require no per-waiter duplicate work.
 expect(later.every(x=>x.error===undefined && x.at===23000)).toBe(true);
 expect(later.map(x=>x.value)).toEqual([translated(origin),translated(origin)]);
 expect(starts.filter(x=>x.at===20000)).toHaveLength(1);
 expect(starts).toHaveLength(2);
});
it('own recovery provider success is network and remains a latency sample',async()=>{
 const starts:Array<{at:number;remaining:number}>=[],events:any[]=[];const broker=harness(boundedProvider(starts),undefined,events);
 watch(broker.translateWithCache({origin:batch[0],useCache:false,requestTimeoutMs:20000}));
 await vi.advanceTimersByTimeAsync(15000);const later=watch(broker.translateWithCache({origin:batch[0],useCache:false,requestTimeoutMs:20000}));
 await vi.advanceTimersByTimeAsync(8000);const event=events.find(x=>x.startedAt===15000);

 expect(later.value).toBe(translated(batch[0]));expect(event.upstreamCalls).toBe(1);expect(event.outcome).toBe('success');
 expect(event.source).toBe('network');expect(isTranslationLatencySample(event)).toBe(true);
});
it('own recovery full cache hit is cache without also counting shared segments',async()=>{
 const starts:Array<{at:number;remaining:number}>=[],events:any[]=[];const cache={get:vi.fn(async()=>Date.now()>=20000?'有效中文缓存译文':null),set:vi.fn(async()=>true),clear:async()=>{},cleanup:async()=>{}};
 const broker=harness(boundedProvider(starts),cache,events);watch(broker.translateWithCache({origin:batch[0],requestTimeoutMs:20000}));
 await vi.advanceTimersByTimeAsync(15000);const later=watch(broker.translateWithCache({origin:batch[0],requestTimeoutMs:20000}));
 await vi.advanceTimersByTimeAsync(8000);const event=events.find(x=>x.startedAt===15000);

 expect(later.value).toBe('有效中文缓存译文');expect(starts).toHaveLength(1);expect(event.upstreamCalls).toBe(0);expect(event.cachedSegments).toBe(1);
 expect(event.source).toBe('cache');
});
