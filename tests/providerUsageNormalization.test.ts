import {describe, expect, it} from 'vitest';
import {
    normalizeClaudeUsage,
    normalizeDeepSeekResponsesUsage,
    normalizeGeminiUsage,
    normalizeHunyuanUsage,
    normalizeOpenAICompatibleUsage,
} from '@/src/providers/translation/usage';

describe('provider model usage normalization', () => {
    it('normalizes OpenAI-compatible details without adding cache or reasoning twice', () => {
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 100,
            completion_tokens: 50,
            prompt_tokens_details: {
                cached_tokens: 40,
                cache_write_tokens: 12,
            },
            completion_tokens_details: {reasoning_tokens: 20},
        }, '  gpt-usage-model  ')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cachedInputTokens: 40,
            cacheWriteTokens: 12,
            reasoningTokens: 20,
            actualModel: 'gpt-usage-model',
        });
    });

    it('maps Kimi top-level cached_tokens to cached input tokens', () => {
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 19,
            completion_tokens: 21,
            total_tokens: 40,
            cached_tokens: 10,
        }, 'kimi-k2.6')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 19,
            outputTokens: 21,
            totalTokens: 40,
            cachedInputTokens: 10,
            actualModel: 'kimi-k2.6',
        });
    });

    it('normalizes Claude cache and thinking breakdowns without adding them twice', () => {
        expect(normalizeClaudeUsage({
            input_tokens: 10,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 4,
            output_tokens: 5,
            output_tokens_details: {thinking_tokens: 2},
        }, 'claude-test')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 17,
            outputTokens: 5,
            totalTokens: 22,
            cachedInputTokens: 4,
            cacheWriteTokens: 3,
            reasoningTokens: 2,
            actualModel: 'claude-test',
        });
    });

    it('normalizes Gemini usageMetadata and preserves thought tokens as a breakdown', () => {
        expect(normalizeGeminiUsage({
            promptTokenCount: 30,
            cachedContentTokenCount: 8,
            candidatesTokenCount: 12,
            thoughtsTokenCount: 5,
            totalTokenCount: 47,
        }, 'gemini-test')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 30,
            outputTokens: 17,
            totalTokens: 47,
            cachedInputTokens: 8,
            reasoningTokens: 5,
            actualModel: 'gemini-test',
        });
    });

    it('normalizes DeepSeek Responses usage details', () => {
        expect(normalizeDeepSeekResponsesUsage({
            input_tokens: 22,
            input_tokens_details: {cached_tokens: 7},
            output_tokens: 29,
            output_tokens_details: {reasoning_tokens: 27},
            total_tokens: 51,
        }, 'deepseek-v4-flash')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 22,
            outputTokens: 29,
            totalTokens: 51,
            cachedInputTokens: 7,
            reasoningTokens: 27,
            actualModel: 'deepseek-v4-flash',
        });
    });

    it('normalizes Tencent Hunyuan PascalCase usage fields', () => {
        expect(normalizeHunyuanUsage({
            PromptTokens: 96,
            CompletionTokens: 10,
            TotalTokens: 106,
            PromptTokensDetails: {CachedTokens: '20'},
        }, 'hunyuan-translation')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 96,
            outputTokens: 10,
            totalTokens: 106,
            cachedInputTokens: 20,
            actualModel: 'hunyuan-translation',
        });
    });

    it('marks absent usage and incomplete core fields as unreported', () => {
        const normalizers = [
            normalizeOpenAICompatibleUsage,
            normalizeClaudeUsage,
            normalizeGeminiUsage,
            normalizeDeepSeekResponsesUsage,
            normalizeHunyuanUsage,
        ];

        for (const normalize of normalizers) {
            expect(normalize(undefined)).toEqual({usageAvailability: 'unreported'});
            expect(normalize(null)).toEqual({usageAvailability: 'unreported'});
        }

        expect(normalizeOpenAICompatibleUsage({prompt_tokens: 1})).toEqual({
            usageAvailability: 'unreported',
        });
        expect(normalizeGeminiUsage({promptTokenCount: 1})).toEqual({
            usageAvailability: 'unreported',
        });
        expect(normalizeHunyuanUsage(undefined, 'hunyuan-lite')).toEqual({
            usageAvailability: 'unreported',
            actualModel: 'hunyuan-lite',
        });
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 1,
            completion_tokens: 2,
        }, '   ')).toEqual({
            usageAvailability: 'reported',
            inputTokens: 1,
            outputTokens: 2,
            totalTokens: 3,
        });
    });

    it('rejects strings, negative values, fractions, infinities, and conflicting aliases', () => {
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: '10',
            completion_tokens: 2,
            total_tokens: 12,
        }).usageAvailability).toBe('malformed');
        expect(normalizeClaudeUsage({
            input_tokens: -1,
            output_tokens: 2,
        }).usageAvailability).toBe('malformed');
        expect(normalizeGeminiUsage({
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            totalTokenCount: 3,
            thoughtsTokenCount: 0.5,
        }).usageAvailability).toBe('malformed');
        expect(normalizeDeepSeekResponsesUsage({
            input_tokens: 1,
            output_tokens: 2,
            total_tokens: Number.POSITIVE_INFINITY,
        }).usageAvailability).toBe('malformed');
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
            cached_tokens: 3,
            prompt_tokens_details: {cached_tokens: 4},
        }).usageAvailability).toBe('malformed');
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 10,
            completion_tokens: 2,
            cached_tokens: '3',
        }).usageAvailability).toBe('malformed');
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 10,
            completion_tokens: 2,
            prompt_tokens_details: [],
        }).usageAvailability).toBe('malformed');
        expect(normalizeOpenAICompatibleUsage('not-an-object').usageAvailability).toBe('malformed');
    });

    it('only accepts canonical safe decimal strings for Hunyuan cached tokens', () => {
        const coreUsage = {
            PromptTokens: 12,
            CompletionTokens: 3,
            TotalTokens: 15,
        };
        expect(normalizeHunyuanUsage({
            ...coreUsage,
            PromptTokensDetails: {CachedTokens: 4},
        })).toMatchObject({usageAvailability: 'reported', cachedInputTokens: 4});
        expect(normalizeHunyuanUsage({
            PromptTokens: Number.MAX_SAFE_INTEGER,
            CompletionTokens: 0,
            TotalTokens: Number.MAX_SAFE_INTEGER,
            PromptTokensDetails: {CachedTokens: String(Number.MAX_SAFE_INTEGER)},
        })).toMatchObject({
            usageAvailability: 'reported',
            cachedInputTokens: Number.MAX_SAFE_INTEGER,
        });

        for (const cachedTokens of [
            '-1',
            '1.5',
            '1e3',
            '+1',
            '01',
            ' 1',
            String(Number.MAX_SAFE_INTEGER + 1),
            '12345678901234567',
            -1,
            0.5,
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            expect(normalizeHunyuanUsage({
                ...coreUsage,
                PromptTokensDetails: {CachedTokens: cachedTokens},
            }).usageAvailability).toBe('malformed');
        }
        expect(normalizeHunyuanUsage({
            ...coreUsage,
            PromptTokens: '12',
            PromptTokensDetails: {CachedTokens: '4'},
        }).usageAvailability).toBe('malformed');
    });

    it('handles omitted Claude cache fields and rejects token sum overflow', () => {
        expect(normalizeClaudeUsage({
            input_tokens: 4,
            output_tokens: 5,
        })).toEqual({
            usageAvailability: 'reported',
            inputTokens: 4,
            outputTokens: 5,
            totalTokens: 9,
        });
        expect(normalizeClaudeUsage({
            input_tokens: Number.MAX_VALUE,
            cache_read_input_tokens: Number.MAX_VALUE,
            output_tokens: 1,
        })).toEqual({usageAvailability: 'malformed'});
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: Number.MAX_VALUE,
            completion_tokens: Number.MAX_VALUE,
        })).toEqual({usageAvailability: 'malformed'});
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: Number.MAX_SAFE_INTEGER + 1,
            completion_tokens: 0,
        })).toEqual({usageAvailability: 'malformed'});
    });

    it('derives total only from normalized input and output when total is absent', () => {
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 7,
            completion_tokens: 3,
            cached_tokens: 2,
            completion_tokens_details: {reasoning_tokens: 1},
        })).toMatchObject({
            usageAvailability: 'reported',
            totalTokens: 10,
        });
        expect(normalizeGeminiUsage({
            promptTokenCount: 7,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 2,
        })).toMatchObject({
            usageAvailability: 'reported',
            outputTokens: 5,
            totalTokens: 12,
            reasoningTokens: 2,
        });
        expect(normalizeDeepSeekResponsesUsage({
            input_tokens: 7,
            output_tokens: 3,
            output_tokens_details: {reasoning_tokens: 2},
        })).toMatchObject({
            usageAvailability: 'reported',
            totalTokens: 10,
            reasoningTokens: 2,
        });
        expect(normalizeHunyuanUsage({
            PromptTokens: 7,
            CompletionTokens: 3,
        })).toMatchObject({
            usageAvailability: 'reported',
            totalTokens: 10,
        });
    });

    it('rejects malformed explicit totals and safe-integer overflow in derived totals', () => {
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: '2',
        })).toEqual({usageAvailability: 'malformed'});
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: Number.MAX_SAFE_INTEGER,
            completion_tokens: 1,
        })).toEqual({usageAvailability: 'malformed'});
    });

    it('rejects Claude and Gemini provider-detail sums that overflow safe integers', () => {
        expect(normalizeClaudeUsage({
            input_tokens: Number.MAX_SAFE_INTEGER,
            cache_read_input_tokens: 1,
            output_tokens: 0,
        })).toEqual({usageAvailability: 'malformed'});
        expect(normalizeGeminiUsage({
            promptTokenCount: 0,
            candidatesTokenCount: Number.MAX_SAFE_INTEGER,
            thoughtsTokenCount: 1,
            totalTokenCount: Number.MAX_SAFE_INTEGER,
        })).toEqual({usageAvailability: 'malformed'});
    });

    it('keeps Claude and Gemini output handling explicit when optional detail counts are absent', () => {
        expect(normalizeClaudeUsage({output_tokens: 2})).toEqual({usageAvailability: 'unreported'});
        expect(normalizeGeminiUsage({
            promptTokenCount: 2,
            candidatesTokenCount: 3,
        })).toEqual({
            usageAvailability: 'reported',
            inputTokens: 2,
            outputTokens: 3,
            totalTokens: 5,
        });
        expect(normalizeGeminiUsage({
            promptTokenCount: 2,
            thoughtsTokenCount: 1,
        })).toEqual({usageAvailability: 'unreported'});
    });

    it('把超过输入的缓存读取或写入明细降级为 malformed，避免整批仓库存储失败', () => {
        expect(normalizeOpenAICompatibleUsage({
            prompt_tokens: 10,
            completion_tokens: 2,
            cached_tokens: 8,
            cache_write_tokens: 3,
        })).toEqual({usageAvailability: 'malformed'});
        expect(normalizeClaudeUsage({
            input_tokens: 0,
            cache_read_input_tokens: 8,
            cache_creation_input_tokens: 3,
            output_tokens: 2,
        })).toMatchObject({
            usageAvailability: 'reported',
            inputTokens: 11,
            cachedInputTokens: 8,
            cacheWriteTokens: 3,
        });
    });
});
