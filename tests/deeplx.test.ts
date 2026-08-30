import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        from: "auto",
        to: "zh-Hans",
        service: "deeplx",
        deeplx: "",
        proxy: {} as Record<string, string>,
        token: {} as Record<string, string>,
    },
}));

vi.mock("@/src/services/config/store", () => ({config: mockConfig}));

import deeplx, {
    getDeepLXRequestLanguages,
    normalizeDeepLXLanguage,
} from "@/src/providers/translation/deeplx";
import {DEFAULT_DEEPLX_ENDPOINT, DEEPLX_ENDPOINT_PRESETS, getDeepLXEndpoints} from '@/src/core/config/deeplx';

const fetchMock = vi.fn<typeof fetch>();

function mockResponse(body: unknown, overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        ...overrides,
    } as unknown as Response;
}

beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.from = "auto";
    mockConfig.to = "zh-Hans";
    mockConfig.deeplx = "";
    mockConfig.proxy = {};
    mockConfig.token = {};
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("DeepLX endpoint configuration", () => {
    it("uses the verified public endpoint when no URL is configured", () => {
        expect(getDeepLXEndpoints("", "")).toEqual([DEFAULT_DEEPLX_ENDPOINT]);
    });

    it("parses comma- and newline-separated URLs and gives proxy URLs priority", () => {
        expect(getDeepLXEndpoints("https://one.example/translate,\nhttps://two.example/translate", ""))
            .toEqual(["https://one.example/translate", "https://two.example/translate"]);
        expect(getDeepLXEndpoints("https://configured.example/translate", "https://proxy.example/translate"))
            .toEqual(["https://proxy.example/translate"]);
    });

    it("resolves token placeholders without returning a secret in the configured URL", () => {
        expect(getDeepLXEndpoints(DEEPLX_ENDPOINT_PRESETS[1].url, "", "site-token"))
            .toEqual(["https://freeapi.fanyimao.cn/translate?token=site-token"]);
        expect(getDeepLXEndpoints(DEEPLX_ENDPOINT_PRESETS[2].url, "", ""))
            .toEqual([DEFAULT_DEEPLX_ENDPOINT]);
    });
});

describe("DeepLX adapter", () => {
    it("sends the expected request and parses a successful response", async () => {
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("你好");

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe(DEFAULT_DEEPLX_ENDPOINT);
        expect(init).toMatchObject({method: "POST"});
        expect(init?.headers).toEqual({"Content-Type": "application/json"});
        expect(JSON.parse(String(init?.body))).toEqual({
            text: "Hello",
            source_lang: "AUTO",
            target_lang: "ZH",
        });
    });

    it("falls back to the next configured URL after an HTTP failure", async () => {
        mockConfig.deeplx = "https://primary.example/translate,\nhttps://backup.example/translate";
        fetchMock
            .mockResolvedValueOnce(mockResponse({message: "busy"}, {
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                text: vi.fn().mockResolvedValue("busy"),
            }))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "备用译文"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("备用译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://backup.example/translate");
    });

    it("falls back after an invalid DeepLX response", async () => {
        mockConfig.deeplx = "https://invalid.example/translate,https://valid.example/translate";
        fetchMock
            .mockResolvedValueOnce(mockResponse({code: 200, data: ""}))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "有效译文"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("有效译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("adds an optional bearer token without exposing it in the URL", async () => {
        mockConfig.token = {deeplx: "test-token"};
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await deeplx({origin: "Hello"});

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
        });
    });

    it("supports a token placeholder in a preset endpoint", async () => {
        mockConfig.deeplx = DEEPLX_ENDPOINT_PRESETS[1].url;
        mockConfig.token = {deeplx: "site-token"};
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("你好");

        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://freeapi.fanyimao.cn/translate?token=site-token");
    });

    it("单次 timeout 覆盖响应体读取，并真正中止 transport signal", async () => {
        vi.useFakeTimers();
        let transportSignal: AbortSignal | undefined;
        fetchMock.mockImplementation((_input, init) => {
            transportSignal = init?.signal ?? undefined;
            return Promise.resolve(mockResponse({}, {
                text: vi.fn(() => new Promise<string>((_resolve, reject) => {
                    transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {once: true});
                })),
            }));
        });

        const request = deeplx({origin: "Hello"});
        const rejection = expect(request).rejects.toThrow("请求超时（8 秒）");
        await vi.advanceTimersByTimeAsync(7_999);
        expect(transportSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(transportSignal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("调用方取消响应体读取后不再尝试备用站点", async () => {
        mockConfig.deeplx = "https://primary.example/translate,https://backup.example/translate";
        const controller = new AbortController();
        let transportSignal: AbortSignal | undefined;
        const responseText = vi.fn(() => new Promise<string>((_resolve, reject) => {
            transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {once: true});
        }));
        fetchMock.mockImplementation((_input, init) => {
            transportSignal = init?.signal ?? undefined;
            return Promise.resolve(mockResponse({}, {
                text: responseText,
            }));
        });

        const request = deeplx({origin: "Hello", abortSignal: controller.signal});
        await vi.waitFor(() => expect(responseText).toHaveBeenCalledOnce());
        controller.abort(new Error('broker deadline'));
        await expect(request).rejects.toThrow('broker deadline');
        expect(transportSignal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("normalizes Chinese language variants", () => {
        expect(normalizeDeepLXLanguage("zh-Hans")).toBe("ZH");
        expect(normalizeDeepLXLanguage("zh-TW")).toBe("ZH-HANT");
        expect(getDeepLXRequestLanguages("auto", "zh-Hans")).toEqual({
            sourceLang: "AUTO",
            targetLang: "ZH",
        });
    });
});
