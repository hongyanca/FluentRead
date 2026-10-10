/** 公共 deadline 调度合同：不增加总预算，已有可用容量足以完成的急请求不应在新长请求后超时。 */
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createFreeFallbackRunner} from '@/src/services/translation/freeFallback';
const settings = {mode: 'sequential' as const, timeoutMs: 5000, cooldownMs: 60000};
function watch<T>(work: Promise<T>) {
    const state: {value?: T; error?: unknown; at?: number} = {};
    void work.then(value => Object.assign(state, {value, at: Date.now()}), error => Object.assign(state, {error, at: Date.now()}));
    return state;
}
beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(0);});
afterEach(() => {expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();});
it('serves an earlier absolute deadline while both queued requests can still finish within their original budgets', async () => {
    const run = createFreeFallbackRunner(1);
    let release!: (value: string) => void;
    const held = run([{identity: 'held', label: 'held', translate: () => new Promise<string>(resolve => {release = resolve;})}], {...settings, deadline: 4000});
    await vi.advanceTimersByTimeAsync(0);
    const late = watch(run([{identity: 'long', label: 'long', translate: () => new Promise<string>(resolve => setTimeout(() => resolve('较晚请求译文'), 3000))}], {...settings, deadline: 4000}));
    const urgent = watch(run([{identity: 'urgent', label: 'urgent', translate: () => new Promise<string>(resolve => setTimeout(() => resolve('较早请求译文'), 50))}], {...settings, deadline: 500}));
    await vi.advanceTimersByTimeAsync(100); release('占用请求译文'); await held;
    await vi.advanceTimersByTimeAsync(3400);
    expect(urgent).toMatchObject({value: '较早请求译文', at: 150});
    expect(urgent.error).toBeUndefined();
    expect(late).toMatchObject({value: '较晚请求译文', at: 3150});
    expect(late.error).toBeUndefined();
});
it('keeps FIFO for tied deadlines and removes a cancelled earlier waiter without cancelling other owners', async () => {
    const run = createFreeFallbackRunner(1);
    let release!: (value: string) => void;
    const held = run([{identity: 'held', label: 'held', translate: () => new Promise<string>(resolve => {release = resolve;})}], {...settings, deadline: 4000});
    await vi.advanceTimersByTimeAsync(0);
    const started: string[] = [];
    const source = (identity: string) => ({identity, label: identity, translate: (signal: AbortSignal) => {
        expect(signal.aborted).toBe(false); started.push(identity);
        return new Promise<string>(resolve => setTimeout(() => resolve(identity), 20));
    }});
    const first = watch(run([source('first')], {...settings, deadline: 1000}));
    const controller = new AbortController();
    const cancelled = watch(run([source('cancelled')], {...settings, deadline: 200, signal: controller.signal}));
    const last = watch(run([source('last')], {...settings, deadline: 1000}));
    await vi.advanceTimersByTimeAsync(50); controller.abort();
    await vi.advanceTimersByTimeAsync(50); release('held'); await held;
    await vi.advanceTimersByTimeAsync(100);
    expect(cancelled.error).toMatchObject({name: 'AbortError'});
    expect(started).toEqual(['first', 'last']);
    expect(first).toMatchObject({value: 'first', at: 120});
    expect(last).toMatchObject({value: 'last', at: 140});
    const reusable = run([source('reusable')], {...settings, deadline: 1000});
    await vi.advanceTimersByTimeAsync(20);
    await expect(reusable).resolves.toBe('reusable');
});
