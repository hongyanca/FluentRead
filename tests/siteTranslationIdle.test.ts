import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import * as ts from 'typescript';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const require = createRequire(import.meta.url);
const {observeTranslationIdleInPage, waitForTranslationIdle} = require('../scripts/run-site-translation-test.cjs');
const selector = '.fluent-read-loading[data-fr-translation-owned="true"]';
const key = '__testTranslationIdle';

describe('long-page translation idle regression', () => {
  let document: Document;
  let window: Window;
  let now: number;
  const observe = () => observeTranslationIdleInPage({selector, key, stableMs: 12, stallTimeoutMs: 210, maximumDurationMs: 630});
  const addLoading = (id: string) => {
    const owner = document.createElement('p');
    owner.id = id;
    owner.innerHTML = `Original text ${id}<span class="fluent-read-loading" data-fr-translation-owned="true"></span>`;
    document.body.append(owner);
    return owner;
  };
  const complete = (owner: HTMLElement, translated = true) => {
    owner.querySelector(selector)?.remove();
    if (translated) {
      const result = document.createElement('span');
      result.className = 'fluent-read-bilingual-content';
      result.setAttribute('data-fr-translation-owned', 'true');
      result.textContent = '译文';
      owner.append(result);
    }
  };
  const noticeRoot = () => {
    const host = document.createElement('div');
    host.id = 'fluent-read-page-notice-host';
    document.body.append(host);
    return host.attachShadow({mode: 'open'});
  };
  const addNotice = (root: ShadowRoot, reason: string) => {
    const notice = document.createElement('div');
    notice.className = 'page-notice';
    const detail = document.createElement('div');
    detail.className = 'notice-detail';
    detail.textContent = reason;
    notice.append(detail);
    root.append(notice);
    return notice;
  };
  const addRetryOwner = (id: string, onReason?: () => void, owned = true) => {
    const owner = document.createElement('p');
    owner.id = id;
    owner.textContent = `Original text ${id}`;
    const retry = document.createElement('span');
    retry.className = 'fluent-read-retry-wrapper';
    if (owned) retry.setAttribute('data-fr-translation-owned', 'true');
    if (onReason) {
      const action = document.createElement('button');
      action.className = 'fluent-read-reason';
      action.textContent = '查看原因';
      action.addEventListener('click', onReason);
      retry.append(action);
    }
    owner.append(retry);
    document.body.append(owner);
    return owner;
  };
  const collectTerminalReasons = async () => {
    const ownerHTML = [...document.querySelectorAll('p')].map(owner => owner.outerHTML);
    const evaluations: unknown[] = [];
    const page = {
      waitForFunction: async (predicate: (args: unknown) => boolean, args: unknown) => {
        expect(predicate(args)).toBe(false);
        now += 1200;
        expect(predicate(args)).toBe(true);
      },
      evaluate: async (fn: (args: unknown) => unknown, args: unknown) => {
        evaluations.push(args);
        return fn(args);
      },
    };
    let failure: unknown;
    try { await waitForTranslationIdle(page, 100, 'reason-attribution', 2100); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    const marker = 'reason-attribution 存在终态翻译失败：';
    expect(message.startsWith(marker)).toBe(true);
    expect(evaluations).toHaveLength(2);
    expect(evaluations).toEqual(expect.arrayContaining([
      '.fluent-read-retry-wrapper[data-fr-translation-owned="true"]',
      expect.stringMatching(/^__fluentReadIdleSince/u),
    ]));
    expect(Object.keys(window).filter(value => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
    expect([...document.querySelectorAll('p')].map(owner => owner.outerHTML)).toEqual(ownerHTML);
    return JSON.parse(message.slice(marker.length)) as Array<{
      ownerId: string; ownerTag: string; ownerText: string; errorReason: string; errorReasonStatus: string;
    }>;
  };

  beforeEach(() => {
    ({document, window} = parseHTML('<html><body></body></html>') as unknown as {document: Document; window: Window});
    Reflect.deleteProperty(window, key);
    now = 0;
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('performance', {now: () => now});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows a long queue to keep completing beyond a single request budget', () => {
    let owner = addLoading('one');
    expect(observe()).toBe(false);
    for (const time of [100, 200, 300, 400]) {
      now = time;
      complete(owner);
      owner = addLoading(String(time));
      expect(observe()).toBe(false);
    }
    now = 450;
    complete(owner);
    expect(observe()).toBe(false);
    now = 461;
    expect(observe()).toBe(false);
    now = 462;
    expect(observe()).toBe(true);
  });

  it('recognizes completed unchanged text without requiring a new translation wrapper', () => {
    const first = addLoading('unchanged');
    observe();
    now = 200;
    complete(first, false);
    addLoading('next');
    expect(observe()).toBe(false);
    now = 300;
    expect(observe()).toBe(false);
    now = 410;
    expect(observe).toThrow('没有完成进展');
  });

  it('tracks distinct anonymous identical unchanged paragraphs as separate completed tasks', () => {
    let owner = addLoading('');
    observe();
    for (const time of [100, 200, 300, 400]) {
      now = time;
      complete(owner, false);
      owner = addLoading('');
      expect(observe()).toBe(false);
    }
    now = 450;
    complete(owner, false);
    expect(observe()).toBe(false);
    now = 462;
    expect(observe()).toBe(true);
  });

  it('does not count host nodes with a matching class as completed translations', () => {
    addLoading('stalled');
    observe();
    for (const time of [100, 200]) {
      now = time;
      document.body.insertAdjacentHTML('beforeend', '<span class="fluent-read-bilingual-content">Host content</span>');
      expect(observe()).toBe(false);
    }
    now = 210;
    expect(observe).toThrow('没有完成进展');
  });

  it('does not treat animation, spinner replacement, or a new queued owner as completion', () => {
    const owner = addLoading('stalled');
    observe();
    now = 100;
    const replacement = owner.querySelector(selector)!.cloneNode(true) as HTMLElement;
    owner.querySelector(selector)!.replaceWith(replacement);
    replacement.setAttribute('style', 'opacity: 0.5');
    owner.firstChild!.textContent = 'Changing source while still loading';
    addLoading('newly-started');
    expect(observe()).toBe(false);
    now = 210;
    expect(observe).toThrow('没有完成进展');
  });

  it('does not let repeated settlement of the same owner or wrapper count rebound renew the budget', () => {
    const stalled = addLoading('stalled');
    const repeated = addLoading('repeated');
    observe();
    now = 50;
    complete(repeated);
    observe();
    now = 100;
    repeated.querySelector('.fluent-read-bilingual-content')!.remove();
    repeated.insertAdjacentHTML('beforeend', '<span class="fluent-read-loading" data-fr-translation-owned="true"></span>');
    observe();
    now = 150;
    complete(repeated);
    expect(observe()).toBe(false);
    now = 260;
    expect(stalled.querySelector(selector)).not.toBeNull();
    expect(observe).toThrow('没有完成进展');
  });

  it('does not count a removed host subtree as a successfully completed task', () => {
    const owner = addLoading('removed');
    addLoading('stalled');
    observe();
    now = 200;
    owner.remove();
    expect(observe()).toBe(false);
    now = 210;
    expect(observe).toThrow('没有完成进展');
  });

  it('enforces an absolute phase limit even while distinct tasks keep completing', () => {
    let owner = addLoading('first');
    observe();
    for (const time of [100, 200, 300, 400, 500, 600]) {
      now = time;
      complete(owner);
      owner = addLoading(String(time));
      expect(observe()).toBe(false);
    }
    now = 630;
    complete(owner);
    expect(observe).toThrow('硬上限');
  });

  it('requires a continuous idle window after a new loading task interrupts apparent idle', () => {
    expect(observe()).toBe(false);
    now = 11;
    const owner = addLoading('late');
    expect(observe()).toBe(false);
    now = 20;
    complete(owner);
    expect(observe()).toBe(false);
    now = 31;
    expect(observe()).toBe(false);
    now = 32;
    expect(observe()).toBe(true);
  });

  it('cleans temporary state after success and refuses terminal retry controls', async () => {
    const page = {
      waitForFunction: async (predicate: (args: unknown) => boolean, args: unknown) => {
        expect(predicate(args)).toBe(false);
        now += 1200;
        expect(predicate(args)).toBe(true);
      },
      evaluate: async (fn: (args: unknown) => unknown, args: unknown) => fn(args),
    };
    await waitForTranslationIdle(page, 100, 'success', 2100);
    expect(Object.keys(window).filter((value) => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
    document.body.innerHTML = '<p>Failed source<span class="fluent-read-retry-wrapper" data-fr-translation-owned="true"></span></p>';
    await expect(waitForTranslationIdle(page, 100, 'failure', 2100)).rejects.toThrow('终态翻译失败');
    expect(Object.keys(window).filter((value) => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
  });

  it('preserves the actual stall as cause and reads its owner through the shared collector callback', async () => {
    addLoading('stalled');
    const page = {
      waitForFunction: async (predicate: (args: unknown) => boolean, args: unknown) => {
        predicate(args);
        now = 2100;
        predicate(args);
      },
      evaluate: async (fn: (args: unknown) => unknown, args: unknown) => fn(args),
    };
    let failure: Error & {cause?: Error};
    try { await waitForTranslationIdle(page, 100, 'stalled', 2100); throw new Error('Expected stall'); }
    catch (error) { failure = error as Error & {cause?: Error}; }
    expect(failure!.message).toContain('stalled 等待翻译请求结束超时');
    expect(failure!.cause?.message).toContain('没有完成进展');
    expect(Object.keys(window).filter((value) => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
    const source = ts.createSourceFile('runner.cjs', readFileSync(new URL('../scripts/run-site-translation-test.cjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const callbacks: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'snapshot' && node.initializer && ts.isAwaitExpression(node.initializer)) {
        const call = node.initializer.expression;
        if (ts.isCallExpression(call) && call.expression.getText(source) === 'page.evaluate' && call.arguments[0] && ts.isArrowFunction(call.arguments[0])) callbacks.push(call.arguments[0].getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(callbacks).toHaveLength(1);
    const snapshot = runInNewContext(`(${callbacks[0]})()`, {document, window, location: {origin: 'https://fixture.invalid', pathname: '/article', search: '?private=not-exported'}}, {timeout: 1000});
    expect(snapshot.owned).toMatchObject({wrappers: 0, nestedWrappers: 0, loading: 1, loadingOwners: 1, retries: 0,
      loadingOwnerSamples: [{tag: 'P', id: 'stalled', directOwned: 1}], retryOwnerSamples: []});
    expect(snapshot.url).toBe('https://fixture.invalid/article');
    expect(JSON.stringify(snapshot)).not.toContain('Original text');
  });

  it.each(['pending', 'rejecting', 'throwing'] as const)('propagates the original wait error when key cleanup is %s', async behavior => {
    const original = new Error('original idle sentinel');
    const secondary = new Error('cleanup sentinel');
    const evaluate = vi.fn(() => {
      if (behavior === 'throwing') throw secondary;
      return behavior === 'pending' ? new Promise(() => {}) : Promise.reject(secondary);
    });
    const page = {waitForFunction: async () => { throw original; }, evaluate};
    let failure: Error & {cause?: Error};
    try { await waitForTranslationIdle(page, 100, 'failed-wait', 2100); throw new Error('Expected wait failure'); }
    catch (error) { failure = error as Error & {cause?: Error}; }
    expect(failure!.message).toContain('original idle sentinel');
    expect(failure!.cause).toBe(original);
    expect(evaluate).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it('does not attribute the last B notice to the third owner when A, B, A are reused in place', async () => {
    const root = noticeRoot();
    const existing = new Map<string, HTMLElement>();
    const clicks: string[] = [];
    for (const [id, reason] of [['owner-a', 'Reason A'], ['owner-b', 'Reason B'], ['owner-a-again', 'Reason A']]) {
      addRetryOwner(id, () => {
        clicks.push(id);
        if (!existing.has(reason)) existing.set(reason, addNotice(root, reason));
      });
    }
    const records = await collectTerminalReasons();
    expect(clicks).toEqual(['owner-a', 'owner-b', 'owner-a-again']);
    expect(records).toMatchObject([
      {ownerId: 'owner-a', errorReason: 'Reason A', errorReasonStatus: 'observed-update'},
      {ownerId: 'owner-b', errorReason: 'Reason B', errorReasonStatus: 'observed-update'},
      {ownerId: 'owner-a-again', errorReason: '', errorReasonStatus: 'ambiguous'},
    ]);
    expect(root.children).toHaveLength(2);
    expect(root.firstElementChild).toBe(existing.get('Reason A'));
    expect(root.lastElementChild).toBe(existing.get('Reason B'));
    records.forEach(record => {
      expect(record.ownerTag).toBe('P');
      expect(record.ownerText).toContain(`Original text ${record.ownerId}`);
    });
  });

  it('keeps a reused singleton ambiguous when the second action has no observable update', async () => {
    const root = noticeRoot();
    let notice: HTMLElement | undefined;
    const show = () => { notice ??= addNotice(root, 'Shared timeout'); };
    addRetryOwner('first', show);
    addRetryOwner('second', show);
    const records = await collectTerminalReasons();
    expect(records).toMatchObject([
      {ownerId: 'first', errorReason: 'Shared timeout', errorReasonStatus: 'observed-update'},
      {ownerId: 'second', errorReason: '', errorReasonStatus: 'ambiguous'},
    ]);
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild).toBe(notice);
  });

  it('does not assign an unrelated pre-existing singleton to a no-op reason action', async () => {
    const root = noticeRoot();
    const stale = addNotice(root, 'Unrelated old reason');
    const action = vi.fn();
    addRetryOwner('no-update', action);
    expect(await collectTerminalReasons()).toMatchObject([
      {ownerId: 'no-update', errorReason: '', errorReasonStatus: 'ambiguous'},
    ]);
    expect(action).toHaveBeenCalledOnce();
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild).toBe(stale);
    expect(stale.querySelector('.notice-detail')!.textContent).toBe('Unrelated old reason');
  });

  it('does not assign a singleton emitted by an earlier owner to a later no-op action', async () => {
    const root = noticeRoot();
    addRetryOwner('first-owner', () => addNotice(root, 'First owner timeout'));
    const secondAction = vi.fn();
    addRetryOwner('second-owner', secondAction);
    expect(await collectTerminalReasons()).toMatchObject([
      {ownerId: 'first-owner', errorReason: 'First owner timeout', errorReasonStatus: 'observed-update'},
      {ownerId: 'second-owner', errorReason: '', errorReasonStatus: 'ambiguous'},
    ]);
    expect(secondAction).toHaveBeenCalledOnce();
    expect(root.children).toHaveLength(1);
  });

  it('keeps terminal failure owners when their action or resulting notice is missing', async () => {
    const root = noticeRoot();
    const stale = addNotice(root, 'Unrelated old reason');
    addRetryOwner('missing-action');
    addRetryOwner('missing-notice', () => stale.remove());
    expect(await collectTerminalReasons()).toMatchObject([
      {ownerId: 'missing-action', errorReason: '', errorReasonStatus: 'missing-action'},
      {ownerId: 'missing-notice', errorReason: '', errorReasonStatus: 'missing-notice'},
    ]);
  });

  it('observes updated and revived notices while ignoring a host retry lookalike', async () => {
    const root = noticeRoot();
    const revived = addNotice(root, 'Revived owner reason');
    revived.classList.add('is-leaving');
    const changed = addNotice(root, 'Old reason');
    addRetryOwner('updated', () => { changed.querySelector('.notice-detail')!.textContent = 'Updated owner reason'; });
    addRetryOwner('revived', () => revived.classList.remove('is-leaving'));
    const hostAction = vi.fn();
    addRetryOwner('host-lookalike', hostAction, false);
    expect(await collectTerminalReasons()).toMatchObject([
      {ownerId: 'updated', errorReason: 'Updated owner reason', errorReasonStatus: 'observed-update'},
      {ownerId: 'revived', errorReason: 'Revived owner reason', errorReasonStatus: 'observed-update'},
    ]);
    expect(hostAction).not.toHaveBeenCalled();
    expect(root.firstElementChild).toBe(revived);
    expect(root.lastElementChild).toBe(changed);
  });
});

describe('failure provider statistics projection from the actual runner callback', () => {
  // Read the integrated candidate, so later runner hunks are exercised without copying its implementation.
  const source = ts.createSourceFile('run-site-translation-test.cjs',
    readFileSync(new URL('../scripts/run-site-translation-test.cjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const callbacks: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'statsPage'
      && node.expression.name.text === 'evaluate' && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
      callbacks.push(node.arguments[0].getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  type Reply = (response: unknown) => void;
  type Runtime = {lastError?: {message: string}; sendMessage: (message: unknown, reply: Reply) => void};
  const evaluateStats = async (action: 'query' | 'list', send: (reply: Reply, runtime: Runtime) => void) => {
    expect(callbacks).toHaveLength(1);
    const messages: unknown[] = [];
    const runtime: Runtime = {sendMessage: (message, reply) => { messages.push(message); send(reply, runtime); }};
    const evaluate = runInNewContext(`(${callbacks[0]})`, {
      chrome: {runtime}, setTimeout, clearTimeout,
    }, {timeout: 1000}) as (args: {
      action: 'query' | 'list'; serviceId: string; since: number; remainingMs: number;
    }) => Promise<unknown>;
    const projection = await evaluate({action, serviceId: 'freeTranslation', since: 1000, remainingMs: 50});
    expect(vi.getTimerCount()).toBe(0);
    return {result: JSON.parse(JSON.stringify(projection)) as Record<string, unknown>,
      messages: JSON.parse(JSON.stringify(messages)) as unknown[]};
  };
  const queryData = (requestCount = 3) => ({
    generatedAt: 2000,
    selected: {filter: {range: 'today', serviceId: 'freeTranslation'}, totals: {
      requestCount, segmentCount: 4, cachedSegments: 0, upstreamCalls: 2,
      averageDurationMs: 24, maxDurationMs: 40, averageUpstreamMs: 12,
      outcomes: {success: 2, error: 0, timeout: 1, cancelled: 0},
    }},
    routes: [] as unknown[],
  });
  const timeoutRow = (overrides: Record<string, unknown> = {}) => ({
    serviceId: 'freeTranslation', startedAt: 1000, durationMs: 30000,
    segmentCount: 2, sourceChars: 42, sourceBytes: 42, cachedSegments: 0,
    upstreamCalls: 1, upstreamMs: 29000, statusCode: 504,
    outcome: 'timeout', mode: 'batch', errorKind: 'timeout', routes: ['google', 'bing'],
    ...overrides,
  });
  const listData = (items: unknown[], totalCount = items.length) => ({
    generatedAt: 2000, filter: {range: 'today', serviceId: 'freeTranslation', outcome: 'timeout'},
    totalCount, limit: 100, offset: 0, items,
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('sends the actual query and projects only safe finite counts without assigning the rollup timeout to a route', async () => {
    const data = queryData();
    const response = {success: true, token: 'PRIVATE_ONLY', data: {
      ...data, sourceText: 'PRIVATE_ONLY', ownerId: 'PRIVATE_ONLY',
      selected: {...data.selected, totals: {...data.selected.totals,
        cachedSegments: -1, upstreamCalls: Infinity, averageUpstreamMs: 'PRIVATE_ONLY', rawRequest: 'PRIVATE_ONLY',
        outcomes: {success: 2, error: -1, timeout: 1, cancelled: NaN},
      }},
      routes: [
        {serviceId: 'freeTranslation', route: 'google', rawResponse: 'PRIVATE_ONLY', totals: {
          attemptCount: 2, averageDurationMs: 120, maxDurationMs: 300,
          outcomes: {success: 2, error: 0, timeout: 0, cancelled: 0}, token: 'PRIVATE_ONLY',
        }},
        {serviceId: 'other-service', route: 'bing', totals: {attemptCount: 999}},
        {serviceId: 'freeTranslation', route: 'https://PRIVATE_ONLY/?key=PRIVATE_ONLY', totals: {attemptCount: 999}},
      ],
    }};
    const {result, messages} = await evaluateStats('query', reply => reply(response));
    expect(messages).toEqual([{type: 'translationStats', action: 'query', filter: {range: 'today', serviceId: 'freeTranslation'}}]);
    expect(result).toEqual({
      status: 'available', reason: null, generatedAt: 2000,
      totals: {requestCount: 3, segmentCount: 4, cachedSegments: null, upstreamCalls: null,
        averageDurationMs: 24, maxDurationMs: 40, averageUpstreamMs: null,
        recordedOutcomes: {success: 2, error: null, timeout: 1, cancelled: null}},
      routeStats: {status: 'available', timeoutRouteAttribution: 'unavailable', rows: [
        {route: 'google', attemptCount: 2, averageDurationMs: 120, maxDurationMs: 300,
          recordedOutcomes: {success: 2, error: 0, timeout: 0, cancelled: 0}},
      ]},
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ONLY');
  });

  it('projects list fields, enums and route identifiers without exposing credentials, text or owner joins', async () => {
    const row = timeoutRow({durationMs: -1, sourceChars: NaN, statusCode: Infinity,
      mode: 'PRIVATE_ONLY', errorKind: 'PRIVATE_ONLY', ownerId: 'PRIVATE_ONLY',
      sourceText: 'PRIVATE_ONLY', translatedText: 'PRIVATE_ONLY', token: 'PRIVATE_ONLY',
      headers: {Authorization: 'PRIVATE_ONLY'}, url: 'https://PRIVATE_ONLY',
      routes: ['google', 'https://PRIVATE_ONLY', 'bing', '', '9invalid', 'x'.repeat(65)],
    });
    const {result} = await evaluateStats('list', reply => reply({success: true, data: {
      ...listData([row]), generatedAt: NaN, credential: 'PRIVATE_ONLY',
    }}));
    expect(result).toEqual({
      status: 'available', reason: null, generatedAt: null, totalCount: 1, limit: 100, offset: 0,
      truncated: false, items: [{startedAt: 1000, durationMs: null, segmentCount: 2,
        sourceChars: null, sourceBytes: 42, cachedSegments: 0, upstreamCalls: 1, upstreamMs: 29000,
        statusCode: null, outcome: 'timeout', mode: null, errorKind: null,
        recordedRoutes: ['google', 'bing'], timeoutRouteAttribution: 'unavailable'}],
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ONLY');
  });

  it('retains the inclusive attempt-start boundary and excludes earlier, foreign-service and non-timeout records', async () => {
    const {result, messages} = await evaluateStats('list', reply => reply({success: true, data: listData([
      timeoutRow({startedAt: 999}), timeoutRow({startedAt: 1000}), timeoutRow({startedAt: 1001}),
      timeoutRow({startedAt: 1002, serviceId: 'other-service'}), timeoutRow({startedAt: 1003, outcome: 'success'}),
      timeoutRow({startedAt: Infinity}), timeoutRow({startedAt: NaN}), timeoutRow({startedAt: '1004'}),
    ])}));
    expect(messages).toEqual([{type: 'translationStats', action: 'list', query: {
      filter: {range: 'today', serviceId: 'freeTranslation', outcome: 'timeout'}, sort: 'recent', offset: 0, limit: 100,
    }}]);
    expect(result).toMatchObject({status: 'available', totalCount: 8, truncated: false, items: [
      {startedAt: 1000, mode: 'batch', errorKind: 'timeout', timeoutRouteAttribution: 'unavailable'},
      {startedAt: 1001, mode: 'batch', errorKind: 'timeout', timeoutRouteAttribution: 'unavailable'},
    ]});
  });

  it('marks a paginated timeout list as truncated and caps both route projections at sixteen', async () => {
    const routes = Array.from({length: 20}, (_, index) => `route-${index}`);
    const data = queryData();
    data.routes = routes.map(route => ({serviceId: 'freeTranslation', route, totals: {attemptCount: 1}}));
    const query = await evaluateStats('query', reply => reply({success: true, data}));
    expect(query.result).toMatchObject({routeStats: {status: 'available', timeoutRouteAttribution: 'unavailable',
      rows: routes.slice(0, 16).map(route => ({route, attemptCount: 1}))}});
    expect((query.result.routeStats as {rows: unknown[]}).rows).toHaveLength(16);
    const rows = Array.from({length: 100}, (_, index) => timeoutRow({startedAt: 1000 + index, routes}));
    const list = await evaluateStats('list', reply => reply({success: true, data: listData(rows, 101)}));
    expect(list.result).toMatchObject({status: 'available', totalCount: 101, limit: 100, truncated: true,
      items: rows.map(row => ({startedAt: row.startedAt, recordedRoutes: routes.slice(0, 16), timeoutRouteAttribution: 'unavailable'}))});
    expect(list.result.items).toHaveLength(100);
    expect(list.messages).toHaveLength(1);
  });

  it('reports local truncation when the API returns more rows than the requested limit', async () => {
    const rows = Array.from({length: 101}, (_, index) => timeoutRow({startedAt: 1000 + index}));
    const {result} = await evaluateStats('list', reply => reply({success: true, data: listData(rows)}));
    expect(result).toMatchObject({status: 'available', totalCount: 101, limit: 100, truncated: true,
      items: rows.slice(0, 100).map(row => ({startedAt: row.startedAt}))});
    expect(result.items).toHaveLength(100);
  });

  it('reports unavailable rather than successful empty evidence for zero requests and an empty attempt window', async () => {
    const query = await evaluateStats('query', reply => reply({success: true, data: queryData(0)}));
    expect(query.result).toMatchObject({status: 'unavailable', reason: 'no-recorded-requests',
      totals: {requestCount: 0}, routeStats: {status: 'unavailable', timeoutRouteAttribution: 'unavailable', rows: []}});
    const list = await evaluateStats('list', reply => reply({success: true, data: listData([timeoutRow({startedAt: 999})])}));
    expect(list.result).toMatchObject({status: 'unavailable', reason: 'no-timeout-records-in-attempt-window', items: []});
  });

  it.each(['rejected', 'no-response', 'runtime-error', 'throws'] as const)(
    'keeps both statistics API actions unavailable and redacts raw errors when %s', async behavior => {
      for (const action of ['query', 'list'] as const) {
        const {result, messages} = await evaluateStats(action, (reply, runtime) => {
          if (behavior === 'throws') throw new Error('PRIVATE_ONLY');
          if (behavior === 'runtime-error') runtime.lastError = {message: 'PRIVATE_ONLY'};
          reply(behavior === 'no-response' ? undefined : behavior === 'rejected'
            ? {success: false, error: 'PRIVATE_ONLY'} : {success: true, data: action === 'query' ? queryData() : listData([timeoutRow()])});
        });
        expect(result).toEqual({status: 'unavailable', reason: 'stats-api-unavailable'});
        expect(messages).toHaveLength(1);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_ONLY');
      }
    },
  );

  it.each(['query', 'list'] as const)('rejects mismatched-service and missing required %s response shapes', async action => {
    const wrongService = action === 'query'
      ? {...queryData(), selected: {...queryData().selected, filter: {serviceId: 'other-service'}}}
      : {...listData([timeoutRow()]), filter: {serviceId: 'other-service'}};
    const missingFields = action === 'query'
      ? {selected: {filter: {serviceId: 'freeTranslation'}}} : {filter: {serviceId: 'freeTranslation'}};
    for (const data of [wrongService, missingFields]) {
      const {result} = await evaluateStats(action, reply => reply({success: true, data}));
      expect(result).toEqual({status: 'unavailable', reason: 'stats-shape-unavailable'});
    }
  });

  it('bounds an unanswered API callback without retries and ignores a response after the deadline', async () => {
    let lateReply: Reply | undefined;
    let settled = false;
    const pending = evaluateStats('query', reply => { lateReply = reply; })
      .then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.result).toEqual({status: 'unavailable', reason: 'stats-api-unavailable'});
    expect(result.messages).toHaveLength(1);
    lateReply!({success: true, data: queryData()});
    expect(result.result).toEqual({status: 'unavailable', reason: 'stats-api-unavailable'});
    expect(vi.getTimerCount()).toBe(0);
  });
});


describe('owned failed-page diagnostic collector', () => {
  type DiagnosticProjection = {status: string; reason?: string; url?: string; stage?: string;
    failureCode?: string; totals?: {requestCount: number};
    owned?: {retryOwners: number; retryOwnerSamples: Array<{id: string}>}};
  const source = ts.createSourceFile('run-site-translation-test.cjs',
    readFileSync(new URL('../scripts/run-site-translation-test.cjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const callbacks: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'collect'
      && node.initializer && ts.isArrowFunction(node.initializer)) callbacks.push(node.initializer.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(callbacks.length, 1);
async function run({foreign = false, closed = false, snapshotFailure = false, navigationError}: {foreign?: boolean; closed?: boolean; snapshotFailure?: boolean; navigationError?: Error} = {}) {
  const {document, window} = parseHTML('<html><body><p id="failed">Native source<span class="fluent-read-retry-wrapper" data-fr-translation-owned="true"></span></p></body></html>');
  const originalHTML = document.body.innerHTML;
  const diagnostics: {page: DiagnosticProjection; provider: {query: DiagnosticProjection; list: DiagnosticProjection}} = {page: {status: 'unavailable', reason: 'page-not-read'}, provider: {
    query: {status: 'unavailable', reason: 'not-read'}, list: {status: 'unavailable', reason: 'not-read'},
  }};
  const events: Array<{type: string; url?: string; timeout?: number; action?: string}> = [];
  const messages: Array<{action: string}> = [];
  const runtime = {sendMessage: (message: {action: string}, reply: (response: unknown) => void) => {
    messages.push(message);
    const data = message.action === 'query'
      ? {generatedAt: Date.now(), selected: {filter: {serviceId: 'freeTranslation'}, totals: {requestCount: 1}}, routes: []}
      : {generatedAt: Date.now(), filter: {serviceId: 'freeTranslation'}, totalCount: 0, limit: 100, offset: 0, items: []};
    reply({success: true, data});
  }};
  const page = {isClosed: () => closed, url: () => 'https://fixture.invalid/article',
    goto: async (url: string, options: {timeout: number}) => {
      assert.equal(diagnostics.page.status, 'available');
      assert.equal(diagnostics.page.owned?.retryOwners, 1);
      events.push({type: 'goto', url, timeout: options.timeout});
      if (navigationError) throw navigationError;
    },
    evaluate: async (fn: (...args: unknown[]) => unknown, args?: {action: string}) => {
      if (!args) {
        events.push({type: 'source-snapshot'});
        if (snapshotFailure) throw new Error('Source snapshot unavailable');
        return fn();
      }
      events.push({type: 'evaluate', action: args.action}); return fn(args);
    },
    close: async () => {throw new Error('Borrowed failure page must only close through context');},
  };
  const other = {url: () => 'about:blank', isClosed: () => false,
    goto: async () => {throw new Error('Other owned page must remain untouched');},
    close: async () => {throw new Error('Other owned page must remain untouched');}};
  let createCalls = 0;
  const realm = {document, window, location: {origin: 'https://fixture.invalid', pathname: '/article'},
    diagnostics, expired: false, page, extensionId: 'isolated-extension', diagnosticService: 'freeTranslation',
    deadlineAt: Date.now() + 2000, attemptStartedAt: Date.now() - 10, setTimeout, clearTimeout,
    chrome: {runtime}, createPage: () => {createCalls++; throw new Error('Must not create target');},
    context: {pages: () => foreign ? [other] : [page, other]},
  };
  const collect = runInNewContext('(' + callbacks[0] + ')', realm, {timeout: 1000});
  await collect();
  assert.equal(createCalls, 0);
  assert.equal(document.body.innerHTML, originalHTML);
  return {diagnostics, events, messages};
}

it('snapshots the owned failed source before borrowing its page for the real options callback projections', async () => {
  const {diagnostics, events, messages} = await run();
  assert.equal(events[0].type, 'source-snapshot');
  assert.equal(events[1].url, 'chrome-extension://isolated-extension/options.html');
  assert(typeof events[1].timeout === 'number' && events[1].timeout > 0 && events[1].timeout <= 2000);
  assert.deepEqual(events.slice(2), [{type: 'evaluate', action: 'query'}, {type: 'evaluate', action: 'list'}]);
  assert.equal(diagnostics.page.url, 'https://fixture.invalid/article');
  assert.equal(diagnostics.page.owned?.retryOwnerSamples[0]?.id, 'failed');
  assert.equal(diagnostics.provider.query.status, 'available');
  assert.equal(diagnostics.provider.query.totals?.requestCount, 1);
  assert.equal(diagnostics.provider.list.reason, 'no-timeout-records-in-attempt-window');
  assert.deepEqual(messages.map(message => message.action), ['query', 'list']);
});

for (const option of ['foreign', 'closed', 'snapshotFailure']) {
  it(`refuses options navigation without a captured live owned source: ${option}`, async () => {
    const {diagnostics, events, messages} = await run({[option]: true});
    assert.equal(diagnostics.provider.query.reason, 'owned-failure-page-unavailable');
    assert.equal(diagnostics.provider.list.reason, 'owned-failure-page-unavailable');
    assert(events.every(event => event.type === 'source-snapshot'));
    assert.deepEqual(messages, []);
  });
}

for (const message of ['PRIVATE_ONLY_TIMEOUT', 'net::ERR_PRIVATE_ONLY', 'net::ERR_FAILED_PRIVATE_ONLY']) {
  it(`redacts unknown error symbols: ${message}`, async () => {
    const {diagnostics, events} = await run({navigationError: new Error(message)});
    assert.equal(diagnostics.provider.query.stage, 'page-navigation');
    assert.equal(diagnostics.provider.query.failureCode, 'unclassified');
    assert.equal(diagnostics.provider.list.failureCode, 'unclassified');
    assert(!JSON.stringify(diagnostics).includes('PRIVATE_ONLY'));
    assert.deepEqual(events.map(event => event.type), ['source-snapshot', 'goto']);
  });
}

it('emits only a fixed known symbol and removes accompanying private error detail', async () => {
  const {diagnostics} = await run({navigationError: new Error('net::ERR_ABORTED at https://PRIVATE_ONLY/?key=PRIVATE_ONLY')});
  assert.equal(diagnostics.provider.query.failureCode, 'net::ERR_ABORTED');
  assert.equal(diagnostics.provider.query.stage, 'page-navigation');
  assert(!JSON.stringify(diagnostics).includes('PRIVATE_ONLY'));
});

});
