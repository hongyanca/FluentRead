import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const {mockConfig, microsoftMock, deeplxMock, googleMock} = vi.hoisted(() => ({
    mockConfig: {
        from: "auto",
        to: "zh-Hans",
    },
    microsoftMock: vi.fn(),
    deeplxMock: vi.fn(),
    googleMock: vi.fn(),
}));

vi.mock("@/src/services/config/store", () => ({config: mockConfig}));
vi.mock("@/src/core/config/catalog", () => ({
    services: {
        microsoft: "microsoft",
        deeplx: "deeplx",
        google: "google",
    },
}));
vi.mock("@/src/providers/translation/microsoft", () => ({translateMicrosoftTexts: microsoftMock}));
vi.mock("@/src/providers/translation/deeplx", () => ({translateDeepLXText: deeplxMock}));
vi.mock("@/src/providers/translation/google", () => ({translateGoogleText: googleMock}));

import freeTranslation, {
    FREE_TRANSLATION_BATCH_CONCURRENCY,
    FREE_TRANSLATION_ORDER,
    translateFreeText,
} from "@/src/providers/translation/free-translation";

beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.from = "auto";
    mockConfig.to = "zh-Hans";
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("免费翻译服务", () => {
    it("按微软、DeepLX、谷歌的顺序优先使用第一个可用服务", async () => {
        const calls: string[] = [];
        microsoftMock.mockImplementation(async () => {
            calls.push("microsoft");
            throw new Error("Microsoft unavailable");
        });
        deeplxMock.mockImplementation(async () => {
            calls.push("deeplx");
            throw new Error("DeepLX unavailable");
        });
        googleMock.mockImplementation(async () => {
            calls.push("google");
            return "谷歌译文";
        });

        await expect(translateFreeText("Hello")).resolves.toBe("谷歌译文");
        expect(calls).toEqual(["microsoft", "deeplx", "google"]);
        expect(microsoftMock).toHaveBeenCalledWith(["Hello"], "auto", "zh-Hans", undefined);
        expect(deeplxMock).toHaveBeenCalledWith("Hello", "deeplx", {});
        expect(googleMock).toHaveBeenCalledWith("Hello", "auto", "zh-Hans", undefined);
    });

    it("微软可用时不请求后续服务", async () => {
        microsoftMock.mockResolvedValue(["微软译文"]);

        await expect(freeTranslation({origin: "Hello"})).resolves.toBe("微软译文");
        expect(microsoftMock).toHaveBeenCalledOnce();
        expect(deeplxMock).not.toHaveBeenCalled();
        expect(googleMock).not.toHaveBeenCalled();
    });

    it("返回空译文时继续降级", async () => {
        microsoftMock.mockResolvedValue([""]);
        deeplxMock.mockResolvedValue("DeepLX 译文");

        await expect(translateFreeText("Hello")).resolves.toBe("DeepLX 译文");
        expect(microsoftMock).toHaveBeenCalledOnce();
        expect(deeplxMock).toHaveBeenCalledOnce();
        expect(googleMock).not.toHaveBeenCalled();
    });

    it("所有服务失败时汇总失败原因和固定顺序", async () => {
        microsoftMock.mockRejectedValue(new Error("HTTP 503"));
        deeplxMock.mockRejectedValue(new Error("连接失败"));
        googleMock.mockRejectedValue(new Error("HTTP 429"));

        await expect(translateFreeText("Hello")).rejects.toThrow(
            `免费翻译服务均不可用（${FREE_TRANSLATION_ORDER.join(" → ")}）：微软翻译: HTTP 503；DeepLX: 连接失败；谷歌翻译: HTTP 429`,
        );
    });

    it("支持批量消息，并为每条文本独立执行降级", async () => {
        microsoftMock.mockRejectedValue(new Error("unavailable"));
        deeplxMock.mockImplementation(async (text: string) => `${text} 的译文`);

        await expect(freeTranslation({origin: ["Hello", "World"]})).resolves.toEqual([
            "Hello 的译文",
            "World 的译文",
        ]);
        expect(deeplxMock).toHaveBeenCalledTimes(2);
    });

    it("批量消息最多并发三个 worker，乱序完成后仍按输入顺序返回", async () => {
        let active = 0;
        let maxActive = 0;
        const pending: Array<{text: string; finish: () => void}> = [];
        microsoftMock.mockImplementation(([text]: [string]) => new Promise<string[]>((resolve) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            pending.push({
                text,
                finish: () => {
                    active -= 1;
                    resolve([`译:${text}`]);
                },
            });
        }));

        const request = freeTranslation({origin: ["A", "B", "C", "D", "E", "F"]});
        await vi.waitFor(() => expect(pending).toHaveLength(FREE_TRANSLATION_BATCH_CONCURRENCY));
        pending[2].finish();
        pending[0].finish();
        pending[1].finish();
        await vi.waitFor(() => expect(pending).toHaveLength(6));
        pending[5].finish();
        pending[3].finish();
        pending[4].finish();

        await expect(request).resolves.toEqual(["译:A", "译:B", "译:C", "译:D", "译:E", "译:F"]);
        expect(maxActive).toBe(FREE_TRANSLATION_BATCH_CONCURRENCY);
    });

    it("调用方取消后中止在途 worker，且未领取文本不会启动回退链", async () => {
        const controller = new AbortController();
        const signals: AbortSignal[] = [];
        microsoftMock.mockImplementation((_texts, _from, _to, signal: AbortSignal) => (
            new Promise<string[]>((_resolve, reject) => {
                signals.push(signal);
                signal.addEventListener('abort', () => reject(signal.reason), {once: true});
            })
        ));

        const request = freeTranslation({
            origin: ["A", "B", "C", "D", "E"],
            abortSignal: controller.signal,
        });
        await vi.waitFor(() => expect(microsoftMock).toHaveBeenCalledTimes(3));
        controller.abort(new Error('用户取消'));

        await expect(request).rejects.toThrow('用户取消');
        expect(signals.every(signal => signal.aborted)).toBe(true);
        expect(microsoftMock).toHaveBeenCalledTimes(3);
        expect(deeplxMock).not.toHaveBeenCalled();
        expect(googleMock).not.toHaveBeenCalled();
    });

    it("任一 worker 首次失败会取消 sibling，避免其继续进入备用 provider", async () => {
        const siblingSignals: AbortSignal[] = [];
        microsoftMock.mockImplementation(([text]: [string], _from, _to, signal: AbortSignal) => {
            if (text === 'bad') return Promise.reject(new Error('Microsoft bad'));
            return new Promise<string[]>((_resolve, reject) => {
                siblingSignals.push(signal);
                signal.addEventListener('abort', () => reject(signal.reason), {once: true});
            });
        });
        deeplxMock.mockImplementation((text: string) => {
            if (text === 'bad') return Promise.reject(new Error('DeepLX bad'));
            throw new Error(`sibling 不应回退: ${text}`);
        });
        googleMock.mockImplementation((text: string) => {
            if (text === 'bad') return Promise.reject(new Error('Google bad'));
            throw new Error(`sibling 不应回退: ${text}`);
        });

        await expect(freeTranslation({origin: ['bad', 'slow-1', 'slow-2', 'not-started']}))
            .rejects.toThrow('免费翻译服务均不可用');
        expect(siblingSignals.every(signal => signal.aborted)).toBe(true);
        expect(microsoftMock).toHaveBeenCalledTimes(3);
        expect(deeplxMock).toHaveBeenCalledTimes(1);
        expect(googleMock).toHaveBeenCalledTimes(1);
    });

    it("批量入口在调用前已取消时不启动任何 provider", async () => {
        const controller = new AbortController();
        controller.abort('stop');

        await expect(freeTranslation({origin: ['A'], abortSignal: controller.signal}))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(microsoftMock).not.toHaveBeenCalled();
    });

    it("单条免费链在调用前已取消时不启动首个 provider", async () => {
        const controller = new AbortController();
        controller.abort(new Error('single stopped'));

        await expect(translateFreeText('Hello', {abortSignal: controller.signal}))
            .rejects.toThrow('single stopped');
        expect(microsoftMock).not.toHaveBeenCalled();
    });

    it.each([
        [{sourceLanguage: "en"}, {sourceLanguage: "en"}],
        [{targetLanguage: "ja"}, {targetLanguage: "ja"}],
    ])("显式语言覆盖传递给 DeepLX %#", async (languages, expected) => {
        microsoftMock.mockRejectedValue(new Error("unavailable"));
        deeplxMock.mockResolvedValue("DeepLX 译文");

        await expect(translateFreeText("Hello", languages)).resolves.toBe("DeepLX 译文");
        expect(deeplxMock).toHaveBeenCalledWith("Hello", "deeplx", expected);
    });

    it("拒绝直接调用和消息入口中的非文本值", async () => {
        await expect(translateFreeText(42 as unknown as string)).rejects.toThrow("仅支持文本输入");
        await expect(freeTranslation({origin: 42 as unknown as string})).rejects.toThrow("仅支持文本输入");
    });

    it("将非 Error 失败和非字符串译文纳入完整降级摘要", async () => {
        microsoftMock.mockRejectedValue("microsoft plain failure");
        deeplxMock.mockRejectedValue("deeplx plain failure");
        googleMock.mockResolvedValue(undefined);

        await expect(translateFreeText("Hello")).rejects.toThrow(
            "微软翻译: microsoft plain failure；DeepLX: deeplx plain failure；谷歌翻译: 谷歌翻译未返回有效译文",
        );
    });
});
