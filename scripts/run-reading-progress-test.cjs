#!/usr/bin/env node
'use strict';
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');

// 按阅读进度的真实 Edge 回归：本地长文 fixture + 确定性微软 worker provider。
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {startTranslationFixtureServer} = require('./run-full-page-translation-test.cjs');

function argsOf(argv) {
  const out = {focusSafeHelper: path.join(__dirname, 'testing/focus-safe-browser.cjs'), timeout: 90000, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--background') continue;
    if (token === '--headed') throw new Error('本回归只允许 --background，避免抢占用户前台');
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    out[token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
    if (!out[key]) throw new Error(`缺少 --${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
    out[key] = path.resolve(out[key]);
  }
  out.timeout = Number(out.timeout);
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) throw new Error('--timeout 必须为正数');
  return out;
}

function fixtureHtml() {
  const paragraphs = Array.from({length: 10}, (_, i) => {
    const text = Array.from({length: 10}, (_, j) => `Paragraph ${i} sentence ${j}: reading progress must keep work close to the visible viewport while preserving complete source paragraphs.`).join(' ');
    return `<p id="reading-paragraph-${i}" data-reading-index="${i}">${text}</p>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Reading progress fixture</title><style>body{margin:0;font:16px/1.55 sans-serif}main{width:720px;margin:24px auto}p{margin:0 0 42px;min-height:610px;padding:18px;border:1px solid #ccd3dc}</style><main><h1>Reading progress fixture</h1>${paragraphs}</main>`;
}

async function serverFor(html) {
  const server = http.createServer((req, res) => {
    if (new URL(req.url || '/', 'http://127.0.0.1').pathname !== '/reading-progress.html') {res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}); res.end(html);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {url: `http://127.0.0.1:${server.address().port}/reading-progress.html`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))};
}

async function installProvider(worker, translationUrl, blockedUrl) {
  await worker.evaluate(({translationUrl, blockedUrl}) => {
    if (globalThis.__readingProgressFixture) return;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (url.hostname === 'edge.microsoft.com' && url.pathname === '/translate/translatetext') {
        return nativeFetch(input instanceof Request ? new Request(translationUrl, input) : translationUrl, init);
      }
      if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return nativeFetch(`${blockedUrl}?url=${encodeURIComponent(url.href)}`);
      return nativeFetch(input, init);
    };
    globalThis.__readingProgressFixture = true;
  }, {translationUrl, blockedUrl});
}

async function config(popup, updates) {
  return popup.evaluate(async updates => {
    const send = message => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(response)));
    const stored = await send({type: 'configStorageRead', key: 'local:config'});
    const current = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    const revision = current.__fluentConfigRevision;
    for (const key of Object.keys(current)) if (key.startsWith('__fluentConfig')) delete current[key];
    Object.assign(current, {on: true, display: 1, service: 'freeTranslation', uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, floatingBallHotkey: 'Alt+T', freeTranslationOrder: ['microsoft'], mouseHoverTranslationDelay: 0, bilingualSentenceHighlightEnabled: true, useCache: false, maxConcurrentTranslations: 1}, updates);
    const result = await send({type: 'persistConfig', config: current, clientId: `reading-progress-${Date.now()}`, sequence: 1, baseRevision: revision});
    if (!result?.success) throw new Error(result?.error || '配置保存失败');
    return current;
  }, updates);
}

async function toggle(page, helper, context) {
  await helper.activateExtensionTabWithoutForeground(context, page, 20000);
  await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
}

async function snapshot(page) {
  return page.evaluate(() => ({
    visible: [...document.querySelectorAll('[data-reading-index]')].filter(node => {const r = node.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;}).map(node => Number(node.dataset.readingIndex)),
    translated: [...document.querySelectorAll('[data-reading-index]')].filter(node => node.querySelector('.fluent-read-bilingual-content')).map(node => Number(node.dataset.readingIndex)),
    wrappers: document.querySelectorAll('.fluent-read-bilingual-content').length,
    scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, viewport: innerHeight,
    chars: [...document.querySelectorAll('[data-reading-index]')].filter(node => node.querySelector('.fluent-read-bilingual-content')).reduce((n, node) => n + (node.firstChild?.textContent?.length || 0), 0),
  }));
}

async function waitFor(page, predicate, timeout) { await page.waitForFunction(predicate, undefined, {timeout}); }

function payloadParagraphs(provider, from = 0) {
  return [...new Set(provider.requestPayloads().slice(from).flatMap(payload => payload.flatMap(text => {
    const matches = [...String(text).matchAll(/Paragraph (\d+)/g)];
    return matches.map(match => Number(match[1]));
  })))]
}

async function waitForProviderIdle(page, provider, timeout, quietMs = 900) {
  const deadline = Date.now() + timeout;
  let count = provider.requestCount();
  let stableAt = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const next = provider.requestCount();
    if (next !== count) {count = next; stableAt = Date.now();}
    if (Date.now() - stableAt >= quietMs) return count;
  }
  throw new Error(`等待 provider 请求稳定超时：${count}`);
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!fs.existsSync(path.join(args.extensionDir, 'manifest.json'))) throw new Error('插件 manifest.json 不存在');
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  const {chromium} = createRequire(path.join(args.playwrightRoot, '__reading_progress_loader.cjs'))('playwright');
  const helper = require(args.focusSafeHelper);
  for (const method of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) if (typeof helper[method] !== 'function') throw new Error(`helper 缺少 ${method}`);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-reading-progress-'));
  const unexpectedNetwork = [], workerErrors = [], runtimeErrors = [];
  let pageServer, provider;
  let primaryError;
  let session, context, page;
  const report = {evidenceType: 'production-extension-equivalent-fixture', liveSite: false, fixtureChars: fixtureHtml().length, launchMode: null, focusPolicy: null, windowPlacement: null, scenarios: {}, requests: [], screenshots: []};
  let launchAttempted = false;
  try {
    pageServer = await serverFor(fixtureHtml());
    // 延迟足够长，使快速划过期间有真实请求处于 pending，才能观察撤队结果。
    provider = await startTranslationFixtureServer(unexpectedNetwork, 300);
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: args.browserPath, headless: false, background: true, viewport: {width: 1280, height: 900}, timeout: args.timeout, browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    ({context} = session); report.launchMode = session.launchMode; report.focusPolicy = session.focusPolicy; report.windowPlacement = session.windowPlacement;
    const install = worker => installProvider(worker, provider.translationUrl, provider.blockedUrl).catch(error => workerErrors.push(error.message));
    context.on('serviceworker', install);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000}); await installProvider(worker, provider.translationUrl, provider.blockedUrl);
    await context.route('**/*', async route => {const u = new URL(route.request().url()); if (/^https?:$/.test(u.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) {unexpectedNetwork.push(u.href); await route.abort('blockedbyclient');} else await route.continue();});
    const popup = await helper.newPageWithoutForeground(context, args.timeout); const extensionId = new URL(worker.url()).hostname;
    await popup.goto(`chrome-extension://${extensionId}/popup.html`); await config(popup, {fullPageTranslationMode: 'viewport', eagerTranslationCharacters: 0});
    page = await helper.newPageWithoutForeground(context, args.timeout); page.on('pageerror', e => runtimeErrors.push(`pageerror: ${e.message}`)); page.on('console', m => {if (m.type() === 'error') runtimeErrors.push(`console: ${m.text()}`);});
    const record = response => {if (/translate|translatetext/i.test(response.url())) report.requests.push({time: Date.now(), url: response.url(), status: response.status()});}; context.on('response', record); page.on('response', record);
    await page.goto(pageServer.url, {waitUntil: 'domcontentloaded'}); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    // 4999 是显式自定义预算回归；默认值 0 在后续 eager=0 场景中验证。
    await config(popup, {fullPageTranslationMode: 'viewport', eagerTranslationCharacters: 4999}); await page.reload({waitUntil: 'domcontentloaded'}); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    const baseline = await snapshot(page); await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('.fluent-read-bilingual-content').length > 0, args.timeout); await waitForProviderIdle(page, provider, args.timeout);
    const requestCountAfterViewportIdle = provider.requestCount(); await page.waitForTimeout(900); if (provider.requestCount() !== requestCountAfterViewportIdle) throw new Error('4999 预算检查期间仍持续补译，未形成稳定边界');
    const viewportTranslated = await snapshot(page); if (viewportTranslated.translated.length === 0 || viewportTranslated.translated.at(-1) >= 8 || viewportTranslated.chars > 7000) throw new Error(`4999 预算或首屏边界失败：${JSON.stringify(viewportTranslated)}`);
    await page.screenshot({path: path.join(args.artifactsDir, 'reading-progress-viewport.png')}); report.screenshots.push(path.join(args.artifactsDir, 'reading-progress-viewport.png')); report.scenarios.viewport = {baseline, afterTranslate: viewportTranslated, expectedBudget: 4999, bottomUntouched: true};
    await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('.fluent-read-bilingual-content').length === 0, args.timeout); const restored = await snapshot(page);
    await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('[data-reading-index] .fluent-read-bilingual-content').length > 0, args.timeout); report.scenarios.restoreRetranslate = {restored, retranslated: await snapshot(page)};
    await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('.fluent-read-bilingual-content').length === 0, args.timeout);
    await config(popup, {fullPageTranslationMode: 'viewport', eagerTranslationCharacters: 0}); await page.reload({waitUntil: 'domcontentloaded'}); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    const beforeScrollRequests = provider.requestCount(); const eagerZeroStartPayloadBaseline = provider.requestPayloads().length; await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('[data-reading-index] .fluent-read-bilingual-content').length > 0, args.timeout); await waitForProviderIdle(page, provider, args.timeout, 600); const eagerZeroInitial = await snapshot(page); const eagerZeroPayloadBaseline = provider.requestPayloads().length; const initialPayloadParagraphs = payloadParagraphs(provider, eagerZeroStartPayloadBaseline);
    const scrollTargets = [2, 4, 6, 8];
    for (const index of scrollTargets) {
      await page.locator(`#reading-paragraph-${index}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
    }
    const fastPass = await snapshot(page); const fastPayloadParagraphs = payloadParagraphs(provider, eagerZeroPayloadBaseline);
    await page.waitForTimeout(220); const settled = await snapshot(page); await waitForProviderIdle(page, provider, args.timeout, 600); const settledStable = await snapshot(page); const settledPayloadParagraphs = payloadParagraphs(provider, eagerZeroPayloadBaseline);
    const skipped = scrollTargets.slice(0, -1).filter(index => !settledPayloadParagraphs.includes(index));
    if (skipped.length === 0) throw new Error(`快速划过段落仍全部进入 provider 请求：${JSON.stringify({scrollTargets, settledPayloadParagraphs})}`);
    const newPayloadParagraphs = settledPayloadParagraphs.filter(index => !initialPayloadParagraphs.includes(index));
    if (newPayloadParagraphs.length === 0 || !settledStable.visible.includes(newPayloadParagraphs[0])) throw new Error(`停顿后首个新请求没有优先命中当前可见段落：${JSON.stringify({settledStable, initialPayloadParagraphs, settledPayloadParagraphs, newPayloadParagraphs})}`);
    const reverseIndex = skipped[0]; await page.locator(`#reading-paragraph-${reverseIndex}`).scrollIntoViewIfNeeded(); await page.waitForTimeout(260); await waitForProviderIdle(page, provider, args.timeout, 500); const reverse = await snapshot(page); const reversePayloadParagraphs = payloadParagraphs(provider, eagerZeroPayloadBaseline);
    if (!reverse.translated.includes(reverseIndex) && !reversePayloadParagraphs.includes(reverseIndex)) throw new Error(`反向重入可见段落未恢复处理：${JSON.stringify({reverseIndex, reverse, reversePayloadParagraphs})}`);
    await page.screenshot({path: path.join(args.artifactsDir, 'reading-progress-scrolled.png')}); report.screenshots.push(path.join(args.artifactsDir, 'reading-progress-scrolled.png'));
    report.scenarios.eagerZero = {defaultValue: 0, initial: eagerZeroInitial, initialPayloadParagraphs, fastPass, fastPayloadParagraphs, after220ms: settled, afterProviderStable: settledStable, settledPayloadParagraphs, newPayloadParagraphs, reverse, reversePayloadParagraphs, skipped, requestCountBefore: beforeScrollRequests, requestCountAfter: provider.requestCount(), visiblePriorityWindowMs: 220, scrollIntervalMs: 80, useCache: false, maxConcurrentTranslations: 1};
    await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('.fluent-read-bilingual-content').length === 0, args.timeout);
    await config(popup, {fullPageTranslationMode: 'all', eagerTranslationCharacters: 0}); await page.reload({waitUntil: 'domcontentloaded'}); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout}); await toggle(page, helper, context); await waitFor(page, () => document.querySelectorAll('[data-reading-index] .fluent-read-bilingual-content').length === 10, args.timeout); const all = await snapshot(page); if (all.translated.length !== 10) throw new Error(`all 模式未译完：${JSON.stringify(all)}`); await page.screenshot({path: path.join(args.artifactsDir, 'reading-progress-all.png')}); report.screenshots.push(path.join(args.artifactsDir, 'reading-progress-all.png')); report.scenarios.all = all;
    report.requests = report.requests.slice(-100); report.workerErrors = workerErrors; report.unexpectedNetwork = unexpectedNetwork; report.runtimeErrors = runtimeErrors;
    if (workerErrors.length || unexpectedNetwork.length || runtimeErrors.length) throw new Error(`浏览器回归存在错误：${JSON.stringify({workerErrors, unexpectedNetwork, runtimeErrors})}`);
    report.passed = true;
  } catch (error) {
    primaryError = error;
    report.passed = false; report.error = error.stack || error.message; report.workerErrors = workerErrors; report.unexpectedNetwork = unexpectedNetwork; report.runtimeErrors = runtimeErrors;
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {
      if (session) {await session.close(); browserClosed = true;}
    });
    await cleanup(async () => {await pageServer?.close();});
    await cleanup(async () => {await provider?.close();});
    await cleanup(() => {
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        // No browser launch was attempted; only remove an empty initial profile.
        try {fs.rmdirSync(profileDir);} catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    if (cleanupErrors.length) {
      report.passed = false;
      report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
    }
    await cleanup(() => {fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  process.stdout.write(`${JSON.stringify({passed: report.passed, artifactsDir: args.artifactsDir, launchMode: report.launchMode, focusPolicy: report.focusPolicy, windowPlacement: report.windowPlacement}, null, 2)}\n`);
}

main().catch(error => {process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;});
