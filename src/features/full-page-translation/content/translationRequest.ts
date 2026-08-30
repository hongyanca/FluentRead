/**
 * @file src/features/full-page-translation/content/translationRequest.ts
 * 文件职责：为单次全文翻译会话冻结请求配置，并执行文本槽的批量、AI 跨候选合并、分包、回退与会话级结果复用。
 * 主要内容：捕获服务/模型/语言/缓存/展示快照，构造显式 client 参数，按服务选择批译策略，严格隔离 AI 批次快照并维护有界的会话槽缓存。
 * 模块边界：本文件不发现候选、不持有 DOM 翻译状态也不渲染译文；runtime 提供会话缓存和取消作用域，client 负责后台协议与队列执行。
 */
import {resolveConfiguredModel, services, servicesType} from '@/src/core/config/catalog';
import {styles} from '@/src/core/config/constants';
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/public';
import {applyTranslationOutputFilter} from '@/src/core/translation/text';
import {config} from '@/src/services/config/store';
import {translateText, translateTextBatch, type TranslateOptions} from '@/src/app/translation/client';
import {
    cancelTranslationQueueSession,
    createTranslationQueueSession,
    type TranslationQueueSession,
} from '@/src/services/translation/queue';

const FULL_PAGE_TRANSLATION_CACHE_LIMIT = 512;
const AI_MULTI_SEGMENT_MAX_TEXT_SLOTS = 4;
const AI_MULTI_SEGMENT_MAX_CHARACTERS = 2_000;

export interface FullPageTranslationConfigSnapshot {
    service: string;
    model: string;
    sourceLanguage: string;
    targetLanguage: string;
    useCache: boolean;
    enableAIMultiSegment: boolean;
    outputFilter?: string;
    displayMode: 'bilingual' | 'single';
    style: number;
}

export interface FullPageTranslationCacheEntry {
    promise: Promise<string | undefined>;
    settled: boolean;
}

type SnapshotTranslateExecutionOptions = Pick<
    TranslateOptions,
    'aiMultiSegment' | 'queueSession' | 'signal' | 'skipLanguageDetection' | 'useCache'
>;

interface FullPageTranslationSessionCache {
    active: boolean;
    translationSlotCache: Map<string, FullPageTranslationCacheEntry>;
}

interface AIMultiSegmentTask {
    origins: readonly string[];
    snapshot: FullPageTranslationConfigSnapshot;
    signal?: AbortSignal;
    queueSession?: TranslationQueueSession;
    settled: boolean;
    resolve: (translations: string[]) => void;
    reject: (error: unknown) => void;
    removeAbortListener: () => void;
    abortSharedBatch?: () => void;
}

interface AIMultiSegmentQueue {
    pending: AIMultiSegmentTask[];
    flushScheduled: boolean;
}

const aiMultiSegmentQueues = new WeakMap<FullPageTranslationSessionCache, AIMultiSegmentQueue>();

export function captureFullPageTranslationConfig(): FullPageTranslationConfigSnapshot {
    const service = config.service;
    return {
        service,
        model: resolveConfiguredModel(config.model[service], config.customModel[service]),
        sourceLanguage: config.from,
        targetLanguage: config.to,
        useCache: config.useCache,
        enableAIMultiSegment: config.enableAIMultiSegment,
        outputFilter: config.outputFilter,
        displayMode: config.display === styles.bilingualTranslation ? 'bilingual' : 'single',
        style: config.style,
    };
}

function createSnapshotTranslateOptions(
    snapshot: FullPageTranslationConfigSnapshot,
    options: SnapshotTranslateExecutionOptions = {},
): TranslateOptions {
    return {
        ...options,
        serviceOverride: snapshot.service,
        modelOverride: snapshot.model || undefined,
        sourceLanguage: snapshot.sourceLanguage,
        targetLanguage: snapshot.targetLanguage,
        // 非会话 batch 需要显式禁用 broker 缓存；其余调用继续使用冻结的会话值。
        useCache: options.useCache ?? snapshot.useCache,
    };
}

function createAbortError(): Error {
    try {
        return new DOMException('翻译已取消', 'AbortError');
    } catch {
        const error = new Error('翻译已取消');
        error.name = 'AbortError';
        return error;
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

async function translateSlotsIndividually(
    origins: readonly string[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<string[]> {
    throwIfAborted(signal);
    const translations = new Array<string>(origins.length);
    let nextIndex = 0;
    const workerCount = Math.min(3, origins.length);
    let failed = false;
    let firstError: unknown;
    let hasFirstError = false;
    const siblingController = new AbortController();
    const abortSiblings = () => {
        siblingController.abort();
        if (queueSession) cancelTranslationQueueSession(queueSession, createAbortError());
    };
    signal?.addEventListener('abort', abortSiblings, {once: true});
    const workers = Array.from({length: workerCount}, async () => {
        while (!failed && nextIndex < origins.length) {
            throwIfAborted(siblingController.signal);
            const index = nextIndex++;
            try {
                translations[index] = await translateText(origins[index] ?? '', document.title,
                    createSnapshotTranslateOptions(snapshot, {signal: siblingController.signal, queueSession}));
            } catch (error) {
                if (!hasFirstError) {
                    hasFirstError = true;
                    firstError = error;
                }
                failed = true;
                siblingController.abort();
                if (queueSession) cancelTranslationQueueSession(queueSession, firstError);
                throw error;
            }
        }
    });
    try {
        const outcomes = await Promise.allSettled(workers);
        if (hasFirstError) throw firstError;
        const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (rejected) throw rejected.reason;
        return translations;
    } finally {
        signal?.removeEventListener('abort', abortSiblings);
    }
}

function createCacheKey(origin: string, snapshot: FullPageTranslationConfigSnapshot): string {
    return JSON.stringify({
        service: snapshot.service,
        model: snapshot.model,
        from: snapshot.sourceLanguage,
        to: snapshot.targetLanguage,
        origin,
    });
}

function rememberTranslation(
    session: FullPageTranslationSessionCache,
    key: string,
    result: Promise<string | undefined>,
): void {
    const entry: FullPageTranslationCacheEntry = {promise: result, settled: false};
    session.translationSlotCache.delete(key);
    session.translationSlotCache.set(key, entry);
    while (session.translationSlotCache.size > FULL_PAGE_TRANSLATION_CACHE_LIMIT) {
        const oldestKey = session.translationSlotCache.keys().next().value as string;
        session.translationSlotCache.delete(oldestKey);
    }
    void result.then(
        () => {
            if (session.translationSlotCache.get(key) === entry) entry.settled = true;
        },
        () => {
            if (session.translationSlotCache.get(key) === entry) session.translationSlotCache.delete(key);
        },
    );
}

function resolveAIMultiSegmentTask(task: AIMultiSegmentTask, translations: string[]): void {
    if (task.settled) return;
    task.settled = true;
    task.removeAbortListener();
    task.resolve(translations);
}

function rejectAIMultiSegmentTask(task: AIMultiSegmentTask, error: unknown): void {
    if (task.settled) return;
    task.settled = true;
    task.removeAbortListener();
    task.reject(error);
}

function shouldFallbackAIMultiSegmentBatch(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {kind?: unknown; code?: unknown};
    return candidate.kind === 'response'
        && candidate.code === 'AI_MULTI_SEGMENT_RESPONSE_INVALID';
}

function createAIMultiSegmentSnapshotKey(snapshot: FullPageTranslationConfigSnapshot): string {
    return JSON.stringify({
        service: snapshot.service,
        model: snapshot.model,
        from: snapshot.sourceLanguage,
        to: snapshot.targetLanguage,
        useCache: snapshot.useCache,
        outputFilter: snapshot.outputFilter,
    });
}

function takeAIMultiSegmentBatch(queue: AIMultiSegmentQueue): AIMultiSegmentTask[] {
    const batch: AIMultiSegmentTask[] = [];
    let characters = 0;
    let textSlots = 0;
    let snapshotKey = '';
    while (queue.pending.length > 0) {
        const next = queue.pending[0]!;
        if (next.settled || next.signal?.aborted) {
            queue.pending.shift();
            continue;
        }
        const nextSnapshotKey = createAIMultiSegmentSnapshotKey(next.snapshot);
        if (batch.length > 0 && nextSnapshotKey !== snapshotKey) break;
        const nextCharacters = next.origins.reduce((total, origin) => total + (origin?.length ?? 0), 0);
        const nextTextSlots = next.origins.length;
        if (batch.length > 0 && (
            textSlots + nextTextSlots > AI_MULTI_SEGMENT_MAX_TEXT_SLOTS
            || characters + nextCharacters > AI_MULTI_SEGMENT_MAX_CHARACTERS
        )) break;
        queue.pending.shift();
        batch.push(next);
        snapshotKey = nextSnapshotKey;
        textSlots += nextTextSlots;
        characters += nextCharacters;
    }
    return batch;
}

async function fallbackAIMultiSegmentTasks(tasks: readonly AIMultiSegmentTask[]): Promise<void> {
    const activeTasks = tasks.filter((task) => !task.settled && !task.signal?.aborted);
    // 多段协议已失败时直接逐槽降级，不再为每个候选重试一次相同结构化协议。
    const outcomes = await Promise.allSettled(activeTasks.map((task) => translateSlotsIndividually(
        task.origins,
        task.snapshot,
        task.signal,
        task.queueSession,
    )));
    outcomes.forEach((outcome, index) => {
        const task = activeTasks[index];
        if (!task) return;
        if (outcome.status === 'fulfilled') resolveAIMultiSegmentTask(task, outcome.value);
        else rejectAIMultiSegmentTask(task, outcome.reason);
    });
}

async function executeAIMultiSegmentBatch(tasks: AIMultiSegmentTask[]): Promise<void> {
    const activeTasks = tasks.filter((task) => !task.settled && !task.signal?.aborted);
    if (activeTasks.length === 0) return;
    if (activeTasks.length === 1) {
        const task = activeTasks[0]!;
        try {
            resolveAIMultiSegmentTask(task, await translateTextSlotsDirectly(
                task.origins,
                task.snapshot,
                task.signal,
                task.queueSession,
            ));
        } catch (error) {
            rejectAIMultiSegmentTask(task, error);
        }
        return;
    }

    const snapshot = activeTasks[0]!.snapshot;
    const controller = new AbortController();
    const sharedQueueSession = createTranslationQueueSession();
    const abortSharedBatchIfUnused = () => {
        if (activeTasks.some((task) => !task.settled && !task.signal?.aborted)) return;
        if (!controller.signal.aborted) controller.abort();
        cancelTranslationQueueSession(sharedQueueSession, createAbortError());
    };
    activeTasks.forEach((task) => {
        task.abortSharedBatch = abortSharedBatchIfUnused;
    });

    const origins = activeTasks.flatMap((task) => [...task.origins]);
    try {
        const translations = await translateTextBatch(
            origins,
            document.title,
            createSnapshotTranslateOptions(snapshot, {
                aiMultiSegment: true,
                signal: controller.signal,
                queueSession: sharedQueueSession,
            }),
        );
        let offset = 0;
        activeTasks.forEach((task) => {
            const nextOffset = offset + task.origins.length;
            resolveAIMultiSegmentTask(task, translations.slice(offset, nextOffset));
            offset = nextOffset;
        });
    } catch (error) {
        if (shouldFallbackAIMultiSegmentBatch(error)) {
            await fallbackAIMultiSegmentTasks(activeTasks);
        } else if (!isAbortError(error) || activeTasks.some((task) => !task.settled)) {
            activeTasks.forEach((task) => rejectAIMultiSegmentTask(task, error));
        }
    } finally {
        activeTasks.forEach((task) => {
            task.abortSharedBatch = undefined;
        });
    }
}

function flushAIMultiSegmentQueue(queue: AIMultiSegmentQueue): void {
    queue.flushScheduled = false;
    while (queue.pending.length > 0) {
        const batch = takeAIMultiSegmentBatch(queue);
        if (batch.length === 0) continue;
        void executeAIMultiSegmentBatch(batch);
    }
}

function enqueueAIMultiSegmentTask(
    origins: readonly string[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal: AbortSignal | undefined,
    queueSession: TranslationQueueSession | undefined,
    session: FullPageTranslationSessionCache,
): Promise<string[]> {
    throwIfAborted(signal);
    let queue = aiMultiSegmentQueues.get(session);
    if (!queue) {
        queue = {pending: [], flushScheduled: false};
        aiMultiSegmentQueues.set(session, queue);
    }

    return new Promise<string[]>((resolve, reject) => {
        const task: AIMultiSegmentTask = {
            origins,
            snapshot,
            signal,
            queueSession,
            settled: false,
            resolve,
            reject,
            removeAbortListener: () => undefined,
        };
        const onAbort = () => {
            rejectAIMultiSegmentTask(task, createAbortError());
            task.abortSharedBatch?.();
        };
        if (signal) {
            signal.addEventListener('abort', onAbort, {once: true});
            task.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        }
        queue!.pending.push(task);
        if (!queue!.flushScheduled) {
            queue!.flushScheduled = true;
            const schedule = globalThis.queueMicrotask
                ?? ((callback: VoidFunction) => void Promise.resolve().then(callback));
            schedule(() => flushAIMultiSegmentQueue(queue!));
        }
    });
}

async function translateTextSlotsDirectly(
    origins: readonly string[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
): Promise<string[]> {
    if (origins.length === 0) return [];
    throwIfAborted(signal);
    const batchFriendly = snapshot.service === services.microsoft
        || snapshot.service === services.freeTranslation;
    if (batchFriendly) {
        if (!fullPageSession?.active) {
            return translateTextBatch([...origins], document.title,
                createSnapshotTranslateOptions(snapshot, {useCache: false, signal, queueSession}));
        }

        const resultPromises = new Array<Promise<string | undefined>>(origins.length);
        const missing = new Map<string, {origin: string; indexes: number[]}>();
        for (const [index, origin] of origins.entries()) {
            const key = createCacheKey(origin, snapshot);
            const cached = fullPageSession.translationSlotCache.get(key);
            if (cached?.settled) {
                resultPromises[index] = cached.promise;
                continue;
            }
            const entry = missing.get(key);
            if (entry) entry.indexes.push(index);
            else missing.set(key, {origin, indexes: [index]});
        }

        if (missing.size > 0) {
            const entries = [...missing.values()];
            const providerRequest = translateTextBatch(
                entries.map(({origin}) => origin),
                document.title,
                createSnapshotTranslateOptions(snapshot, {signal, queueSession}),
            ).then((translations) =>
                Array.isArray(translations) && translations.length === entries.length
                && translations.every((translation) => typeof translation === 'string')
                    ? translations
                    : null,
            );
            entries.forEach(({origin, indexes}, entryIndex) => {
                const key = createCacheKey(origin, snapshot);
                const result = providerRequest.then((translations) => translations?.[entryIndex]);
                rememberTranslation(fullPageSession, key, result);
                indexes.forEach((index) => {
                    resultPromises[index] = result;
                });
            });
        }

        const translations = await Promise.all(resultPromises);
        if (translations.some((translation) => typeof translation !== 'string')) {
            fullPageSession.translationSlotCache.clear();
            return [];
        }
        return translations as string[];
    }
    if (origins.length === 1) {
        return [await translateText(origins[0] ?? '', document.title,
            createSnapshotTranslateOptions(snapshot, {signal, queueSession}))];
    }

    const packet = serializeTranslationSlots(origins);
    const combined = await translateText(packet.payload, document.title, createSnapshotTranslateOptions(snapshot, {
        skipLanguageDetection: true,
        signal,
        queueSession,
    }));
    const parsed = parseTranslationSlots(packet, combined);
    if (parsed?.length === origins.length) return parsed;
    return translateSlotsIndividually(origins, snapshot, signal, queueSession);
}

export async function translateTextSlots(
    origins: readonly string[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
): Promise<string[]> {
    if (origins.length === 0) return [];
    throwIfAborted(signal);
    const canCombineAIParagraphs = snapshot.enableAIMultiSegment
        && servicesType.isUseAIContext(snapshot.service, snapshot.model)
        && fullPageSession?.active;
    const translations = canCombineAIParagraphs
        ? await enqueueAIMultiSegmentTask(origins, snapshot, signal, queueSession, fullPageSession)
        : await translateTextSlotsDirectly(origins, snapshot, signal, queueSession, fullPageSession);
    return translations.map((translation) => applyTranslationOutputFilter(translation, snapshot.outputFilter || ''));
}
