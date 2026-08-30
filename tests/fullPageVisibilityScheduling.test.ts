import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parseHTML} from "linkedom";

const runtime = vi.hoisted(() => ({
    candidates: [] as Array<{
        element: HTMLElement;
        kind: "content";
        reason: string;
        nodes?: readonly Node[];
        adapterId?: string;
    }>,
    pointCandidate: null as {
        element: HTMLElement;
        kind: "content";
        reason: string;
        nodes?: readonly Node[];
        adapterId?: string;
    } | null,
    requests: vi.fn<(origins: readonly string[]) => Promise<string[]>>(async (origins) =>
        origins.map((origin) => `译:${origin}`),
    ),
    requestOptions: [] as Array<Record<string, unknown>>,
    renderOptions: [] as Array<Record<string, unknown>>,
    parsedSlots: null as string[] | null,
    cancelQueue: vi.fn(),
    retryCallbacks: [] as Array<() => void>,
    config: {
        service: "microsoft",
        model: {microsoft: "microsoft-default", freeTranslation: "free-default"} as Record<string, string>,
        customModel: {} as Record<string, string>,
        from: "en",
        to: "zh",
        useCache: true,
        enableAIMultiSegment: false,
        display: 0,
        style: 0,
        fullPageTranslationMode: "viewport" as "viewport" | "all",
    },
    ensureTranslationTruncationLayout: vi.fn(() => true),
}));

vi.mock("@/src/app/translation/check", () => ({checkConfig: () => true}));
vi.mock("@/src/core/config/catalog", () => ({
    services: {microsoft: "microsoft", freeTranslation: "freeTranslation"},
    servicesType: {
        isUseAIContext: (service: string) => service === 'ai',
    },
    resolveConfiguredModel: (selected?: string, custom?: string) => selected === 'custom'
        ? custom || ''
        : selected || '',
}));
vi.mock("@/src/core/config/constants", () => ({
    styles: {singleTranslation: 0, bilingualTranslation: 1},
}));
vi.mock("@/src/services/config/store", () => ({
    config: runtime.config,
}));
vi.mock("@/src/core/language/detect", () => ({detectlang: () => ""}));
vi.mock("@/src/app/translation/client", () => ({
    translateText: async (origin: string, _context: string, options: Record<string, unknown>) => {
        runtime.requestOptions.push(options);
        return (await runtime.requests([origin]))[0];
    },
    translateTextBatch: (origins: readonly string[], _context: string, options: Record<string, unknown>) => {
        runtime.requestOptions.push(options);
        return runtime.requests(origins);
    },
}));
vi.mock("@/src/services/translation/queue", () => ({
    createTranslationQueueSession: () => ({}),
    cancelTranslationQueueSession: runtime.cancelQueue,
}));
vi.mock('@/src/features/full-page-translation/ui/translationIndicators', () => ({
    insertLoadingSpinner: (node: HTMLElement) => {
        const spinner = node.ownerDocument.createElement("span");
        spinner.setAttribute("data-fr-translation-owned", "true");
        node.appendChild(spinner);
        return spinner;
    },
    insertFailedTip: (node: HTMLElement, _message: string, onRetry: () => void) => {
        runtime.retryCallbacks.push(onRetry);
        return node.ownerDocument.createElement("span");
    },
}));
vi.mock("@/src/features/full-page-translation/content/renderer", () => ({
    appendBilingualTranslation: (node: HTMLElement, text: string, options: Record<string, unknown> = {}) => {
        runtime.renderOptions.push(options);
        const wrapper = node.ownerDocument.createElement("span");
        wrapper.className = "fluent-read-bilingual-content";
        wrapper.setAttribute("data-fr-translation-owned", "true");
        wrapper.lang = typeof options.targetLanguage === 'string' ? options.targetLanguage : '';
        wrapper.textContent = text;
        node.appendChild(wrapper);
        return wrapper;
    },
}));
vi.mock("@/src/features/full-page-translation/content/layout", () => ({
    ensureTranslationTruncationLayout: runtime.ensureTranslationTruncationLayout,
}));
vi.mock("@/src/core/translation/public", () => {
    const protectedSelector = [
        "head", "script", "style", "noscript", "iframe", "input", "textarea", "select", "option",
        "math", "svg", "canvas", "audio", "video", "object", "template", "xmp", "pre", "code",
        "kbd", "samp", "var", "mjx-container", ".MathJax_Display", ".MathJax", ".MathJax_Preview",
        ".katex", ".notranslate", "[translate='no']", "[data-notranslate='true']", "[hidden]",
        "[inert]", "[aria-hidden='true']",
    ].join(",");
    const isProtected = (element: Element) => Boolean(element.closest(protectedSelector));
    const textSlots = (element: HTMLElement) => {
        const slots: Array<{node: Text; prefix: string; source: string; suffix: string}> = [];
        const walker = element.ownerDocument.createTreeWalker(element, 4);
        let current = walker.nextNode();
        while (current) {
            const node = current as Text;
            const source = node.nodeValue ?? "";
            if (source.trim() && node.parentElement && !isProtected(node.parentElement) &&
                !node.parentElement.closest('[data-fr-translation-owned="true"]')) {
                slots.push({node, prefix: "", source, suffix: ""});
            }
            current = walker.nextNode();
        }
        return slots;
    };

    return {
        extractTranslationText: (element: HTMLElement) => textSlots(element).map(({source}) => source).join(""),
        extractTranslationTextFromNodes: (nodes: readonly Node[]) =>
            nodes.map((node) => node.textContent ?? "").join(""),
        applyTranslationsToSnapshot: (_snapshot: unknown, translations: readonly string[]) => translations.join(""),
        collectLiveTranslationTextSlots: textSlots,
        createTranslationSourceSnapshot: (element: HTMLElement) => ({
            slots: textSlots(element).map(({source}) => ({source})),
        }),
        evaluateHardGuard: (element: Element) => ({prune: isProtected(element)}),
        getComposedParent: (element: Element) => element.parentElement ??
            ((element.getRootNode?.() as {host?: Element})?.host ?? null),
        isProtectedDescendantElement: (element: Element) => element.matches(protectedSelector),
        getCurrentTranslationCore: () => ({
            shouldStayOriginal: () => false,
            shouldIgnoreMutation: () => false,
            inspect: (element: HTMLElement) => ({
                candidate: [...runtime.candidates].reverse().find((candidate) =>
                    candidate.element === element && !isProtected(candidate.element)),
            }),
            resolve: (start: Node | null | undefined) => [...runtime.candidates].reverse().find((candidate) => {
                if (!start || isProtected(candidate.element)) return false;
                const key = candidate.nodes?.[0] ?? candidate.element;
                return key === start || candidate.element === start || candidate.element.contains(start);
            }),
            *discoverSteps() {
                for (const segment of document.querySelectorAll<HTMLElement>(
                    '[data-fr-translation-segment="true"]',
                )) {
                    yield {phase: "enter", element: segment};
                }
                for (const candidate of runtime.candidates) {
                    if (isProtected(candidate.element)) continue;
                    if (candidate.element.matches('[data-fr-translation-segment="true"]') ||
                        candidate.element.querySelector('[data-fr-translation-segment="true"]')) continue;
                    yield {
                        phase: "exit",
                        element: candidate.element,
                        candidate,
                    };
                }
            },
        }),
        getOpenShadowRoots: () => [],
        getTranslationCandidateKey: (candidate: {element: HTMLElement; nodes?: readonly Node[]}) =>
            candidate.nodes?.[0] ?? candidate.element,
        isClearlyTargetLanguage: () => false,
        parseTranslationSlots: () => runtime.parsedSlots,
        resolveTranslationCandidate: (start: Node | null | undefined) =>
            [...runtime.candidates].reverse().find((candidate) => candidate.element === start),
        resolveTranslationCandidateAtPoint: () => runtime.pointCandidate,
        selectPreferredTranslationCandidate: (
            existing: {element: HTMLElement; adapterId?: string},
            candidate: {element: HTMLElement; adapterId?: string},
        ) => candidate.adapterId ? candidate : existing,
        serializeTranslationSlots: (origins: readonly string[]) => ({payload: origins.join("\n")}),
    };
});

import {
    autoTranslateEnglishPage,
    handleBilingualTranslation,
    handleTranslation,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from "@/src/features/full-page-translation/content/runtime";
import {getTranslationState} from "@/src/features/full-page-translation/content/state";
import {
    getFullPageTranslationProgress,
    subscribeFullPageTranslationProgress,
    type FullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';
import {
    captureFullPageTranslationConfig,
    translateTextSlots,
    type FullPageTranslationConfigSnapshot,
} from '@/src/features/full-page-translation/content/translationRequest';

class TestIntersectionObserver {
    static instances: TestIntersectionObserver[] = [];

    readonly observed = new Set<Element>();
    readonly observe = vi.fn((target: Element) => this.observed.add(target));
    readonly unobserve = vi.fn((target: Element) => this.observed.delete(target));
    readonly disconnect = vi.fn(() => this.observed.clear());

    constructor(private readonly callback: IntersectionObserverCallback) {
        TestIntersectionObserver.instances.push(this);
    }

    emit(target: Element, isIntersecting: boolean): void {
        this.callback([{target, isIntersecting} as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}

class TestMutationObserver {
    static instances: TestMutationObserver[] = [];

    readonly observe = vi.fn();
    readonly disconnect = vi.fn();
    readonly takeRecords = vi.fn(() => [] as MutationRecord[]);

    constructor(private readonly callback: MutationCallback) {
        TestMutationObserver.instances.push(this);
    }

    emit(records: MutationRecord[]): void {
        this.callback(records, this as unknown as MutationObserver);
    }
}

const replacedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function replaceGlobal(name: PropertyKey, value: unknown): void {
    if (!replacedGlobals.has(name)) replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

function setLayoutBox(element: Element, width: number, height: number): void {
    const rect = {width, height, top: 0, right: width, bottom: height, left: 0, x: 0, y: 0};
    Object.defineProperty(element, "getClientRects", {
        configurable: true,
        value: () => width > 0 && height > 0
            ? Object.assign([rect], {item: (index: number) => index === 0 ? rect : null})
            : Object.assign([], {item: () => null}),
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function translationSnapshot(
    overrides: Partial<FullPageTranslationConfigSnapshot> = {},
): FullPageTranslationConfigSnapshot {
    return {
        service: 'microsoft',
        model: 'microsoft-default',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        useCache: true,
        enableAIMultiSegment: false,
        displayMode: 'bilingual',
        style: 0,
        ...overrides,
    };
}

async function finishScheduledWork(): Promise<void> {
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
}

describe("全文翻译可见性锚点", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        runtime.candidates = [];
        runtime.pointCandidate = null;
        runtime.requests.mockReset();
        runtime.requests.mockImplementation(async (origins) => origins.map((origin) => `译:${origin}`));
        runtime.requestOptions = [];
        runtime.renderOptions = [];
        runtime.parsedSlots = null;
        runtime.cancelQueue.mockReset();
        runtime.retryCallbacks = [];
        runtime.config.service = "microsoft";
        runtime.config.model = {microsoft: "microsoft-default", freeTranslation: "free-default"};
        runtime.config.customModel = {};
        runtime.config.from = "en";
        runtime.config.to = "zh";
        runtime.config.useCache = true;
        runtime.config.enableAIMultiSegment = false;
        runtime.config.display = 0;
        runtime.config.style = 0;
        runtime.config.fullPageTranslationMode = "viewport";
        runtime.ensureTranslationTruncationLayout.mockClear();
        TestIntersectionObserver.instances = [];
        TestMutationObserver.instances = [];

        const {window, document} = parseHTML("<html><head><title>Fixture</title></head><body></body></html>");
        replaceGlobal("window", window);
        replaceGlobal("document", document);
        replaceGlobal("Node", window.Node);
        replaceGlobal("Element", window.Element);
        replaceGlobal("HTMLElement", window.HTMLElement);
        replaceGlobal("Text", window.Text);
        replaceGlobal("ShadowRoot", window.ShadowRoot);
        replaceGlobal("DOMParser", window.DOMParser);
        replaceGlobal("MutationObserver", TestMutationObserver);
        replaceGlobal("IntersectionObserver", TestIntersectionObserver);
        Object.defineProperty(window, "setTimeout", {configurable: true, value: globalThis.setTimeout});
        Object.defineProperty(window, "clearTimeout", {configurable: true, value: globalThis.clearTimeout});
    });

    afterEach(() => {
        restoreOriginalContent();
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const [name, descriptor] of replacedGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
        replacedGlobals.clear();
    });

    it("全文会话集中发布启动和结束状态事件", () => {
        const states: string[] = [];
        document.addEventListener("fluentread-translation-started", () => states.push("started"));
        document.addEventListener("fluentread-translation-ended", () => states.push("ended"));

        autoTranslateEnglishPage();
        expect(isFullPageTranslationActive()).toBe(true);
        expect(states).toEqual(["started"]);

        restoreOriginalContent();
        expect(isFullPageTranslationActive()).toBe(false);
        expect(states).toEqual(["started", "ended"]);
    });

    it('请求配置快照解析自定义模型并冻结单/双语展示模式', () => {
        runtime.config.model.microsoft = 'custom';
        runtime.config.customModel.microsoft = 'session-model';
        runtime.config.display = 1;
        expect(captureFullPageTranslationConfig()).toMatchObject({
            service: 'microsoft',
            model: 'session-model',
            sourceLanguage: 'en',
            targetLanguage: 'zh',
            useCache: true,
            enableAIMultiSegment: false,
            displayMode: 'bilingual',
        });
        runtime.config.display = 0;
        expect(captureFullPageTranslationConfig().displayMode).toBe('single');
    });

    it('文本槽请求覆盖空输入、非批量单槽、结构化解析和逐槽回退', async () => {
        const snapshot = translationSnapshot({service: 'custom-provider', model: ''});
        expect(await translateTextSlots([], snapshot)).toEqual([]);

        expect(await translateTextSlots(['Single'], snapshot)).toEqual(['译:Single']);
        expect(runtime.requestOptions.at(-1)).toMatchObject({
            serviceOverride: 'custom-provider',
            modelOverride: undefined,
            sourceLanguage: 'en',
            targetLanguage: 'zh',
        });

        runtime.parsedSlots = ['结构一', '结构二'];
        expect(await translateTextSlots(['One', 'Two'], snapshot)).toEqual(['结构一', '结构二']);

        runtime.parsedSlots = null;
        runtime.requests.mockClear();
        expect(await translateTextSlots(['One', undefined as never], snapshot)).toEqual(['译:One', '译:']);
        expect(runtime.requests).toHaveBeenCalledTimes(3);
        expect(await translateTextSlots([undefined as never], snapshot)).toEqual(['译:']);
    });

    it('AI 多段开关只在活跃全文会话中合并相邻候选，并遵守字符上限', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });

        const first = translateTextSlots(['First paragraph'], enabled, undefined, undefined, session);
        const second = translateTextSlots(['Second paragraph'], enabled, undefined, undefined, session);
        await expect(Promise.all([first, second])).resolves.toEqual([
            ['译:First paragraph'],
            ['译:Second paragraph'],
        ]);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenLastCalledWith(['First paragraph', 'Second paragraph']);
        expect(runtime.requestOptions.at(-1)).toMatchObject({aiMultiSegment: true});

        runtime.requests.mockClear();
        const disabled = translationSnapshot({service: 'ai', model: 'ai-model'});
        await expect(Promise.all([
            translateTextSlots(['First paragraph'], disabled, undefined, undefined, session),
            translateTextSlots(['Second paragraph'], disabled, undefined, undefined, session),
        ])).resolves.toEqual([['译:First paragraph'], ['译:Second paragraph']]);
        expect(runtime.requests).toHaveBeenCalledTimes(2);

        runtime.requests.mockClear();
        const longFirst = 'A'.repeat(1_500);
        const longSecond = 'B'.repeat(600);
        await Promise.all([
            translateTextSlots([longFirst], enabled, undefined, undefined, session),
            translateTextSlots([longSecond], enabled, undefined, undefined, session),
        ]);
        expect(runtime.requests).toHaveBeenCalledTimes(2);
    });

    it('AI 多段按完整请求快照分批，并以四个文本槽为硬上限', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const firstModel = translationSnapshot({
            service: 'ai',
            model: 'first-model',
            enableAIMultiSegment: true,
        });
        const secondModel = translationSnapshot({
            service: 'ai',
            model: 'second-model',
            enableAIMultiSegment: true,
        });

        await expect(Promise.all([
            translateTextSlots(['First'], firstModel, undefined, undefined, session),
            translateTextSlots(['Second'], secondModel, undefined, undefined, session),
        ])).resolves.toEqual([['译:First'], ['译:Second']]);
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requestOptions.map((options) => options.modelOverride)).toEqual([
            'first-model',
            'second-model',
        ]);

        runtime.requests.mockClear();
        runtime.requestOptions = [];
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        await expect(Promise.all([
            translateTextSlots(['A1', 'A2'], enabled, undefined, undefined, session),
            translateTextSlots(['B1', 'B2'], enabled, undefined, undefined, session),
            translateTextSlots(['C1'], enabled, undefined, undefined, session),
        ])).resolves.toEqual([
            ['译:A1', '译:A2'],
            ['译:B1', '译:B2'],
            ['译:C1'],
        ]);
        expect(runtime.requests.mock.calls.map(([origins]) => origins)).toEqual([
            ['A1', 'A2', 'B1', 'B2'],
            ['C1'],
        ]);
        expect(runtime.requestOptions[0]).toMatchObject({aiMultiSegment: true});
        expect(runtime.requestOptions[1]).not.toHaveProperty('aiMultiSegment');
    });

    it('AI 多段协议错误直接逐槽降级，且普通 provider 错误不放大请求', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        let requestCount = 0;
        runtime.requests.mockImplementation(async (origins) => {
            requestCount += 1;
            if (requestCount === 1) {
                throw {
                    kind: 'response',
                    code: 'AI_MULTI_SEGMENT_RESPONSE_INVALID',
                    message: 'localized message may change',
                };
            }
            return origins.map((origin) => `译:${origin}`);
        });

        await expect(Promise.all([
            translateTextSlots(['A1', 'A2'], enabled, undefined, undefined, session),
            translateTextSlots(['B1', 'B2'], enabled, undefined, undefined, session),
        ])).resolves.toEqual([
            ['译:A1', '译:A2'],
            ['译:B1', '译:B2'],
        ]);
        expect(runtime.requests).toHaveBeenCalledTimes(5);
        expect(runtime.requests.mock.calls[0]?.[0]).toEqual(['A1', 'A2', 'B1', 'B2']);
        expect(runtime.requests.mock.calls.slice(1).every(([origins]) => origins.length === 1)).toBe(true);

        runtime.requests.mockReset();
        runtime.requests.mockRejectedValue(new Error('provider unavailable'));
        const first = translateTextSlots(['First'], enabled, undefined, undefined, session);
        const second = translateTextSlots(['Second'], enabled, undefined, undefined, session);
        await expect(Promise.all([first, second])).rejects.toThrow('provider unavailable');
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it('AI 多段共享请求允许取消单个候选，剩余候选仍按原槽位取回结果', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        const provider = deferred<string[]>();
        runtime.requests.mockImplementation(() => provider.promise);
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = translateTextSlots(
            ['First'],
            enabled,
            firstController.signal,
            undefined,
            session,
        );
        const second = translateTextSlots(
            ['Second'],
            enabled,
            secondController.signal,
            undefined,
            session,
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const sharedSignal = runtime.requestOptions[0]?.signal as AbortSignal;

        firstController.abort();
        await expect(first).rejects.toMatchObject({name: 'AbortError'});
        expect(sharedSignal.aborted).toBe(false);
        provider.resolve(['译:First', '译:Second']);
        await expect(second).resolves.toEqual(['译:Second']);
        expect(runtime.cancelQueue).not.toHaveBeenCalled();
    });

    it('AI 多段在 queueMicrotask 缺失时回退到 Promise 调度并转发单候选失败', async () => {
        replaceGlobal('queueMicrotask', undefined);
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        runtime.requests.mockRejectedValueOnce(new Error('single candidate failed'));

        await expect(translateTextSlots(
            [undefined as never],
            enabled,
            undefined,
            undefined,
            session,
        )).rejects.toThrow('single candidate failed');
        expect(runtime.requests).toHaveBeenCalledWith(['']);
    });

    it('AI 多段刷新队列时丢弃已经取消的待处理任务', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        const controller = new AbortController();
        const result = translateTextSlots(
            ['Cancelled before flush'],
            enabled,
            controller.signal,
            undefined,
            session,
        );

        controller.abort();
        await expect(result).rejects.toMatchObject({name: 'AbortError'});
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it('AI 多段执行前再次检查信号并忽略已经取消的批次', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        let abortedReads = 0;
        let abortListener: (() => void) | undefined;
        const stagedSignal = {
            get aborted() {
                abortedReads += 1;
                return abortedReads >= 4;
            },
            addEventListener: (_type: string, listener: EventListener) => {
                abortListener = () => listener({type: 'abort'} as Event);
            },
            removeEventListener: vi.fn(),
        } as unknown as AbortSignal;

        const result = translateTextSlots(
            ['Cancelled before execution'],
            enabled,
            stagedSignal,
            undefined,
            session,
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).not.toHaveBeenCalled();

        abortListener?.();
        await expect(result).rejects.toMatchObject({name: 'AbortError'});
    });

    it('AI 多段单候选执行读取调用方提交时的可变槽列表', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        const origins = ['Removed before execution'];
        const result = translateTextSlots(origins, enabled, undefined, undefined, session);

        origins.length = 0;
        await expect(result).resolves.toEqual([]);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it('AI 多段共享请求在全部候选取消后终止底层批次', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        const provider = deferred<string[]>();
        runtime.requests.mockImplementation(() => provider.promise);
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = translateTextSlots(['First'], enabled, firstController.signal, undefined, session);
        const second = translateTextSlots(['Second'], enabled, secondController.signal, undefined, session);
        await Promise.resolve();
        await Promise.resolve();
        const sharedSignal = runtime.requestOptions[0]?.signal as AbortSignal;

        firstController.abort();
        secondController.abort();
        await expect(first).rejects.toMatchObject({name: 'AbortError'});
        await expect(second).rejects.toMatchObject({name: 'AbortError'});
        expect(sharedSignal.aborted).toBe(true);
        expect(runtime.cancelQueue).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({name: 'AbortError'}));

        const providerAbort = new Error('provider aborted');
        providerAbort.name = 'AbortError';
        provider.reject(providerAbort);
        await Promise.resolve();
    });

    it('AI 多段共享请求保留未取消候选的 AbortError 并跳过重复拒绝', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        const provider = deferred<string[]>();
        runtime.requests.mockImplementation(() => provider.promise);
        const firstController = new AbortController();
        const first = translateTextSlots(['First'], enabled, firstController.signal, undefined, session);
        const second = translateTextSlots(['Second'], enabled, undefined, undefined, session);
        await Promise.resolve();
        await Promise.resolve();

        firstController.abort();
        await expect(first).rejects.toMatchObject({name: 'AbortError'});
        const providerAbort = new Error('provider aborted');
        providerAbort.name = 'AbortError';
        provider.reject(providerAbort);
        await expect(second).rejects.toBe(providerAbort);
    });

    it('AI 多段共享请求将非对象 provider 失败原样传给所有候选', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        runtime.requests.mockRejectedValue('primitive provider failure');

        const first = translateTextSlots(['First'], enabled, undefined, undefined, session);
        const second = translateTextSlots(['Second'], enabled, undefined, undefined, session);
        await expect(first).rejects.toBe('primitive provider failure');
        await expect(second).rejects.toBe('primitive provider failure');
    });

    it('AI 多段协议回退隔离已取消候选并分别发布成功与失败结果', async () => {
        const session = {active: true, translationSlotCache: new Map()};
        const enabled = translationSnapshot({
            service: 'ai',
            model: 'ai-model',
            enableAIMultiSegment: true,
        });
        let abortedReads = 0;
        let abortListener: (() => void) | undefined;
        const stagedSignal = {
            get aborted() {
                abortedReads += 1;
                return abortedReads >= 5;
            },
            addEventListener: (_type: string, listener: EventListener) => {
                abortListener = () => listener({type: 'abort'} as Event);
            },
            removeEventListener: vi.fn(),
        } as unknown as AbortSignal;
        let requestCount = 0;
        runtime.requests.mockImplementation(async (origins) => {
            requestCount += 1;
            if (requestCount === 1) {
                throw {kind: 'response', code: 'AI_MULTI_SEGMENT_RESPONSE_INVALID'};
            }
            if (origins[0] === 'Broken') throw new Error('fallback slot failed');
            return origins.map((origin) => `译:${origin}`);
        });
        const nativeAllSettled = Promise.allSettled.bind(Promise);
        const allSettledSpy = vi.spyOn(Promise, 'allSettled').mockImplementation(async (values) => [
            ...await nativeAllSettled(values),
            {status: 'fulfilled', value: []},
        ] as never);

        try {
            const cancelled = translateTextSlots(['Cancelled'], enabled, stagedSignal, undefined, session);
            const broken = translateTextSlots(['Broken'], enabled, undefined, undefined, session);
            const healthy = translateTextSlots(['Healthy'], enabled, undefined, undefined, session);
            await expect(broken).rejects.toThrow('fallback slot failed');
            await expect(healthy).resolves.toEqual(['译:Healthy']);
            expect(runtime.requests).toHaveBeenCalledTimes(3);

            abortListener?.();
            await expect(cancelled).rejects.toMatchObject({name: 'AbortError'});
        } finally {
            allSettledSpy.mockRestore();
        }
    });

    it('逐槽回退在兄弟失败和调用方取消时终止整个队列', async () => {
        const snapshot = translationSnapshot({service: 'custom-provider'});
        const queueSession = {} as never;
        runtime.requests.mockImplementation(async (origins) => {
            if (origins[0] === 'Broken') throw new Error('slot failed');
            return origins.map((origin) => `译:${origin}`);
        });
        await expect(translateTextSlots(
            ['Broken', 'Healthy'],
            snapshot,
            undefined,
            queueSession,
        )).rejects.toThrow('slot failed');
        expect(runtime.cancelQueue).toHaveBeenCalledWith(queueSession, expect.any(Error));

        const alreadyAborted = new AbortController();
        alreadyAborted.abort();
        await expect(translateTextSlots(['Cancelled'], snapshot, alreadyAborted.signal))
            .rejects.toMatchObject({name: 'AbortError'});

        const controller = new AbortController();
        const slots = Array.from({length: 3}, () => deferred<string[]>());
        let requestIndex = 0;
        runtime.requests.mockImplementation(() => {
            requestIndex += 1;
            if (requestIndex === 1) return Promise.resolve(['combined packet']);
            return slots[requestIndex - 2]!.promise;
        });
        const cancelledFallback = translateTextSlots(
            ['One', 'Two', 'Three', 'Four'],
            snapshot,
            controller.signal,
            queueSession,
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        controller.abort();
        slots.forEach((slot, index) => slot.resolve([`译:${index}`]));
        await expect(cancelledFallback).rejects.toMatchObject({name: 'AbortError'});

        replaceGlobal('DOMException', class ThrowingDomException {
            constructor() {
                throw new Error('DOMException unavailable');
            }
        } as unknown as typeof DOMException);
        await expect(translateTextSlots(['Cancelled'], snapshot, alreadyAborted.signal))
            .rejects.toMatchObject({name: 'AbortError'});
    });

    it('批量会话按配置去重、复用、校验异常响应并限制缓存容量', async () => {
        const snapshot = translationSnapshot({service: 'freeTranslation'});
        const session = {active: true, translationSlotCache: new Map()};
        expect(await translateTextSlots(['Same', 'Same'], snapshot, undefined, {} as never, session))
            .toEqual(['译:Same', '译:Same']);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(session.translationSlotCache.size).toBe(1);
        expect(runtime.requestOptions.at(-1)).toMatchObject({useCache: true});

        await translateTextSlots(['Same'], snapshot, undefined, undefined, session);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        runtime.requests.mockResolvedValueOnce([]);
        expect(await translateTextSlots(['Invalid'], snapshot, undefined, undefined, session)).toEqual([]);
        expect(session.translationSlotCache.size).toBe(0);

        runtime.requests.mockResolvedValueOnce([42] as never);
        expect(await translateTextSlots(['Non-string'], snapshot, undefined, undefined, session)).toEqual([]);
        expect(session.translationSlotCache.size).toBe(0);

        runtime.requests.mockRejectedValueOnce(new Error('current request failed'));
        await expect(translateTextSlots(['Rejected'], snapshot, undefined, undefined, session))
            .rejects.toThrow('current request failed');
        expect(session.translationSlotCache.size).toBe(0);

        const manyOrigins = Array.from({length: 513}, (_, index) => `Slot ${index}`);
        runtime.requests.mockImplementationOnce(async (origins) => origins.map((origin) => `译:${origin}`));
        expect(await translateTextSlots(manyOrigins, snapshot, undefined, undefined, session)).toHaveLength(513);
        expect(session.translationSlotCache.size).toBe(512);

        const inactiveSession = {active: false, translationSlotCache: new Map()};
        await translateTextSlots(['Inactive'], snapshot, undefined, undefined, inactiveSession);
        expect(inactiveSession.translationSlotCache.size).toBe(0);
        expect(runtime.requestOptions.at(-1)).toMatchObject({useCache: false});
    });

    it('同一槽的并发请求只允许最新缓存条目改变 settled 或执行失败清理', async () => {
        const snapshot = translationSnapshot();
        const session = {active: true, translationSlotCache: new Map()};
        const oldRequest = deferred<string[]>();
        const newRequest = deferred<string[]>();
        runtime.requests.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
        const oldResult = translateTextSlots(['Concurrent'], snapshot, undefined, undefined, session);
        const newResult = translateTextSlots(['Concurrent'], snapshot, undefined, undefined, session);
        oldRequest.resolve(['旧结果']);
        await expect(oldResult).resolves.toEqual(['旧结果']);
        newRequest.resolve(['新结果']);
        await expect(newResult).resolves.toEqual(['新结果']);
        expect(session.translationSlotCache.size).toBe(1);

        const staleFailure = deferred<string[]>();
        const replacement = deferred<string[]>();
        runtime.requests.mockReturnValueOnce(staleFailure.promise).mockReturnValueOnce(replacement.promise);
        const rejected = translateTextSlots(['Retry'], snapshot, undefined, undefined, session);
        const accepted = translateTextSlots(['Retry'], snapshot, undefined, undefined, session);
        staleFailure.reject(new Error('stale request failed'));
        await expect(rejected).rejects.toThrow('stale request failed');
        replacement.resolve(['恢复结果']);
        await expect(accepted).resolves.toEqual(['恢复结果']);
        expect(session.translationSlotCache.size).toBe(2);
    });

    it("全文翻译后按 Ctrl 恢复的单段不会被当前全文会话重新排队", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Restore only this paragraph.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const candidate = {element: paragraph, kind: "content" as const, reason: "paragraph"};
        setLayoutBox(paragraph, 640, 90);
        runtime.candidates = [candidate];
        runtime.pointCandidate = candidate;

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances[0]!.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        // 这与真实 Control 悬浮触发器使用同一路径：恢复当前目标，但保持全文会话活跃。
        handleTranslation(20, 20);
        await finishScheduledWork();

        expect(isFullPageTranslationActive()).toBe(true);
        expect(getTranslationState(paragraph)).toBeUndefined();
        expect(paragraph.textContent).toBe("Restore only this paragraph.");
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(0);

        // 浏览器会把扩展恢复操作作为 mutation 送达；重扫必须记住显式取消，不能再次翻译。
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: paragraph,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(0);

        // 取消只限定在当前会话；启动新的全文会话后仍允许再次翻译该段落。
        restoreOriginalContent();
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances.at(-1)!.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
    });

    it("候选自身有布局盒时直接观察候选，不改用内部标签", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label">Visible heading</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(title, 320, 48);
        setLayoutBox(label, 200, 28);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(title);
        expect(observer.observe).not.toHaveBeenCalledWith(label);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("立即翻译整页模式绕过可见性门禁并处理当前页面到底部", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = [
            '<p id="visible">Visible paragraph</p>',
            '<p id="below-fold">Paragraph near the page bottom</p>',
        ].join("");
        const visible = document.querySelector<HTMLElement>("#visible")!;
        const belowFold = document.querySelector<HTMLElement>("#below-fold")!;
        setLayoutBox(visible, 600, 80);
        setLayoutBox(belowFold, 600, 80);
        runtime.candidates = [
            {element: visible, kind: "content", reason: "paragraph"},
            {element: belowFold, kind: "content", reason: "paragraph"},
        ];

        autoTranslateEnglishPage();
        await finishScheduledWork();
        await finishScheduledWork();

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests).toHaveBeenCalledWith(["Visible paragraph"]);
        expect(runtime.requests).toHaveBeenCalledWith(["Paragraph near the page bottom"]);
        expect(visible.textContent).toBe("译:Visible paragraph");
        expect(belowFold.textContent).toBe("译:Paragraph near the page bottom");
    });

    it("立即翻译整页仍只并发三个候选，释放槽位后才启动下一项", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="all-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(51);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(3);

        requests[0]!.resolve(["译:One"]);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(4);

        requests[1]!.resolve(["译:Two"]);
        requests[2]!.resolve(["译:Three"]);
        requests[3]!.resolve(["译:Four"]);
        await finishScheduledWork();
        expect(candidates.map((candidate) => candidate.textContent)).toEqual([
            "译:One", "译:Two", "译:Three", "译:Four",
        ]);
    });

    it("恢复整页翻译会清空未启动项，且在途结果不会重新写回页面", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="restore-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.slice(0, 3).map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(51);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(3);

        restoreOriginalContent();
        requests[0]!.resolve(["旧译:One"]);
        requests[1]!.resolve(["旧译:Two"]);
        requests[2]!.resolve(["旧译:Three"]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(3);
        expect(candidates.map((candidate) => candidate.textContent)).toEqual(["One", "Two", "Three", "Four"]);
        expect(document.querySelectorAll('[data-fr-translation-owned="true"]')).toHaveLength(0);
    });

    it("运行中的会话保留启动时模式，修改配置只影响下一次全文翻译", async () => {
        document.body.innerHTML = '<p id="prose">Mode changes apply to the next session.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(TestIntersectionObserver.instances[0]!.observe).toHaveBeenCalledWith(paragraph);

        runtime.config.fullPageTranslationMode = "all";
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        restoreOriginalContent();
        autoTranslateEnglishPage();
        await finishScheduledWork();
        await finishScheduledWork();

        expect(TestIntersectionObserver.instances[1]!.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledWith(["Mode changes apply to the next session."]);
        expect(paragraph.textContent).toBe("译:Mode changes apply to the next session.");
    });

    it("全文会话冻结服务、模型、语言、缓存、显示模式和样式，配置热更新不会混入后续候选", async () => {
        runtime.config.display = 1;
        runtime.config.style = 2;
        document.body.innerHTML = [
            '<p id="first">First paragraph uses the session snapshot.</p>',
            '<p id="second">Later paragraph must use the same snapshot.</p>',
        ].join('');
        const first = document.querySelector<HTMLElement>('#first')!;
        const second = document.querySelector<HTMLElement>('#second')!;
        [first, second].forEach((element) => setLayoutBox(element, 600, 80));
        runtime.candidates = [first, second].map((element) => ({
            element,
            kind: 'content' as const,
            reason: 'paragraph',
        }));
        const firstRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => firstRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        observer.emit(first, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        // 模拟 options 在首个请求尚未返回时同步了另一套翻译配置。
        runtime.config.service = 'freeTranslation';
        runtime.config.model.freeTranslation = 'new-model';
        runtime.config.from = 'zh';
        runtime.config.to = 'ja';
        runtime.config.useCache = false;
        runtime.config.display = 0;
        runtime.config.style = 4;
        firstRequest.resolve(['译:First paragraph uses the session snapshot.']);
        await finishScheduledWork();

        observer.emit(second, true);
        await finishScheduledWork();

        expect(runtime.requestOptions).toHaveLength(2);
        runtime.requestOptions.forEach((options) => expect(options).toMatchObject({
            serviceOverride: 'microsoft',
            modelOverride: 'microsoft-default',
            sourceLanguage: 'en',
            targetLanguage: 'zh',
            useCache: true,
        }));
        expect(runtime.renderOptions).toEqual([
            {targetLanguage: 'zh', style: 2},
            {targetLanguage: 'zh', style: 2},
        ]);
        expect(first.querySelector('.fluent-read-bilingual-content')?.getAttribute('lang')).toBe('zh');
        expect(second.querySelector('.fluent-read-bilingual-content')?.getAttribute('lang')).toBe('zh');
    });

    it("立即翻译整页模式也会直接处理会话中动态追加的内容", async () => {
        runtime.config.fullPageTranslationMode = "all";
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const paragraph = document.createElement("p");
        paragraph.textContent = "A paragraph appended by infinite scroll";
        setLayoutBox(paragraph, 600, 80);
        document.body.appendChild(paragraph);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: document.body,
            addedNodes: [paragraph] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        await finishScheduledWork();
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledWith(["A paragraph appended by infinite scroll"]);
        expect(paragraph.textContent).toBe("译:A paragraph appended by infinite scroll");
        expect(TestIntersectionObserver.instances[0]!.observe).not.toHaveBeenCalled();
    });

    it("观察 display:contents H1 的首个真实布局后代，并在完成后解除该锚点", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label">Pull request title</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 240, 36);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(label);
        expect(observer.observe).not.toHaveBeenCalledWith(title);
        expect(runtime.requests).not.toHaveBeenCalled();

        observer.emit(label, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledWith(["Pull request title"]);
        expect(title.textContent).toBe("译:Pull request title");
        expect(observer.unobserve).toHaveBeenCalledWith(label);
    });

    it("hydration 替换 display:contents 后代后刷新同候选 anchor，旧 IO 不会丢失或重复调度", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label-a">Hydrating title</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const labelA = document.querySelector<HTMLElement>("#label-a")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(labelA, 220, 36);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(labelA);

        const labelB = document.createElement("span");
        labelB.id = "label-b";
        labelB.textContent = "Hydrated title";
        setLayoutBox(labelB, 240, 40);
        labelA.replaceWith(labelB);
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: title,
            addedNodes: [labelB] as unknown as NodeList,
            removedNodes: [labelA] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);

        expect(observer.unobserve).toHaveBeenCalledWith(labelA);
        expect(observer.observe).toHaveBeenCalledWith(labelB);
        expect(runtime.requests).not.toHaveBeenCalled();

        // 脱离文档目标的已排队回调无害；只有新的实时锚点能让稳定 H1 key 通过可见性门禁。
        observer.emit(labelA, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        const request = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => request.promise);
        observer.emit(labelB, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        // 第一 generation 在途时再次收到 IO 通知，不得新建 provider 调用或取代该 generation。
        observer.emit(labelB, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        request.resolve(["译:Hydrated title"]);
        await finishScheduledWork();
        expect(title.textContent).toBe("译:Hydrated title");
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("宿主因样式或布局重绘重挂同一段原文时复用全文结果，不重复请求", async () => {
        runtime.config.display = 1;
        const source = "The same paragraph survives a layout remount.";
        document.body.innerHTML = `<p id="prose">${source}</p>`;
        const firstParagraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(firstParagraph, 620, 90);
        runtime.candidates = [{element: firstParagraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        observer.emit(firstParagraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const firstWrapper = firstParagraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        expect(firstWrapper).toBeTruthy();

        // 页面框架可能在 class/style 处理后替换已翻译 owner；新节点身份不同，但来源文本槽相同。
        const replacement = document.createElement("p");
        replacement.id = "prose-remounted";
        replacement.textContent = source;
        setLayoutBox(replacement, 620, 90);
        firstParagraph.replaceWith(replacement);
        runtime.candidates = [{element: replacement, kind: "content", reason: "paragraph"}];
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: document.body,
            addedNodes: [replacement] as unknown as NodeList,
            removedNodes: [firstParagraph] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);

        observer.emit(replacement, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstParagraph.isConnected).toBe(false);
        expect(replacement.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(replacement.textContent).toContain(`译:${source}`);
    });

    it("没有任何布局锚点的 H1 仍直接进入受控翻译队列", async () => {
        document.body.innerHTML = '<h1 id="title">Text-only heading</h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        setLayoutBox(title, 0, 0);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        await finishScheduledWork();

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenCalledWith(["Text-only heading"]);
        expect(title.textContent).toBe("译:Text-only heading");
    });

    it("inFlightCandidates 是唯一并发计数，并在 settle 后释放下一候选", async () => {
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        candidates.forEach((candidate) => observer.emit(candidate, true));
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(3);

        requests[0]!.resolve(["译:One"]);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(4);

        requests[1]!.resolve(["译:Two"]);
        requests[2]!.resolve(["译:Three"]);
        requests[3]!.resolve(["译:Four"]);
        await finishScheduledWork();
        expect(candidates.map((candidate) => candidate.textContent)).toEqual([
            "译:One", "译:Two", "译:Three", "译:Four",
        ]);
    });

    it("全文进度只把预取窗口内的等待候选计入 queued，并保留离屏 remaining", async () => {
        document.body.innerHTML = ["One", "Two", "Three", "Four", "Five"]
            .map((label, index) => `<p id="progress-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        const snapshots: FullPageTranslationProgress[] = [];
        const unsubscribe = subscribeFullPageTranslationProgress((progress) => {
            snapshots.push(progress);
        });
        const expectCurrentProgress = (expected: Pick<
            FullPageTranslationProgress,
            "active" | "running" | "remaining" | "queued" | "offscreen"
        >) => {
            expect(getFullPageTranslationProgress()).toMatchObject(expected);
            expect(snapshots.at(-1)).toMatchObject(expected);
        };

        try {
            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            await Promise.resolve();

            expectCurrentProgress({
                active: true,
                running: 0,
                remaining: 5,
                queued: 0,
                offscreen: 5,
            });

            const observer = TestIntersectionObserver.instances[0]!;
            candidates.slice(0, 4).forEach((candidate) => observer.emit(candidate, true));
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();

            expect(runtime.requests).toHaveBeenCalledTimes(3);
            expectCurrentProgress({
                active: true,
                running: 3,
                remaining: 2,
                queued: 1,
                offscreen: 1,
            });

            requests[0]!.resolve(["译:One"]);
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();

            expect(runtime.requests).toHaveBeenCalledTimes(4);
            expectCurrentProgress({
                active: true,
                running: 3,
                remaining: 1,
                queued: 0,
                offscreen: 1,
            });

            observer.emit(candidates[4]!, true);
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();

            expect(runtime.requests).toHaveBeenCalledTimes(4);
            expectCurrentProgress({
                active: true,
                running: 3,
                remaining: 1,
                queued: 1,
                offscreen: 0,
            });

            requests[1]!.resolve(["译:Two"]);
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();
            expect(runtime.requests).toHaveBeenCalledTimes(5);

            requests[2]!.resolve(["译:Three"]);
            requests[3]!.resolve(["译:Four"]);
            requests[4]!.resolve(["译:Five"]);
            await finishScheduledWork();

            expect(candidates.map((candidate) => candidate.textContent)).toEqual([
                "译:One", "译:Two", "译:Three", "译:Four", "译:Five",
            ]);
            expectCurrentProgress({
                active: true,
                running: 0,
                remaining: 0,
                queued: 0,
                offscreen: 0,
            });

            restoreOriginalContent();
            expectCurrentProgress({
                active: false,
                running: 0,
                remaining: 0,
                queued: 0,
                offscreen: 0,
            });
        } finally {
            unsubscribe();
        }
    });

    it("立即翻译整页时把所有未启动候选计入 queued，不产生离屏计数", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = ["One", "Two", "Three", "Four", "Five"]
            .map((label, index) => `<p id="all-progress-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(51);
        await Promise.resolve();
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(3);
        expect(TestIntersectionObserver.instances[0]!.observe).not.toHaveBeenCalled();
        expect(getFullPageTranslationProgress()).toMatchObject({
            active: true,
            running: 3,
            remaining: 2,
            queued: 2,
            offscreen: 0,
        });

        restoreOriginalContent();
        requests.slice(0, 3).forEach((request, index) => request.resolve([`译:${candidates[index]!.textContent}`]));
        await finishScheduledWork();
        expect(getFullPageTranslationProgress()).toMatchObject({active: false});
    });

    it("不会把扩展生成的布局节点当成候选可见性锚点", async () => {
        document.body.innerHTML = `
            <h1 id="title">
                <span id="owned" data-fr-translation-owned="true">Loading</span>
                <span id="host-label">Host title</span>
            </h1>
        `;
        const title = document.querySelector<HTMLElement>("#title")!;
        const owned = document.querySelector<HTMLElement>("#owned")!;
        const hostLabel = document.querySelector<HTMLElement>("#host-label")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(owned, 100, 20);
        setLayoutBox(hostLabel, 180, 30);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(hostLabel);
        expect(observer.observe).not.toHaveBeenCalledWith(owned);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("替换同 key 候选时解除旧 anchor、切换 owner，并在 stop 后不再调度", async () => {
        document.body.innerHTML = `
            <div id="generic"><h1 id="title"><span id="label">Exact title</span></h1></div>
        `;
        const generic = document.querySelector<HTMLElement>("#generic")!;
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(generic, 640, 120);
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 220, 36);
        runtime.candidates = [
            {element: generic, nodes: [title], kind: "content", reason: "inline-run"},
            {element: title, kind: "content", reason: "site-title", adapterId: "site"},
        ];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(generic);
        expect(observer.unobserve).toHaveBeenCalledWith(generic);
        expect(observer.observe).toHaveBeenCalledWith(label);
        expect(isFullPageTranslationActive()).toBe(true);

        restoreOriginalContent();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(isFullPageTranslationActive()).toBe(false);

        observer.emit(label, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("旧 IntersectionObserver 的排队 callback 不会把新会话候选送入队列", async () => {
        document.body.innerHTML = '<h1 id="title">Shared title across sessions</h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        setLayoutBox(title, 320, 48);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const oldObserver = TestIntersectionObserver.instances[0]!;
        expect(oldObserver.observe).toHaveBeenCalledWith(title);

        restoreOriginalContent();
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const newObserver = TestIntersectionObserver.instances[1]!;
        expect(newObserver.observe).toHaveBeenCalledWith(title);

        // 浏览器事件送达可能与 disconnect() 竞争；即使已排队的旧回调携带新会话再次
        // 观察的目标，它仍属于已销毁会话，不得读取新 map。
        oldObserver.emit(title, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        newObserver.emit(title, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenCalledWith(["Shared title across sessions"]);
    });

    it("失败 UI 注入的重试回调会按点击时的当前显示模式重新解析候选", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Retry with the latest display mode.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];
        runtime.requests.mockRejectedValueOnce(new Error("provider unavailable"));

        handleBilingualTranslation(paragraph, false);
        await finishScheduledWork();

        expect(getTranslationState(paragraph)?.phase).toBe("error");
        expect(runtime.retryCallbacks).toHaveLength(1);

        runtime.config.display = 0;
        runtime.retryCallbacks[0]!();
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(getTranslationState(paragraph)).toMatchObject({phase: "translated", mode: "single"});
        expect(paragraph.querySelector(".fluent-read-bilingual-content")).toBeNull();
        expect(paragraph.textContent).toBe("译:Retry with the latest display mode.");
    });

    it.each(["translate-no", "hidden"] as const)(
        "全文会话登记启动前 hover 状态的祖先索引，新增 %s 会恢复且 stop 后不再响应",
        async (guard) => {
            runtime.config.display = 1;
            document.body.innerHTML = `
                <section id="ancestor">
                    <p id="prose">Hover translation exists before full-page discovery.</p>
                </section>
            `;
            const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            handleBilingualTranslation(paragraph, false);
            await finishScheduledWork();

            const hoverState = getTranslationState(paragraph)!;
            expect(hoverState.phase).toBe("translated");
            expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);

            // 发现流程只能把现有悬浮状态登记到当前全文会话；权威祖先门禁变化前，
            // 不得替换该状态或再次请求。
            expect(getTranslationState(paragraph)).toBe(hoverState);
            expect(runtime.requests).toHaveBeenCalledTimes(1);
            const mutationObserver = TestMutationObserver.instances.at(-1)!;

            if (guard === "translate-no") ancestor.setAttribute("translate", "no");
            else ancestor.hidden = true;
            mutationObserver.emit([{
                type: "attributes",
                target: ancestor,
                attributeName: guard === "translate-no" ? "translate" : "hidden",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();

            expect(hoverState.controller.signal.aborted).toBe(true);
            expect(getTranslationState(paragraph)).toBeUndefined();
            expect(paragraph.textContent).toBe("Hover translation exists before full-page discovery.");
            expect(paragraph.querySelectorAll('[data-fr-translation-owned="true"]')).toHaveLength(0);
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            restoreOriginalContent();
            expect(isFullPageTranslationActive()).toBe(false);
            if (guard === "translate-no") ancestor.removeAttribute("translate");
            else ancestor.hidden = false;
            mutationObserver.emit([{
                type: "attributes",
                target: ancestor,
                attributeName: guard === "translate-no" ? "translate" : "hidden",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);
        },
    );

    it("全文 discovery enter 会登记启动前已提交的 hover synthetic 状态", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];

        handleBilingualTranslation(host, false);
        await finishScheduledWork();

        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const hoverState = getTranslationState(segment)!;
        expect(hoverState.phase).toBe("translated");
        expect(segment.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(segment)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(segment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-fr-translation-segment="true"], [data-fr-translation-owned="true"]',
        )).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("全文 discovery enter 会登记启动前 in-flight hover synthetic 状态且旧结果不可覆盖", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const pendingRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => pendingRequest.promise);

        handleBilingualTranslation(host, false);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const hoverState = getTranslationState(segment)!;
        expect(hoverState.phase).toBe("loading");
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(segment)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.hidden = true;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(segment.isConnected).toBe(false);
        pendingRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `旧译:${origin}`));
        await finishScheduledWork();

        expect(ancestor.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(0);
        expect(ancestor.querySelectorAll('[data-fr-translation-owned="true"]')).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("共享 key 状态会按 candidate owner 到实际 keyedTarget 登记祖先索引", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="owner"><p id="prose">Exact hover target shares a later full-page key.</p></div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const owner = document.querySelector<HTMLElement>("#owner")!;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(owner, 640, 120);
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "exact-hover"}];

        handleBilingualTranslation(paragraph, false);
        await finishScheduledWork();
        const hoverState = getTranslationState(paragraph)!;
        expect(hoverState.phase).toBe("translated");
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        runtime.candidates = [{
            element: owner,
            nodes: [paragraph],
            kind: "content",
            reason: "shared-key-inline-run",
        }];
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(paragraph)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(getTranslationState(paragraph)).toBeUndefined();
        expect(paragraph.textContent).toBe("Exact hover target shares a later full-page key.");
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("异步 nodes 候选只忽略 synthetic source 迁移与当前 spinner 的真实 childList 记录", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                <p>Independent block child.</p>
            </div>
        `;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceText = host.firstChild as Text;
        const emphasis = document.querySelector<HTMLElement>("#emphasis")!;
        const sourceNodes = [sourceText, emphasis] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const pendingRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => pendingRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const spinner = segment.querySelector<HTMLElement>('[data-fr-translation-owned="true"]')!;
        expect(Array.from(segment.childNodes).filter((node) => node !== spinner)).toEqual(sourceNodes);
        const nativeCloneNode = segment.cloneNode.bind(segment);
        let snapshotCloneCalls = 0;
        Object.defineProperty(segment, "cloneNode", {
            configurable: true,
            value: (deep?: boolean) => {
                snapshotCloneCalls += 1;
                return nativeCloneNode(deep);
            },
        });

        // 这些是 materialize 后真实的实时 Node 身份：宿主获得片段，来源节点移入片段，
        // 同一片段再接收唯一由状态拥有的 spinner。
        TestMutationObserver.instances.at(-1)!.emit([
            {
                type: "childList",
                target: host,
                addedNodes: [segment] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            },
            ...sourceNodes.map((node) => ({
                type: "childList",
                target: host,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [node] as unknown as NodeList,
            })),
            ...Array.from({length: 64}, () => ({
                type: "childList",
                target: segment,
                addedNodes: [...sourceNodes, spinner] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            })),
        ] as unknown as MutationRecord[]);
        await vi.advanceTimersByTimeAsync(100);

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(snapshotCloneCalls).toBe(1);
        expect(segment.isConnected).toBe(true);
        pendingRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `译:${origin}`));
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(segment.isConnected).toBe(true);
        expect(segment.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("已译 synthetic inline-run 的祖先新增 translate=no 会 abort、unwrap，移除后可重译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        const firstSegment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const firstState = getTranslationState(firstSegment)!;
        expect(firstSegment.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(firstState.controller.signal.aborted).toBe(false);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(firstState.controller.signal.aborted).toBe(true);
        expect(firstSegment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-fr-translation-segment="true"], [data-fr-translation-owned="true"]',
        )).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.removeAttribute("translate");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('[data-fr-translation-segment="true"]')).toHaveLength(1);
        expect(host.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("in-flight synthetic inline-run 的祖先 hidden 会 abort，旧结果不可覆盖且解除后可翻译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const firstRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => firstRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const firstSegment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const firstState = getTranslationState(firstSegment)!;
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstState.phase).toBe("loading");

        ancestor.hidden = true;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(firstState.controller.signal.aborted).toBe(true);
        expect(firstSegment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-fr-translation-segment="true"], [data-fr-translation-owned="true"]',
        )).toHaveLength(0);

        firstRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `旧译:${origin}`));
        await finishScheduledWork();
        expect(ancestor.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.hidden = false;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('[data-fr-translation-segment="true"]')).toHaveLength(1);
        expect(host.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(host.textContent).not.toContain("旧译:");
    });

    it("loading synthetic 内新增 lookalike owned artifact 仍会 stale、恢复并重译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                <p>Independent block child.</p>
            </div>
        `;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceText = host.firstChild as Text;
        const emphasis = document.querySelector<HTMLElement>("#emphasis")!;
        const sourceNodes = [sourceText, emphasis] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const firstRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => firstRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const spinner = segment.querySelector<HTMLElement>('[data-fr-translation-owned="true"]')!;
        const mutationObserver = TestMutationObserver.instances.at(-1)!;
        mutationObserver.emit([{
            type: "childList",
            target: segment,
            addedNodes: [...sourceNodes, spinner] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        expect(segment.isConnected).toBe(true);

        const lookalike = document.createElement("span");
        lookalike.setAttribute("data-fr-translation-owned", "true");
        lookalike.textContent = "Host inserted lookalike artifact";
        segment.appendChild(lookalike);
        mutationObserver.emit([{
            type: "childList",
            target: segment,
            addedNodes: [lookalike] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(segment.isConnected).toBe(false);
        expect(lookalike.isConnected).toBe(false);
        firstRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `译:${origin}`));
        await finishScheduledWork();
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("provider 进行中 attribute/owner 与下一代 source 依次失效后只提交最新 generation", async () => {
        document.body.innerHTML = `
            <article id="owner" data-layout="paragraph">
                <p id="math">A long perspective paragraph with an inline formula.</p>
            </article>
        `;
        const owner = document.querySelector<HTMLElement>("#owner")!;
        const paragraph = document.querySelector<HTMLElement>("#math")!;
        setLayoutBox(owner, 750, 180);
        setLayoutBox(paragraph, 750, 140);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        const firstRequest = deferred<string[]>();
        const secondRequest = deferred<string[]>();
        runtime.requests
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementationOnce(() => secondRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        observer.emit(paragraph, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenNthCalledWith(1, [
            "A long perspective paragraph with an inline formula.",
        ]);

        // 首先只使语义所有权失效，并刻意保持原文不变，以证明此路径依赖提交时复验候选，
        // 而不是仅依赖来源快照检查。
        owner.setAttribute("data-layout", "article");
        runtime.candidates = [{element: owner, kind: "content", reason: "article-prose"}];
        firstRequest.resolve(["译:A long perspective paragraph with an inline formula."]);

        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests).toHaveBeenNthCalledWith(2, [
            "A long perspective paragraph with an inline formula.",
        ]);

        // 新 ARTICLE generation 进入在途状态后改变其原文并完成旧请求；生命周期重试
        // 必须按新来源签名重置，且只能提交第三 generation。
        paragraph.firstChild!.nodeValue = "The settled perspective paragraph keeps the inline formula intact.";
        secondRequest.resolve(["译:A long perspective paragraph with an inline formula."]);

        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(3);
        expect(runtime.requests).toHaveBeenNthCalledWith(3, [
            "The settled perspective paragraph keeps the inline formula intact.",
        ]);
        expect(paragraph.textContent).toBe("译:The settled perspective paragraph keeps the inline formula intact.");

        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(3);
    });

    it("显式 unchanged 在同一全文会话形成 source 签名墓碑，普通 rescan 不重复请求", async () => {
        document.body.innerHTML = '<h1 id="brand">Microsoft</h1>';
        const brand = document.querySelector<HTMLElement>("#brand")!;
        setLayoutBox(brand, 300, 48);
        runtime.candidates = [{element: brand, kind: "content", reason: "heading"}];
        runtime.requests.mockImplementation(async (origins) => [...origins]);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances[0]!.emit(brand, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(brand.textContent).toBe("Microsoft");

        brand.className = "layout-only-change";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: brand,
            attributeName: "class",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it.each([
        {display: 0, expectedLayoutChecks: 0, label: "single"},
        {display: 1, expectedLayoutChecks: 1, label: "bilingual"},
    ] as const)(
        "$label 已译内容发生纯布局 mutation 时只为双语 wrapper 续租 unclamp",
        async ({display, expectedLayoutChecks}) => {
            runtime.config.display = display;
            document.body.innerHTML = '<p id="prose">Stable source under a layout-only mutation.</p>';
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            TestIntersectionObserver.instances[0]!.emit(paragraph, true);
            await finishScheduledWork();
            expect(getTranslationState(paragraph)?.phase).toBe("translated");

            paragraph.classList.add("host-layout-update");
            TestMutationObserver.instances.at(-1)!.emit([{
                type: "attributes",
                target: paragraph,
                attributeName: "class",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();

            expect(runtime.ensureTranslationTruncationLayout)
                .toHaveBeenCalledTimes(expectedLayoutChecks);
            expect(runtime.requests).toHaveBeenCalledTimes(1);
        },
    );

    it("已译 prose 忽略 MathJax/code 等保护后代 churn，但外层 source mutation 会重启", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span id="lead">Readable prose before protected renderers. </span>
                <span id="math-v2-root" class="MathJax_Display"><span id="math-v2">x + y</span></span>
                <mjx-container id="math-v3-root"><span id="math-v3">a = b</span></mjx-container>
                <span id="katex-root" class="katex"><span id="katex">c = d</span></span>
                <code id="code">const answer = 42;</code>
                <span id="translate-no" translate="no">Do not translate</span>
                <span id="notranslate" class="notranslate">Keep original</span>
                <span id="tail"> Readable prose after protected renderers.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const lead = document.querySelector<HTMLElement>("#lead")!;
        const protectedChurnHosts = [
            "#math-v2", "#math-v3", "#katex", "#code", "#translate-no", "#notranslate",
        ].map((selector) => document.querySelector<HTMLElement>(selector)!);
        const protectedAttributeRoots = [
            "#math-v2-root", "#math-v3-root", "#katex-root", "#code", "#translate-no", "#notranslate",
        ].map((selector) => document.querySelector<HTMLElement>(selector)!);
        setLayoutBox(paragraph, 700, 140);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        expect(firstWrapper?.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        const records: MutationRecord[] = [];
        for (const [index, host] of protectedChurnHosts.entries()) {
            const text = host.firstChild as Text;
            text.nodeValue = `host churn ${index}`;
            records.push({
                type: "characterData",
                target: text,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord);
            const renderedChild = document.createElement("span");
            renderedChild.textContent = `rendered ${index}`;
            host.appendChild(renderedChild);
            records.push({
                type: "childList",
                target: host,
                addedNodes: [renderedChild] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord);
        }
        for (const [index, root] of protectedAttributeRoots.entries()) {
            root.setAttribute("style", `--render-pass: ${index}`);
            records.push({
                type: "attributes",
                target: root,
                attributeName: "style",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord);
        }
        TestMutationObserver.instances.at(-1)!.emit(records);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstWrapper.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        lead.firstChild!.nodeValue = "Updated readable prose before protected renderers. ";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: lead.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("离屏 MathJax v2 父 P staging 事务保留 wrapper，真实 prose/slot 变化仍重启", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span id="lead">Perspective projection prose stays translatable. </span>
                <span id="preview" class="MathJax_Preview">FORMULA_PREVIEW_SECRET</span>
                <script id="tex" type="math/tex; mode=display">FORMULA_TEX_SECRET</script>
                <span id="tail"> The explanation continues around the equation.</span>
                <a id="reference" href="/before">Stable reference text</a>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const lead = document.querySelector<HTMLElement>("#lead")!;
        const preview = document.querySelector<HTMLElement>("#preview")!;
        const reference = document.querySelector<HTMLAnchorElement>("#reference")!;
        setLayoutBox(paragraph, 750, 338);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        const mutationObserver = TestMutationObserver.instances.at(-1)!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests.mock.calls[0]![0].join(" ")).not.toMatch(
            /FORMULA_PREVIEW_SECRET|FORMULA_TEX_SECRET/u,
        );
        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        expect(firstWrapper.isConnected).toBe(true);

        // 候选已离开 IO。MathJax v2 会先在直属 P 边界插入未分类、脱离文档的 staging span，
        // 再替换为受保护的 Display/MathJax 树，同时保留 TeX 来源 script；不能依赖第二次
        // 正向 IO 事件修复丢失的 wrapper。
        visibilityObserver.emit(paragraph, false);
        const staging = document.createElement("span");
        preview.replaceWith(staging);
        const display = document.createElement("span");
        display.className = "MathJax_Display";
        const renderedMath = document.createElement("span");
        renderedMath.className = "MathJax";
        renderedMath.textContent = "FORMULA_RENDERED_SECRET";
        display.append(renderedMath);
        staging.replaceWith(display);
        mutationObserver.emit([
            {
                type: "childList",
                target: paragraph,
                addedNodes: [staging] as unknown as NodeList,
                removedNodes: [preview] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "childList",
                target: paragraph,
                addedNodes: [display] as unknown as NodeList,
                removedNodes: [staging] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "childList",
                target: display,
                addedNodes: [renderedMath] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord,
        ]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstWrapper.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        // 真实原文编辑沿用现有重启路径；惰性全文调度仍等待可见性，重新进入后只请求一次
        // 新 payload，并继续排除 renderer 内容。
        lead.firstChild!.nodeValue = "Updated perspective projection prose must be translated. ";
        mutationObserver.emit([{
            type: "characterData",
            target: lead.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();
        expect(firstWrapper.isConnected).toBe(false);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests.mock.calls[1]![0].join(" ")).toContain(
            "Updated perspective projection prose must be translated.",
        );
        expect(runtime.requests.mock.calls[1]![0].join(" ")).not.toMatch(
            /FORMULA_RENDERED_SECRET|FORMULA_TEX_SECRET/u,
        );

        // 用同文本替换行内链接仍会改变可翻译 Text 的精确身份，因此不能保留双语快照。
        const secondWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        const replacementReference = document.createElement("a");
        replacementReference.id = "reference-next";
        replacementReference.href = "/after";
        replacementReference.textContent = reference.textContent;
        reference.replaceWith(replacementReference);
        mutationObserver.emit([{
            type: "childList",
            target: paragraph,
            addedNodes: [replacementReference] as unknown as NodeList,
            removedNodes: [reference] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(secondWrapper.isConnected).toBe(false);
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(3);
    });

    it("宿主篡改译文 wrapper 不会被 hard guard 当成可忽略 mutation", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Host prose remains authoritative.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(paragraph, 620, 90);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        const translatedText = firstWrapper.firstChild as Text;
        translatedText.nodeValue = "Host overwrote the extension translation.";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: translatedText,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it.each(["element", "text"] as const)(
        "宿主向译文 wrapper append %s 的 childList mutation 会恢复并重译",
        async (kind) => {
            runtime.config.display = 1;
            document.body.innerHTML = '<p id="prose">Host prose remains authoritative.</p>';
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            const visibilityObserver = TestIntersectionObserver.instances[0]!;
            visibilityObserver.emit(paragraph, true);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
            const mutationObserver = TestMutationObserver.instances.at(-1)!;

            // MutationObserver 会异步送达扩展自身的 wrapper 插入；快照完整时必须保持 no-op。
            mutationObserver.emit([{
                type: "childList",
                target: paragraph,
                addedNodes: [firstWrapper] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);
            expect(firstWrapper.isConnected).toBe(true);

            const appended = kind === "element"
                ? document.createElement("span")
                : document.createTextNode("Host appended translation text.");
            if (appended.nodeType === 1) appended.textContent = "Host appended translation element.";
            firstWrapper.appendChild(appended);
            mutationObserver.emit([{
                type: "childList",
                target: firstWrapper,
                addedNodes: [appended] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await vi.advanceTimersByTimeAsync(50);
            visibilityObserver.emit(paragraph, true);
            await finishScheduledWork();

            expect(runtime.requests).toHaveBeenCalledTimes(2);
            expect(firstWrapper.isConnected).toBe(false);
            expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        },
    );

    it("普通后代新增 translate=no 会重启，且新 payload 排除受保护文本", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span>Readable prefix. </span>
                <span id="dynamic">This text becomes protected.</span>
                <span> Readable suffix.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const dynamic = document.querySelector<HTMLElement>("#dynamic")!;
        setLayoutBox(paragraph, 620, 90);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests.mock.calls[0]![0].join(" ")).toContain("This text becomes protected.");

        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        dynamic.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: dynamic,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests.mock.calls[1]![0].join(" ")).not.toContain("This text becomes protected.");
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("provider 空结果的立即重排有上限，source 变化后才开启新 generation", async () => {
        document.body.innerHTML = '<p id="late">Initial prose before hydration.</p>';
        const paragraph = document.querySelector<HTMLElement>("#late")!;
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "late-paragraph"}];
        const firstRequest = deferred<string[]>();
        runtime.requests
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementation(async () => []);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        observer.emit(paragraph, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        // 此 key 在途时重新进入 IO 阈值只能保留一个 pending 唤醒；有界空结果重试完成前，
        // 不得创建会遗忘当前 generation 的 `owned` 任务。
        observer.emit(paragraph, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        firstRequest.resolve([]);
        await finishScheduledWork();

        // 初始请求加两次生命周期重试后，第三个可重试结果只保存封顶签名，不得安排第四次请求。
        expect(runtime.requests).toHaveBeenCalledTimes(3);

        paragraph.firstChild!.nodeValue = "Late prose became readable after hydration.";
        runtime.requests.mockImplementation(async (origins) => origins.map((origin) => `译:${origin}`));
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: paragraph.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        expect(observer.observed.has(paragraph)).toBe(true);
        observer.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(4);
        expect(paragraph.textContent).toBe("译:Late prose became readable after hydration.");
    });
});
