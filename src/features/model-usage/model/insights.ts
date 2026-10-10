/**
 * @file src/features/model-usage/model/insights.ts
 * 文件职责：把本机模型用量快照转换为设置页可解释的构成、趋势和请求质量展示数据。
 * 主要内容：拆分互不重叠的输入、缓存读取、缓存情况未知的输入和输出，保留服务商总计差异，统一从零开始的 Token 与请求趋势，并按全部调用计算上报覆盖率。
 * 模块边界：本文件只进行确定性的展示计算，不采集调用、不估算缺失 Token、不改变聚合与存储合同，也不引入图表或浏览器依赖。
 */

import type {ModelUsageTimelinePoint, Totals} from '@/src/services/model-usage/types';

export type UsageCompositionKey = 'uncached-input' | 'cached-input' | 'unknown-cache-input' | 'output' | 'other';
export type UsageTimelineMetric = 'tokens' | 'requests';
export type UsageOutcomeKey = 'success' | 'error' | 'timeout' | 'cancelled';

export interface UsageCompositionSegment {
    key: UsageCompositionKey;
    label: string;
    tokens: number;
    share: number;
}

export interface UsageComposition {
    segments: UsageCompositionSegment[];
    totalTokens: number;
    compositionTokens: number;
    /** 服务商总计减去输入与输出；负值不会被伪装成一个负数分段。 */
    differenceTokens: number;
    hasReportedTokens: boolean;
    cacheCoverageRate: number | null;
}

export interface UsageHealth {
    reportedRequests: number;
    unreportedRequests: number;
    tokenCoverageRate: number | null;
    successRate: number | null;
}

export interface UsageTimelineSegment {
    key: UsageCompositionKey | UsageOutcomeKey;
    label: string;
    value: number;
    share: number;
}

export interface UsageTimelinePoint extends ModelUsageTimelinePoint {
    value: number;
    height: number;
    segments: UsageTimelineSegment[];
    differenceTokens: number;
    unreportedRequests: number;
    hasReportedTokens: boolean;
}

export interface UsageTimeline {
    metric: UsageTimelineMetric;
    maximum: number;
    points: UsageTimelinePoint[];
}

function count(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

function rate(numerator: number, denominator: number): number | null {
    return denominator > 0 ? Math.min(1, numerator / denominator) : null;
}

/** 缓存读取已经包含在输入中，写入已经包含在未命中的输入中，推理已经包含在输出中。 */
export function buildUsageComposition(totals: Totals): UsageComposition {
    const input = count(totals.inputTokens);
    const output = count(totals.outputTokens);
    const totalTokens = count(totals.totalTokens);
    const cacheKnownInput = Math.min(input, count(totals.cacheEligibleInputTokens));
    const cachedInput = Math.min(cacheKnownInput, count(totals.cachedInputTokens));
    const differenceTokens = totalTokens - input - output;
    const other = Math.max(0, differenceTokens);
    const compositionTokens = input + output + other;
    const values: Array<Omit<UsageCompositionSegment, 'share'>> = [
        {key: 'uncached-input', label: '输入（未命中缓存）', tokens: cacheKnownInput - cachedInput},
        {key: 'cached-input', label: '缓存读取', tokens: cachedInput},
        {key: 'unknown-cache-input', label: '输入（缓存情况未知）', tokens: input - cacheKnownInput},
        {key: 'output', label: '输出', tokens: output},
        {key: 'other', label: '其他 Token', tokens: other},
    ];
    return {
        segments: values.map(segment => ({
            ...segment,
            share: compositionTokens > 0 ? segment.tokens / compositionTokens : 0,
        })),
        totalTokens,
        compositionTokens,
        differenceTokens,
        hasReportedTokens: totals.reportedTokenRequests > 0,
        cacheCoverageRate: rate(count(totals.cacheReportedRequests), count(totals.reportedTokenRequests)),
    };
}

/** 失败或取消的调用也可能报告 Token，因此上报覆盖率的分母始终为全部调用。 */
export function buildUsageHealth(totals: Totals): UsageHealth {
    const requests = count(totals.requestCount);
    const reportedRequests = Math.min(requests, count(totals.reportedTokenRequests));
    return {
        reportedRequests,
        unreportedRequests: requests - reportedRequests,
        tokenCoverageRate: rate(reportedRequests, requests),
        successRate: rate(count(totals.successfulRequests), requests),
    };
}

function requestSegments(totals: Totals, requests: number): UsageTimelineSegment[] {
    const values: Array<Omit<UsageTimelineSegment, 'share'>> = [
        {key: 'success', label: '成功', value: count(totals.successfulRequests)},
        {key: 'error', label: '错误', value: count(totals.errorRequests)},
        {key: 'timeout', label: '超时', value: count(totals.timeoutRequests)},
        {key: 'cancelled', label: '取消', value: count(totals.cancelledRequests)},
    ];
    return values.map(segment => ({...segment, share: requests > 0 ? segment.value / requests : 0}));
}

/** 所有柱共享零基线；未上报只保留请求覆盖信息，不补出任何 Token 或可见最小柱高。 */
export function buildUsageTimeline(
    timeline: readonly ModelUsageTimelinePoint[],
    metric: UsageTimelineMetric,
): UsageTimeline {
    const rows = timeline.map(point => {
        const composition = buildUsageComposition(point.totals);
        const health = buildUsageHealth(point.totals);
        const value = metric === 'tokens' ? composition.compositionTokens : count(point.totals.requestCount);
        const segments: UsageTimelineSegment[] = metric === 'tokens'
            ? composition.segments.map(({key, label, tokens, share}) => ({key, label, value: tokens, share}))
            : requestSegments(point.totals, value);
        return {
            ...point,
            value,
            segments,
            differenceTokens: composition.differenceTokens,
            unreportedRequests: health.unreportedRequests,
            hasReportedTokens: composition.hasReportedTokens,
        };
    });
    const maximum = Math.max(0, ...rows.map(point => point.value));
    return {
        metric,
        maximum,
        points: rows.map(point => ({...point, height: maximum > 0 ? (point.value / maximum) * 100 : 0})),
    };
}
