import {describe, expect, it} from 'vitest';
import {getFreeHedgeDelayMs, classifyFreeFailure, getDynamicFreeProviderWeight, getFreeFailureCooldown, getFreeFailureStatus, observeFreeProviderPerformance, selectWeightedFreeCandidate} from '@/src/services/translation/freeRoutingPolicy';

describe('free routing policy', () => {
  it('updates performance with EWMA and returns fast reliable services a higher weight', () => {
    const first = observeFreeProviderPerformance(undefined, true, 40, 1000);
    expect(first).toEqual({reliability: 1, latencyMs: 40, observedAt: 1000});
    const failed = observeFreeProviderPerformance(first, false, 1, 2000);
    expect(failed.reliability).toBe(0.75);
    expect(failed.latencyMs).toBe(40);
    expect(getDynamicFreeProviderWeight(1, failed, 2000)).toBeGreaterThan(getDynamicFreeProviderWeight(1, {reliability: 0.2, latencyMs: 12_000, observedAt: 2000}, 2000));
    expect(getDynamicFreeProviderWeight(3, undefined, 2000)).toBe(3);
    expect(getDynamicFreeProviderWeight(1, failed, -1)).toBeGreaterThan(0);
    expect(getDynamicFreeProviderWeight(1, failed, 86_402_000)).toBeCloseTo(1, 5);
  });
  it('reacts immediately to slowness, smooths recovery and distinguishes subsecond services', () => {
    const slow = observeFreeProviderPerformance({reliability: 1, latencyMs: 100, observedAt: 0}, true, 4000, 1);
    expect(slow.latencyMs).toBe(4000);
    expect(observeFreeProviderPerformance(slow, true, 100, 2).latencyMs).toBe(3025);
    expect(getDynamicFreeProviderWeight(3, {reliability: 1, latencyMs: 250, observedAt: 1}, 1))
      .toBeGreaterThan(getDynamicFreeProviderWeight(3, {reliability: 1, latencyMs: 900, observedAt: 1}, 1));
    expect(getFreeHedgeDelayMs()).toBe(1500);
    expect(getFreeHedgeDelayMs(slow)).toBe(2000);
    expect(getFreeHedgeDelayMs({...slow, latencyMs: 10})).toBe(800);
  });

  it('classifies explicit categories and HTTP statuses', () => {
    expect(classifyFreeFailure({freeFailure: 'quota'})).toBe('quota');
    expect(classifyFreeFailure({statusCode: 429})).toBe('rate-limit');
    expect(classifyFreeFailure({status: 402})).toBe('quota');
    expect(classifyFreeFailure({status: 403})).toBe('blocked');
    expect(classifyFreeFailure({status: 404})).toBe('blocked');
    expect(classifyFreeFailure({status: 400})).toBe('request');
    expect(classifyFreeFailure({status: 408})).toBe('unavailable');
    expect(classifyFreeFailure({status: 500})).toBe('unavailable');
    expect(classifyFreeFailure(null)).toBe('unavailable');
    expect(getFreeFailureStatus({statusCode: 429})).toBe(429);
    expect(getFreeFailureStatus({status: '429'})).toBeUndefined();
    expect(getFreeFailureStatus({status: 99})).toBeUndefined();
  });

  it('uses retry-after and bounded escalating windows', () => {
    expect(getFreeFailureCooldown({status: 429, retryAfterMs: 2_000}, 1, 1_000, 0)).toEqual({category: 'rate-limit', durationMs: 2_000});
    expect(getFreeFailureCooldown({status: 429, retryAfterMs: 99_999_999_999}, 1, 1_000, 0).durationMs).toBe(7 * 86_400_000);
    expect(getFreeFailureCooldown({status: 400}, 4, 1_000, 0)).toEqual({category: 'request', durationMs: 0});
    expect(getFreeFailureCooldown({status: 429}, 2, 1_000, 1).durationMs).toBe(720_000);
    expect(getFreeFailureCooldown({status: 402}, 20, 1_000, 0).durationMs).toBe(86_400_000);
    expect(getFreeFailureCooldown({status: 403}, 2, 1_000, 0).durationMs).toBe(43_200_000);
    expect(getFreeFailureCooldown({}, 1, 2_000, 0).durationMs).toBe(2_000);
    expect(getFreeFailureCooldown({}, 1, 2_000, Number.NaN).durationMs).toBe(2_000);
  });

  it('selects by injected weight without forcing alternation', () => {
    const candidates = [{identity: 'a', weight: 5}, {identity: 'b', weight: 1}, {identity: 'c', weight: 1}];
    expect(selectWeightedFreeCandidate(candidates, 0)).toEqual(candidates[0]);
    expect(selectWeightedFreeCandidate(candidates, 0.8)).toEqual(candidates[1]);
    expect(selectWeightedFreeCandidate([{identity: 'a', weight: 0}], 2)?.identity).toBe('a');
    expect(selectWeightedFreeCandidate([{identity: 'a', weight: Number.NaN}, {identity: 'b', weight: 101}], Number.NaN)?.identity).toBe('a');
    expect(selectWeightedFreeCandidate([{identity: 'a', weight: 1}, {identity: 'b', weight: 1}], 1)?.identity).toBe('b');
    expect(selectWeightedFreeCandidate([], 0)).toBeUndefined();
    expect(selectWeightedFreeCandidate([{identity: 'a', weight: 1}, {identity: 'b', weight: 1}], Number.POSITIVE_INFINITY)?.identity).toBe('a');
  });
});
