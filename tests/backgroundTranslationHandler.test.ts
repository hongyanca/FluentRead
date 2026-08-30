import {describe, expect, it, vi} from 'vitest';
import {
    createTranslationRequestFallback,
    parseTranslationRequest,
} from '@/src/app/background/handlers/translation';

describe('background translation fallback handler', () => {
    it('只认无 type 且自有 origin 的历史翻译消息', () => {
        const fallback = createTranslationRequestFallback({
            translate: vi.fn(),
            serializeError: vi.fn(),
        });

        expect(fallback.canHandle({origin: 'hello'})).toBe(true);
        expect(fallback.canHandle({origin: ['a', 'b']})).toBe(true);
        expect(fallback.canHandle(Object.create({origin: 'prototype'}))).toBe(false);
        expect(fallback.canHandle({type: 'unknown', origin: 'hello'})).toBe(false);
        expect(fallback.canHandle(null)).toBe(false);
        expect(fallback.canHandle([])).toBe(false);
        expect(fallback.canHandle({context: 'missing origin'})).toBe(false);
    });

    it('只把协议允许的字段传给 broker', async () => {
        const translate = vi.fn().mockResolvedValue('你好');
        const fallback = createTranslationRequestFallback({translate, serializeError: vi.fn()});
        const candidate = {
            origin: 'hello',
            context: 'title',
            pageContext: 'article',
            aiMultiSegment: true,
            useCache: false,
            serviceOverride: 'google',
            modelOverride: 'model',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            requestTimeoutMs: 12_000,
            injected: 'must-not-pass',
        };

        await expect(fallback.handle(candidate, undefined)).resolves.toBe('你好');
        expect(translate).toHaveBeenCalledWith({
            origin: 'hello',
            context: 'title',
            pageContext: 'article',
            aiMultiSegment: true,
            useCache: false,
            serviceOverride: 'google',
            modelOverride: 'model',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            requestTimeoutMs: 12_000,
        });
    });

    it('保留字符串数组并忽略未提供的可选字段', () => {
        expect(parseTranslationRequest({origin: ['a', 'b']})).toEqual({origin: ['a', 'b']});
        expect(parseTranslationRequest({origin: '', context: undefined})).toEqual({origin: ''});
    });

    it('拒绝数量正确但包含稀疏空槽的 origin 数组', () => {
        const fullySparse = new Array(2);
        const trailingHole = ['ok'];
        trailingHole.length = 2;

        expect(() => parseTranslationRequest({origin: fullySparse})).toThrow('origin');
        expect(() => parseTranslationRequest({origin: trailingHole})).toThrow('origin');
    });

    it.each([
        [{origin: 1}, 'origin'],
        [{origin: ['ok', 2]}, 'origin'],
        [{origin: 'ok', context: 1}, 'context'],
        [{origin: 'ok', pageContext: false}, 'pageContext'],
        [{origin: 'ok', serviceOverride: {}}, 'serviceOverride'],
        [{origin: 'ok', modelOverride: null}, 'modelOverride'],
        [{origin: 'ok', sourceLanguage: []}, 'sourceLanguage'],
        [{origin: 'ok', targetLanguage: 1}, 'targetLanguage'],
        [{origin: ['ok'], aiMultiSegment: 'yes'}, 'aiMultiSegment'],
        [{origin: 'ok', useCache: 'yes'}, 'useCache'],
        [{origin: 'ok', requestTimeoutMs: Number.NaN}, 'requestTimeoutMs'],
    ])('拒绝非法协议字段 %#', (candidate, field) => {
        expect(() => parseTranslationRequest(candidate as never)).toThrow(field);
    });

    it('把校验失败与 broker 失败都交给版本化错误序列化器', async () => {
        const brokerError = new Error('provider failed');
        const translate = vi.fn()
            .mockRejectedValueOnce(brokerError)
            .mockResolvedValueOnce('unused');
        const serializeError = vi.fn((error: unknown) => ({kind: 'translation-error', error}));
        const fallback = createTranslationRequestFallback({translate, serializeError});

        await expect(fallback.handle({origin: 'hello'}, undefined)).resolves.toEqual({
            kind: 'translation-error',
            error: brokerError,
        });
        const invalid = {origin: 'hello', useCache: 'yes'};
        await expect(fallback.handle(invalid, undefined)).resolves.toMatchObject({kind: 'translation-error'});
        expect(translate).toHaveBeenCalledTimes(1);
        expect(serializeError).toHaveBeenCalledTimes(2);
    });
});
