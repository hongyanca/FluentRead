import {describe, expect, it} from 'vitest';
import {emptyModelUsageTotals} from '@/src/services/model-usage/aggregation';
import {
    buildUsageComposition,
    buildUsageHealth,
    buildUsageTimeline,
} from '@/src/features/model-usage/model/insights';
import type {ModelUsageTimelinePoint, Totals} from '@/src/services/model-usage/types';

function totals(values: Partial<Totals> = {}): Totals {
    return {...emptyModelUsageTotals(), ...values};
}

function point(key: string, values: Partial<Totals> = {}): ModelUsageTimelinePoint {
    return {key, label: key, startedAt: Number(key), totals: totals(values)};
}

describe('模型用量展示数据', () => {
    it('缓存读取与输入互斥，缓存写入和推理不会重复加入总量', () => {
        const composition = buildUsageComposition(totals({
            reportedTokenRequests: 2,
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            cachedInputTokens: 40,
            cacheWriteTokens: 10,
            reasoningTokens: 5,
            cacheReportedRequests: 2,
            cacheEligibleInputTokens: 100,
        }));
        expect(composition.segments.map(segment => [segment.key, segment.tokens])).toEqual([
            ['uncached-input', 60],
            ['cached-input', 40],
            ['unknown-cache-input', 0],
            ['output', 20],
            ['other', 0],
        ]);
        expect(composition).toMatchObject({
            totalTokens: 120,
            compositionTokens: 120,
            differenceTokens: 0,
            hasReportedTokens: true,
            cacheCoverageRate: 1,
        });
        expect(composition.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
    });

    it('混合上报情况保留缓存未知输入，不把未上报缓存算作未命中', () => {
        const composition = buildUsageComposition(totals({
            reportedTokenRequests: 3,
            inputTokens: 350,
            outputTokens: 35,
            totalTokens: 385,
            cachedInputTokens: 40,
            cacheEligibleInputTokens: 150,
            cacheReportedRequests: 2,
        }));
        expect(composition.segments.map(segment => segment.tokens)).toEqual([110, 40, 200, 35, 0]);
        expect(composition.cacheCoverageRate).toBe(2 / 3);
        expect(composition.segments[2].share).toBe(200 / 385);

        const unknown = buildUsageComposition(totals({
            reportedTokenRequests: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120,
        }));
        expect(unknown.segments.map(segment => segment.tokens)).toEqual([0, 0, 100, 20, 0]);
        expect(unknown.cacheCoverageRate).toBe(0);
    });

    it('上报总计大于分项时用其他项补足，低于分项时保留负差异而不压缩分项', () => {
        const source = totals({reportedTokenRequests: 1, inputTokens: 80, outputTokens: 20, totalTokens: 140});
        const surplus = buildUsageComposition(source);
        expect(surplus).toMatchObject({totalTokens: 140, compositionTokens: 140, differenceTokens: 40});
        expect(surplus.segments.at(-1)).toMatchObject({key: 'other', tokens: 40, share: 40 / 140});

        const deficit = buildUsageComposition({...source, totalTokens: 90});
        expect(deficit).toMatchObject({totalTokens: 90, compositionTokens: 100, differenceTokens: -10});
        expect(deficit.segments.map(segment => segment.tokens)).toEqual([0, 0, 80, 20, 0]);
        expect(deficit.segments[2].share).toBe(0.8);
        expect(source.totalTokens).toBe(140);
    });

    it('明确上报零用量与完全未上报保持可区分，空构成不产生占比', () => {
        const unreported = buildUsageComposition(totals({requestCount: 1}));
        const reportedZero = buildUsageComposition(totals({
            requestCount: 1, reportedTokenRequests: 1, cacheReportedRequests: 1,
        }));
        expect(unreported).toMatchObject({hasReportedTokens: false, cacheCoverageRate: null, compositionTokens: 0});
        expect(reportedZero).toMatchObject({hasReportedTokens: true, cacheCoverageRate: 1, compositionTokens: 0});
        expect(reportedZero.segments.every(segment => segment.tokens === 0 && segment.share === 0)).toBe(true);
    });

    it('损坏的负数或非有限计数不会生成负分段，缓存范围不超出实际输入', () => {
        const invalid = buildUsageComposition(totals({
            inputTokens: -3, outputTokens: Number.NaN, totalTokens: Number.POSITIVE_INFINITY,
        }));
        expect(invalid.compositionTokens).toBe(0);
        const excessCache = buildUsageComposition(totals({
            inputTokens: 10, totalTokens: 10, cacheEligibleInputTokens: 20, cachedInputTokens: 30,
        }));
        expect(excessCache.segments.map(segment => segment.tokens)).toEqual([0, 10, 0, 0, 0]);
    });

    it('全部请求作为覆盖率分母，失败请求上报 Token 不会掩盖未上报的成功请求', () => {
        const health = buildUsageHealth(totals({
            requestCount: 4,
            successfulRequests: 2,
            errorRequests: 2,
            reportedTokenRequests: 3,
        }));
        expect(health).toEqual({reportedRequests: 3, unreportedRequests: 1, tokenCoverageRate: 0.75, successRate: 0.5});
        expect(buildUsageHealth(totals())).toEqual({
            reportedRequests: 0, unreportedRequests: 0, tokenCoverageRate: null, successRate: null,
        });
        expect(buildUsageHealth(totals({requestCount: 1, successfulRequests: 2, reportedTokenRequests: 3})))
            .toEqual({reportedRequests: 1, unreportedRequests: 0, tokenCoverageRate: 1, successRate: 1});
    });

    it('Token 趋势统一零基线，小用量不人为抬高，未上报请求仍可识别', () => {
        const timeline = [
            point('1', {requestCount: 1, reportedTokenRequests: 1, inputTokens: 999, outputTokens: 1, totalTokens: 1_000}),
            point('2', {requestCount: 1, reportedTokenRequests: 1, outputTokens: 1, totalTokens: 1}),
            point('3', {requestCount: 2, successfulRequests: 2}),
        ];
        const result = buildUsageTimeline(timeline, 'tokens');
        expect(result.metric).toBe('tokens');
        expect(result.maximum).toBe(1_000);
        expect(result.points.map(item => item.height)).toEqual([100, 0.1, 0]);
        expect(result.points.map(item => item.value)).toEqual([1_000, 1, 0]);
        expect(result.points[2]).toMatchObject({hasReportedTokens: false, unreportedRequests: 2});
        expect(result.points[0].segments[2]).toMatchObject({key: 'unknown-cache-input', value: 999, share: 0.999});
        expect(timeline[0]).not.toHaveProperty('height');
    });

    it('趋势按可解释分段总量绘图，并传出供应商总计的正负差异', () => {
        const result = buildUsageTimeline([
            point('1', {reportedTokenRequests: 1, inputTokens: 100, outputTokens: 20, totalTokens: 90}),
            point('2', {reportedTokenRequests: 1, inputTokens: 100, outputTokens: 20, totalTokens: 150}),
        ], 'tokens');
        expect(result.maximum).toBe(150);
        expect(result.points.map(item => [item.value, item.height, item.differenceTokens]))
            .toEqual([[120, 80, -30], [150, 100, 30]]);
        expect(result.points[1].segments.at(-1)).toMatchObject({key: 'other', value: 30, share: 0.2});
    });

    it('请求趋势使用全部调用，成功、错误、超时和取消分段合计一致', () => {
        const result = buildUsageTimeline([
            point('1', {requestCount: 10, successfulRequests: 6, errorRequests: 2, timeoutRequests: 1, cancelledRequests: 1}),
            point('2'),
        ], 'requests');
        expect(result.maximum).toBe(10);
        expect(result.points.map(item => item.height)).toEqual([100, 0]);
        expect(result.points[0].segments.map(segment => [segment.key, segment.value, segment.share])).toEqual([
            ['success', 6, 0.6], ['error', 2, 0.2], ['timeout', 1, 0.1], ['cancelled', 1, 0.1],
        ]);
        expect(result.points[0].unreportedRequests).toBe(10);
        expect(result.points[1].segments.every(segment => segment.share === 0)).toBe(true);
    });

    it('空时间线和全零时间线没有虚构刻度或柱高', () => {
        expect(buildUsageTimeline([], 'tokens')).toEqual({metric: 'tokens', maximum: 0, points: []});
        const zero = buildUsageTimeline([point('1')], 'tokens');
        expect(zero.maximum).toBe(0);
        expect(zero.points[0].height).toBe(0);
        expect(buildUsageTimeline([point('1')], 'requests').points[0].height).toBe(0);
    });
});
