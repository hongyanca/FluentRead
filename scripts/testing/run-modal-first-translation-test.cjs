#!/usr/bin/env node
'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');

/**
 * @file scripts/testing/run-modal-first-translation-test.cjs
 * 文件职责：在真实生产扩展和 focus-safe Edge 中验证全文翻译的公告优先调度。
 * 主要内容：覆盖原生 showModal、aria-modal、动态公告、普通非模态、关闭后续译、恢复重译、请求顺序、DOM 与截图证据。
 * 模块边界：页面和 provider 都是本地确定性夹具；本脚本证明浏览器调度与翻译链路，不证明真实 provider 的翻译质量。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {
  readConfig,
  installTranslationFixtureOnWorker,
  toggleFullPage,
  buildFixtureMicrosoftResponseBody,
} = require('../run-full-page-translation-test.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');

function parseArgs(argv) {
  const args = {focusSafeHelper: path.join(__dirname, 'focus-safe-browser.cjs'), background: true, timeout: 30000};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--background') continue;
    if (token === '--headed') { args.background = false; continue; }
    if (!token.startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`参数缺少值：${token}`);
    args[token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  for (const key of ['extensionDir', 'playwrightRoot', 'artifactsDir']) {
    if (!args[key]) throw new Error(`必须传入 --${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
    args[key] = path.resolve(args[key]);
  }
  if (args.background && !args.focusSafeHelper) throw new Error('后台模式必须传入 --focus-safe-helper');
  if (!args.focusSafeHelper) throw new Error('必须传入 --focus-safe-helper');
  args.focusSafeHelper = path.resolve(args.focusSafeHelper);
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout 必须为正数');
  return args;
}

function startProviderServer(delayMs = 180, own = () => {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/translate') {
      response.writeHead(404); response.end('Not found'); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let payload = [];
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* malformed provider payload is recorded as empty */ }
    requests.push({at: Date.now(), payload: Array.isArray(payload) ? payload.map(String) : []});
    await new Promise(resolve => setTimeout(resolve, delayMs));
    response.writeHead(200, {'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8'});
    response.end(buildFixtureMicrosoftResponseBody(payload));
  });
  own({server, requests});
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({server, translationUrl: `http://127.0.0.1:${address.port}/translate`, requests});
    });
  });
}

function waitForCount(page, selector, expected, timeout) {
  return page.waitForFunction(({selector, expected}) => document.querySelectorAll(selector).length === expected,
    {selector, expected}, {timeout});
}

async function assertUniqueArtifacts(page) {
  const valid = await page.evaluate(() => {
    const marker = '.fluent-read-bilingual-content';
    return [...document.querySelectorAll('p,h1,h2,section,button')].every((owner) => {
      const wrappers = owner.querySelectorAll(`:scope > ${marker}`);
      return wrappers.length <= 1 && !owner.querySelector(`${marker} ${marker}`);
    });
  });
  assert.equal(valid, true, '全文译文不得重复插入或嵌套');
}

async function waitForSelectors(page, selectors, timeout) {
  await page.waitForFunction((selectors) => selectors.every((selector) => (
    document.querySelectorAll(`${selector} .fluent-read-bilingual-content`).length === 1
  )), selectors, {timeout});
  await page.waitForFunction(() => document.querySelectorAll('.fluent-read-loading').length === 0, undefined, {timeout});
}

async function waitForProgressPhase(page, phase, timeout) {
  await page.locator(`#fluent-read-translation-status-container .fr-translation-progress[data-modal-phase="${phase}"]`)
    .waitFor({state: 'attached', timeout});
}

async function assertSelectorCounts(page, selectors, expected = 1) {
  for (const selector of selectors) assert.equal(await page.locator(`${selector} .fluent-read-bilingual-content`).count(), expected, selector);
}

async function waitForProviderRequest(requests, startIndex, timeout) {
  const deadline = Date.now() + timeout;
  while (requests.length <= startIndex && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(requests.length > startIndex, `本地 provider 在 ${timeout}ms 内没有收到全文请求`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertFreshProductionExtension(args.extensionDir, path.resolve(__dirname, '../..'));
  const helper = require(args.focusSafeHelper);
  const {chromium} = createRequire(path.join(args.playwrightRoot, 'modal-first-translation.cjs'))('playwright');
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  const report = {
    scope: 'modal-first-full-page-translation-local-fixture',
    provider: 'microsoft-local-deterministic-response',
    profileMode: 'new-temporary-profile',
    launchMode: null, focusPolicy: null, windowPlacement: null,
    cases: [], requests: [], screenshots: [], consoleErrors: [], unexpectedNetworkRequests: [], passed: false,
    evidenceLimit: '本地 mock provider 只证明扩展调度、请求顺序和浏览器 DOM 行为，不证明真实翻译服务质量。',
  };
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-modal-first-'));
  let provider, fixtureServer, fixtureUrl, session;
  let primaryError;
  let launchAttempted = false;
  try {
    provider = await startProviderServer(180, owned => { provider = owned; });
    const fixtureHtml = fs.readFileSync(path.join(__dirname, '../../tests/fixtures/modal-first-translation.html'), 'utf8');
    fixtureServer = http.createServer((request, response) => {
      if (new URL(request.url || '/', 'http://127.0.0.1').pathname !== '/modal-first-translation.html') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}); response.end(fixtureHtml);
    });
    await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(0, '127.0.0.1', resolve); });
    fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/modal-first-translation.html`;
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      headless: false, background: args.background, displayTarget: 'secondary', viewport: {width: 1280, height: 900}, timeout: args.timeout,
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    if (args.background) {
      assert.equal(report.launchMode, 'macos-background-cdp');
      assert.equal(report.focusPolicy, 'launchservices-no-foreground');
      assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
      assert.equal(report.windowPlacement.browserFrontmost, false);
    }
    const {context} = session;
    const workers = context.serviceWorkers();
    const worker = workers.find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: args.timeout});
    await installTranslationFixtureOnWorker(worker, {translationUrl: provider.translationUrl, blockedUrl: `${provider.translationUrl}/blocked`});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
        report.unexpectedNetworkRequests.push(route.request().url()); await route.abort('blockedbyclient'); return;
      }
      await route.continue();
    });
    const createPage = () => args.background ? helper.newPageWithoutForeground(context, args.timeout) : context.newPage();
    const {config} = await readConfig(context, args.timeout, {
      on: true, service: 'freeTranslation', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'viewport',
      translationScope: 'content', useCache: false, maxConcurrentTranslations: 1, translationProgressPanelEnabled: true,
      disableFloatingBall: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true,
    }, createPage);
    assert.equal(config.floatingBallHotkey, 'Alt+T');
    const page = await createPage();
    page.on('pageerror', error => report.consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(`console: ${message.text()}`); });
    await page.goto(fixtureUrl, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    const owned = '.fluent-read-bilingual-content';
    const nativeSelectors = ['#native-title', '#native-copy'];
    const bodySelectors = ['#article-title', '#body-one', '#body-two', '#body-three', '#ordinary-copy'];
    const bodyMarkers = /Modal first translation article|article explains|remaining paragraphs|intentionally separate|ordinary dialog is part/;
    const capture = async name => { const file = path.join(args.artifactsDir, `${name}.png`); await page.screenshot({path: file, fullPage: true}); report.screenshots.push(file); };
    const toggle = () => toggleFullPage(page, p => args.background ? helper.activateExtensionTabWithoutForeground(context, p, args.timeout) : Promise.resolve());
    const native = {name: 'native-showModal-priority-close-continues', requestStart: provider.requests.length};
    await toggle();
    await waitForSelectors(page, nativeSelectors, args.timeout);
    assert.equal(await page.locator(`#article ${owned}`).count(), 0, '正文不得在原生公告打开时先翻译');
    native.firstRequests = provider.requests.slice(native.requestStart);
    assert.ok(native.firstRequests.length >= 1 && native.firstRequests.every(item => item.payload.every(text => !bodyMarkers.test(text))), JSON.stringify(native.firstRequests));
    assert.ok(native.firstRequests.some(item => item.payload.some(text => text.includes('Urgent native announcement'))));
    await waitForProgressPhase(page, 'waiting', args.timeout);
    const nativeHint = page.locator('#native-announcement [data-fr-translation-modal-hint][aria-label]');
    await nativeHint.waitFor({state: 'attached', timeout: args.timeout});
    native.modalHintLabel = await nativeHint.getAttribute('aria-label');
    assert.ok(native.modalHintLabel && native.modalHintLabel.trim(), '原生 top layer 提示必须有可访问名称');
    native.modalProgress = await page.locator('#fluent-read-translation-status-container .fr-translation-progress').evaluate((node) => ({phase: node.getAttribute('data-modal-phase'), deferred: node.getAttribute('data-deferred')}));
    await capture('native-modal-first');
    await page.locator('#close-native').click();
    await waitForSelectors(page, bodySelectors, args.timeout);
    await assertUniqueArtifacts(page);
    native.bodyAfterClose = provider.requests.length;
    assert.ok(provider.requests.slice(native.requestStart).some(item => item.payload.some(text => bodyMarkers.test(text))));
    await capture('native-body-after-close');
    await page.locator('#native-announcement [data-fr-translation-modal-hint]').waitFor({state: 'detached', timeout: args.timeout});
    native.passed = true; report.cases.push(native);
    await toggle(); await waitForCount(page, owned, 0, args.timeout); native.restored = true;
    const aria = {name: 'aria-modal-priority-close-continues', requestStart: provider.requests.length};
    await page.evaluate(() => window.openAriaAnnouncement());
    await toggle();
    await waitForSelectors(page, ['#aria-title', '#aria-copy'], args.timeout);
    assert.equal(await page.locator(`#article ${owned}`).count(), 0);
    aria.firstRequests = provider.requests.slice(aria.requestStart);
    assert.ok(aria.firstRequests.some(item => item.payload.some(text => text.includes('Accessible announcement'))));
    await waitForProgressPhase(page, 'waiting', args.timeout);
    await capture('aria-modal-first');
    await page.locator('#close-aria').click();
    await waitForSelectors(page, bodySelectors, args.timeout); await assertUniqueArtifacts(page);
    aria.passed = true; report.cases.push(aria);
    await toggle(); await waitForCount(page, owned, 0, args.timeout);
    const dynamic = {name: 'dynamic-aria-modal-during-in-flight', requestStart: provider.requests.length};
    await toggle();
    await waitForProviderRequest(provider.requests, dynamic.requestStart, args.timeout);
    dynamic.beforeOpenRequestCount = provider.requests.length;
    await page.evaluate(() => window.openDynamicAnnouncement());
    await waitForSelectors(page, ['#dynamic-title', '#dynamic-copy'], args.timeout);
    dynamic.requests = provider.requests.slice(dynamic.requestStart);
    assert.ok(dynamic.requests.some(item => item.payload.some(text => text.includes('Dynamic announcement'))));
    assert.equal(await page.locator(`#article ${owned}`).count(), 0, '动态公告翻译完成前不得提交正文译文');
    assert.ok(dynamic.requests.slice(dynamic.requests.findIndex(item => item.payload.some(text => text.includes('Dynamic announcement'))) + 1)
      .every(item => item.payload.every(text => !bodyMarkers.test(text))), JSON.stringify(dynamic.requests));
    await waitForProgressPhase(page, 'waiting', args.timeout);
    await capture('dynamic-modal-during-flight');
    await page.locator('#close-dynamic').click();
    await waitForSelectors(page, bodySelectors, args.timeout);
    await assertUniqueArtifacts(page);
    dynamic.passed = true; report.cases.push(dynamic);
    await toggle(); await waitForCount(page, owned, 0, args.timeout);
    const ordinary = {name: 'ordinary-non-modal-does-not-block'};
    await toggle();
    await waitForSelectors(page, bodySelectors, args.timeout);
    await assertSelectorCounts(page, bodySelectors, 1);
    await assertUniqueArtifacts(page);
    ordinary.passed = true; report.cases.push(ordinary);
    await capture('ordinary-non-modal');
    report.requests = provider.requests;
    report.finalDom = await page.locator('main').innerHTML();
    assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
    assert.equal(report.unexpectedNetworkRequests.length, 0, JSON.stringify(report.unexpectedNetworkRequests));
    report.passed = true;
  } catch (error) {
    primaryError = error;
    report.error = error.stack || String(error);
    try {
      const failedPage = session?.context.pages().find(page => page.url().startsWith(fixtureUrl));
      if (failedPage) {
        await failedPage.screenshot({path: path.join(args.artifactsDir, 'failure.png'), fullPage: true}).catch(() => {});
        report.failureDom = await failedPage.locator('body').innerHTML().catch(() => 'unavailable');
      }
    } catch (diagnosticError) { console.error('Failure diagnostics failed:', diagnosticError); }
    throw error;
  } finally {
    report.requests = provider?.requests || [];
    const cleanupErrors = [];
    const cleanup = async (resource, release) => {
      try { await release(); } catch (error) {
        cleanupErrors.push(error);
        (report.cleanupErrors ||= []).push({resource, error: String(error.stack || error)});
        report.passed = false;
        process.exitCode = 1;
        console.error(`Cleanup failed (${resource}):`, error);
      }
    };
    let browserClosed = false;
    await cleanup('browser', async () => { if (session) { await session.close(); browserClosed = true; } });
    await cleanup('fixture server', () => new Promise((resolve, reject) => {
  if (!fixtureServer) return resolve();
  fixtureServer.close(error => { if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve(); });
}));
    await cleanup('provider server', () => new Promise((resolve, reject) => {
  if (!provider?.server) return resolve();
  provider?.server.close(error => { if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve(); });
}));
    await cleanup('profile', () => {
      if (!profileDir) return;
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
      else if (!launchAttempted) {
        try { fs.rmdirSync(profileDir); } catch (error) {
          // 未尝试启动浏览器时，仅移除初始空目录。
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup('report', () => { fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
