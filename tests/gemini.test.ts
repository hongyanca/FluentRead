import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        service: 'gemini',
        to: 'zh-Hans',
        token: {gemini: 'google-secret-key'} as Record<string, string>,
        model: {gemini: 'gemini-2.5-flash'} as Record<string, string>,
        customModel: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        user_role: {gemini: 'Translate to {{to}}: {{origin}}'} as Record<string, string>,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import gemini from '@/src/providers/translation/gemini';

const fetchMock = vi.fn<typeof fetch>();

function mockResponse(body: unknown, overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        ...overrides,
    } as unknown as Response;
}

beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.token.gemini = 'google-secret-key';
    mockConfig.model.gemini = 'gemini-2.5-flash';
    mockConfig.customModel = {};
    mockConfig.proxy = {};
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Gemini adapter credential transport', () => {
    it('sends a direct Google API key in x-goog-api-key without putting it in the URL', async () => {
        fetchMock.mockResolvedValue(mockResponse({
            candidates: [{content: {parts: [{text: '译文'}]}}],
        }));

        await expect(gemini({origin: 'source', serviceOverride: 'gemini'})).resolves.toBe('译文');

        const [requestUrl, init] = fetchMock.mock.calls[0]!;
        expect(requestUrl).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        );
        expect(String(requestUrl)).not.toContain('google-secret-key');
        const headers = init?.headers as Headers;
        expect(headers.get('x-goog-api-key')).toBe('google-secret-key');
        expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('does not forward the Google API key to a custom proxy', async () => {
        mockConfig.proxy.gemini = 'https://proxy.example/v1/generate';
        fetchMock.mockResolvedValue(mockResponse({
            candidates: [{content: {parts: [{text: '代理译文'}]}}],
        }));

        await expect(gemini({origin: 'source', serviceOverride: 'gemini'})).resolves.toBe('代理译文');

        const [requestUrl, init] = fetchMock.mock.calls[0]!;
        expect(requestUrl).toBe('https://proxy.example/v1/generate');
        const headers = init?.headers as Headers;
        expect(headers.has('x-goog-api-key')).toBe(false);
        expect(JSON.stringify([...headers.entries()])).not.toContain('google-secret-key');
    });

    it('surfaces only HTTP status metadata when a provider body contains a sentinel', async () => {
        const responseBody = vi.fn().mockResolvedValue('SENSITIVE_RESPONSE_SENTINEL');
        fetchMock.mockResolvedValue(mockResponse({}, {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            text: responseBody,
        }));

        const error = await gemini({origin: 'source', serviceOverride: 'gemini'}).catch(cause => cause);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('翻译失败: 403');
        expect((error as Error).message).not.toContain('SENSITIVE_RESPONSE_SENTINEL');
        expect(responseBody).not.toHaveBeenCalled();
    });

    it('does not reflect a malformed successful response in JSON parser errors', async () => {
        fetchMock.mockResolvedValue(mockResponse({}, {
            json: vi.fn().mockRejectedValue(
                new SyntaxError('Unexpected token S in SENSITIVE_SUCCESS_RESPONSE_SENTINEL'),
            ),
        }));

        const error = await gemini({origin: 'source', serviceOverride: 'gemini'}).catch(cause => cause);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Gemini 返回的不是有效 JSON');
        expect((error as Error).message).not.toContain('SENSITIVE_SUCCESS_RESPONSE_SENTINEL');
    });
});
