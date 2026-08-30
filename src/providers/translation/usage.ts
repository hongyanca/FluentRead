/**
 * @file src/providers/translation/usage.ts
 *
 * 文件职责：把各大模型供应商返回的 token 用量字段归一为 FluentRead 的无敏感信息观察对象。
 * 主要内容：严格校验 OpenAI-compatible、Claude、Gemini、DeepSeek Responses 与腾讯混元的非负有限整数，区分未上报和畸形数据，并统一缓存、缓存写入和推理 token 明细。可核对的公开符号包括 normalizeOpenAICompatibleUsage、normalizeClaudeUsage、normalizeGeminiUsage、normalizeDeepSeekResponsesUsage、normalizeHunyuanUsage。
 * 模块边界：本文件只解释 provider 已解析 JSON 中的 usage 子对象和单个模型名，不读取配置、发送网络请求、估算缺失 token，也不接触原始响应正文或统计仓库。
 */

import type {TranslationModelUsageObservation} from '@/src/services/translation/types';

type UnknownRecord = Record<string, unknown>;

type TokenValue =
    | {kind: 'missing'}
    | {kind: 'malformed'}
    | {kind: 'value'; value: number};

const MISSING_TOKEN: TokenValue = {kind: 'missing'};
const MALFORMED_TOKEN: TokenValue = {kind: 'malformed'};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsageRecord(value: unknown): UnknownRecord | 'unreported' | 'malformed' {
    if (value === undefined || value === null) return 'unreported';
    return isRecord(value) ? value : 'malformed';
}

function readToken(
    record: UnknownRecord,
    key: string,
    allowCanonicalDecimalString = false,
): TokenValue {
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === null) {
        return MISSING_TOKEN;
    }

    const value = record[key];
    // 腾讯混元把 PromptTokensDetails.CachedTokens 声明为 String。只为该调用点
    // 接受无符号、无前导零的十进制安全整数；其他 provider 字段仍必须是 JSON number。
    if (allowCanonicalDecimalString && typeof value === 'string') {
        if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) return MALFORMED_TOKEN;
        const parsed = Number(value);
        return Number.isSafeInteger(parsed)
            ? {kind: 'value', value: parsed}
            : MALFORMED_TOKEN;
    }
    if (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || !Number.isSafeInteger(value)
        || value < 0
    ) {
        return MALFORMED_TOKEN;
    }

    return {kind: 'value', value};
}

function readNestedToken(
    record: UnknownRecord,
    parentKey: string,
    key: string,
    allowCanonicalDecimalString = false,
): TokenValue {
    if (!Object.prototype.hasOwnProperty.call(record, parentKey) || record[parentKey] === null) {
        return MISSING_TOKEN;
    }

    const nested = record[parentKey];
    if (!isRecord(nested)) return MALFORMED_TOKEN;
    return readToken(nested, key, allowCanonicalDecimalString);
}

function mergeEquivalentTokens(...values: TokenValue[]): TokenValue {
    if (values.some(value => value.kind === 'malformed')) return MALFORMED_TOKEN;

    const reported = values.filter(
        (value): value is Extract<TokenValue, {kind: 'value'}> => value.kind === 'value',
    );
    if (reported.length === 0) return MISSING_TOKEN;
    if (reported.some(value => value.value !== reported[0].value)) return MALFORMED_TOKEN;
    return reported[0];
}

function addTokens(...values: number[]): number | undefined {
    const total = values.reduce((sum, value) => sum + value, 0);
    return Number.isSafeInteger(total) && total >= 0
        ? total
        : undefined;
}

function normalizeModelName(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const model = value.trim();
    return model || undefined;
}

function availabilityOnly(
    usageAvailability: 'unreported' | 'malformed',
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const model = normalizeModelName(actualModel);
    return {
        usageAvailability,
        ...(model ? {actualModel: model} : {}),
    };
}

interface NormalizedTokenFields {
    input: TokenValue;
    output: TokenValue;
    total: TokenValue;
    cachedInput?: TokenValue;
    cacheWrite?: TokenValue;
    reasoning?: TokenValue;
}

function buildObservation(
    fields: NormalizedTokenFields,
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const optionalFields = [fields.cachedInput, fields.cacheWrite, fields.reasoning]
        .filter((value): value is TokenValue => value !== undefined);
    if (
        fields.input.kind === 'malformed'
        || fields.output.kind === 'malformed'
        || fields.total.kind === 'malformed'
        || optionalFields.some(value => value.kind === 'malformed')
    ) {
        return availabilityOnly('malformed', actualModel);
    }

    if (fields.input.kind !== 'value' || fields.output.kind !== 'value') {
        return availabilityOnly('unreported', actualModel);
    }

    const totalTokens = fields.total.kind === 'value'
        ? fields.total.value
        : addTokens(fields.input.value, fields.output.value);
    if (totalTokens === undefined) return availabilityOnly('malformed', actualModel);

    const cachedInputTokens = fields.cachedInput?.kind === 'value'
        ? fields.cachedInput.value
        : 0;
    const cacheWriteTokens = fields.cacheWrite?.kind === 'value'
        ? fields.cacheWrite.value
        : 0;
    const cacheDetailsTotal = addTokens(cachedInputTokens, cacheWriteTokens);
    if (
        cacheDetailsTotal === undefined
        || cachedInputTokens > fields.input.value
        || cacheWriteTokens > fields.input.value
        || cacheDetailsTotal > fields.input.value
    ) {
        return availabilityOnly('malformed', actualModel);
    }

    const model = normalizeModelName(actualModel);
    return {
        usageAvailability: 'reported',
        inputTokens: fields.input.value,
        outputTokens: fields.output.value,
        totalTokens,
        ...(fields.cachedInput?.kind === 'value'
            ? {cachedInputTokens: fields.cachedInput.value}
            : {}),
        ...(fields.cacheWrite?.kind === 'value'
            ? {cacheWriteTokens: fields.cacheWrite.value}
            : {}),
        ...(fields.reasoning?.kind === 'value'
            ? {reasoningTokens: fields.reasoning.value}
            : {}),
        ...(model ? {actualModel: model} : {}),
    };
}

/** 归一 OpenAI Chat Completions 及兼容供应商的 usage 对象。 */
export function normalizeOpenAICompatibleUsage(
    value: unknown,
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const usage = readUsageRecord(value);
    if (usage === 'unreported' || usage === 'malformed') {
        return availabilityOnly(usage, actualModel);
    }

    return buildObservation({
        input: readToken(usage, 'prompt_tokens'),
        output: readToken(usage, 'completion_tokens'),
        total: readToken(usage, 'total_tokens'),
        cachedInput: mergeEquivalentTokens(
            readToken(usage, 'cached_tokens'),
            readToken(usage, 'prompt_cache_hit_tokens'),
            readToken(usage, 'cache_read_tokens'),
            readNestedToken(usage, 'prompt_tokens_details', 'cached_tokens'),
        ),
        cacheWrite: mergeEquivalentTokens(
            readToken(usage, 'cache_write_tokens'),
            readNestedToken(usage, 'prompt_tokens_details', 'cache_write_tokens'),
        ),
        reasoning: mergeEquivalentTokens(
            readToken(usage, 'reasoning_tokens'),
            readNestedToken(usage, 'completion_tokens_details', 'reasoning_tokens'),
        ),
    }, actualModel);
}

/** 归一 Anthropic Messages usage；缓存读写 token 会先并入总输入，再作为明细保留。 */
export function normalizeClaudeUsage(
    value: unknown,
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const usage = readUsageRecord(value);
    if (usage === 'unreported' || usage === 'malformed') {
        return availabilityOnly(usage, actualModel);
    }

    const rawInput = readToken(usage, 'input_tokens');
    const cacheRead = readToken(usage, 'cache_read_input_tokens');
    const cacheWrite = readToken(usage, 'cache_creation_input_tokens');
    const output = readToken(usage, 'output_tokens');
    if (
        rawInput.kind === 'malformed'
        || cacheRead.kind === 'malformed'
        || cacheWrite.kind === 'malformed'
    ) {
        return availabilityOnly('malformed', actualModel);
    }

    let input: TokenValue = rawInput;
    if (rawInput.kind === 'value') {
        const combinedInput = addTokens(
            rawInput.value,
            cacheRead.kind === 'value' ? cacheRead.value : 0,
            cacheWrite.kind === 'value' ? cacheWrite.value : 0,
        );
        input = combinedInput === undefined
            ? MALFORMED_TOKEN
            : {kind: 'value', value: combinedInput};
    }

    return buildObservation({
        input,
        output,
        total: MISSING_TOKEN,
        cachedInput: cacheRead,
        cacheWrite,
        reasoning: readNestedToken(usage, 'output_tokens_details', 'thinking_tokens'),
    }, actualModel);
}

/** 归一 Gemini GenerateContentResponse.usageMetadata。 */
export function normalizeGeminiUsage(
    value: unknown,
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const usage = readUsageRecord(value);
    if (usage === 'unreported' || usage === 'malformed') {
        return availabilityOnly(usage, actualModel);
    }

    const candidates = readToken(usage, 'candidatesTokenCount');
    const thoughts = readToken(usage, 'thoughtsTokenCount');
    let output = candidates;
    if (candidates.kind === 'value' && thoughts.kind === 'value') {
        const combinedOutput = addTokens(candidates.value, thoughts.value);
        output = combinedOutput === undefined ? MALFORMED_TOKEN : {kind: 'value', value: combinedOutput};
    }

    return buildObservation({
        input: readToken(usage, 'promptTokenCount'),
        output,
        total: readToken(usage, 'totalTokenCount'),
        cachedInput: readToken(usage, 'cachedContentTokenCount'),
        reasoning: thoughts,
    }, actualModel);
}

/** 归一 DeepSeek Responses API 的 usage 对象。 */
export function normalizeDeepSeekResponsesUsage(
    value: unknown,
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const usage = readUsageRecord(value);
    if (usage === 'unreported' || usage === 'malformed') {
        return availabilityOnly(usage, actualModel);
    }

    return buildObservation({
        input: readToken(usage, 'input_tokens'),
        output: readToken(usage, 'output_tokens'),
        total: readToken(usage, 'total_tokens'),
        cachedInput: readNestedToken(usage, 'input_tokens_details', 'cached_tokens'),
        cacheWrite: readNestedToken(usage, 'input_tokens_details', 'cache_write_tokens'),
        reasoning: readNestedToken(usage, 'output_tokens_details', 'reasoning_tokens'),
    }, actualModel);
}

/** 归一腾讯云 ChatTranslations Response.Usage。 */
export function normalizeHunyuanUsage(
    value: unknown,
    actualModel?: unknown,
): TranslationModelUsageObservation {
    const usage = readUsageRecord(value);
    if (usage === 'unreported' || usage === 'malformed') {
        return availabilityOnly(usage, actualModel);
    }

    return buildObservation({
        input: readToken(usage, 'PromptTokens'),
        output: readToken(usage, 'CompletionTokens'),
        total: readToken(usage, 'TotalTokens'),
        cachedInput: readNestedToken(usage, 'PromptTokensDetails', 'CachedTokens', true),
    }, actualModel);
}
