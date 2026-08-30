import {describe, expect, it, vi} from 'vitest';

import {
    createHttpStatusError,
    createProviderCodeError,
    getSafeProviderErrorCode,
    readJsonResponse,
} from '@/src/platform/http/errors';

describe('safe provider error formatting', () => {
    it('surfaces only the numeric HTTP status and ignores a third-party statusText', () => {
        const error = createHttpStatusError({
            status: 403,
            statusText: 'SENSITIVE_STATUS_SENTINEL',
        }, '翻译失败');

        expect(error.message).toBe('翻译失败: 403');
        expect(error.message).not.toContain('SENSITIVE_STATUS_SENTINEL');
        expect(createHttpStatusError({status: 500, statusText: ''}).message).toBe('请求失败: 500');
    });

    it('allows bounded numeric provider codes', () => {
        expect(getSafeProviderErrorCode(2049)).toBe('2049');
        expect(getSafeProviderErrorCode('401')).toBe('401');
        expect(createProviderCodeError('服务返回错误', '2049').message)
            .toBe('服务返回错误（错误码 2049）');
    });

    it('rejects arbitrary strings and oversized numeric fields', () => {
        expect(getSafeProviderErrorCode(null)).toBeUndefined();
        expect(getSafeProviderErrorCode('   ')).toBeUndefined();
        expect(getSafeProviderErrorCode('AuthFailure.SENSITIVE_SENTINEL')).toBeUndefined();
        expect(getSafeProviderErrorCode('12abc')).toBeUndefined();
        expect(getSafeProviderErrorCode('1'.repeat(17))).toBeUndefined();
        expect(createProviderCodeError('服务返回错误', 'SENSITIVE_SENTINEL').message)
            .toBe('服务返回错误');
    });

    it('returns valid JSON without changing the parsed value', async () => {
        const payload = {choices: [{message: {content: '译文'}}]};
        const response = {json: vi.fn().mockResolvedValue(payload)};

        await expect(readJsonResponse(response)).resolves.toBe(payload);
        expect(response.json).toHaveBeenCalledOnce();
    });

    it('does not reflect malformed third-party JSON in parser errors', async () => {
        const response = {
            json: vi.fn().mockRejectedValue(
                new SyntaxError('Unexpected token S in SENSITIVE_RESPONSE_SENTINEL'),
            ),
        };

        const error = await readJsonResponse(response).catch(cause => cause);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('返回的不是有效 JSON');
        expect((error as Error).message).not.toContain('SENSITIVE_RESPONSE_SENTINEL');
    });
});
