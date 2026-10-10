#!/usr/bin/env node
// GitHub 发布页逐行对照：临时 profile、第二屏后台、真实快捷键；fixture 与 live 证据分别报告。
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const root = path.resolve(__dirname, '../..');
const args = {focusSafeHelper: path.join(__dirname, 'focus-safe-browser.cjs')};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--live') { args.live = true; continue; }
  if (process.argv[i] === '--background') continue;
  const key = process.argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  args[key] = process.argv[++i];
}
for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) assert.ok(args[key], key);
const {chromium} = createRequire(path.join(args.playwrightRoot, 'release-test.cjs'))('playwright');
const helper = require(path.resolve(args.focusSafeHelper));
const url = 'https://github.com/mengxi-ream/read-frog/releases/tag/v1.47.0';
const owned = '.fluent-read-bilingual-content';
const report = {scope: args.live ? 'live-GitHub-release' : 'public-release-DOM-fixture',
  provider: args.live ? 'microsoft-live' : 'microsoft-deterministic-fixture', cases: [], errors: []};
fs.mkdirSync(args.artifactsDir, {recursive: true});
const save = () => fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
(async () => {
  assertFreshProductionExtension(args.extensionDir, root);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-profile-release-'));
  let session;
  let primaryError;
  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      viewport: {width: 1280, height: 900}, displayTarget: 'secondary', timeout: 30000,
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    const context = session.context;
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const installWorker = async worker => {
      if (args.live) return;
      await worker.evaluate(() => {
        globalThis.fetch = async (input, init) => {
          const requestURL = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
          if (requestURL.hostname !== 'edge.microsoft.com' || requestURL.pathname !== '/translate/translatetext') throw Error('Unexpected external fetch');
          if (globalThis.releaseFail) return new Response('', {status: 503});
          const texts = JSON.parse(init?.body ?? await input.text());
          return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `译文：${text}`}]}))),
            {status: 200, headers: {'content-type': 'application/json'}});
        };
      });
    };
    context.on('serviceworker', worker => { void installWorker(worker).catch(e => report.errors.push(e.message)); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await installWorker(worker);
    if (!args.live) {
      const html = fs.readFileSync(path.join(root, 'tests/fixtures/translation-pages/github-release-v1.47.0.html'), 'utf8');
      await context.route('**/*', route => route.request().isNavigationRequest() && route.request().url() === url
        ? route.fulfill({status: 200, contentType: 'text/html', body: html})
        : /^https?:/.test(route.request().url()) ? route.abort('blockedbyclient') : route.continue());
    }
    const popup = await helper.newPageWithoutForeground(context, 30000);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(800);
    report.config = {service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, style: 1,
      autoTranslate: false, hotkey: 'Control', floatingBallHotkey: 'Alt+T', mouseHoverTranslationDelay: 0,
      fullPageTranslationMode: 'all', useCache: false, enableAIContext: false, enableAIMultiSegment: false,
      uiLanguageSetupCompleted: true};
    const persisted = await popup.evaluate(async updates => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const c = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
        expected: Object.fromEntries(Object.keys(updates).map(k => [k, c[k]])), clientId: 'release-test', sequence: 1,
        baseRevision: c.__fluentConfigRevision});
    }, report.config);
    assert.equal(persisted.success, true);
    for (const width of args.live ? [1120] : [1120, 360]) {
      const page = await helper.newPageWithoutForeground(context, 30000);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      await page.waitForSelector('.markdown-body p');
      await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
      await page.waitForTimeout(700);
      if (!args.live) await page.locator('main').evaluate((el, width) => { el.style.width = `${width}px`; }, width);
      const before = await page.locator('.markdown-body').innerHTML();
      const baselineOverflow = await page.locator('.markdown-body').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      const source = await page.locator('.markdown-body p').evaluateAll(elements => elements.map(p => ({
        lines: Array.from(p.children).filter(e => e.localName === 'br').length + 1,
      })));
      const originalCounts = source.map(p => p.lines);
      await page.evaluate(() => {
        window.releaseNodes = [...document.querySelector('.markdown-body').querySelectorAll('*')];
        window.releaseLinks = window.releaseNodes.filter(e => e.localName === 'a').map(e => [e, e.getAttribute('href')]);
      });
      const result = {width, hoverCounts: [], expectedParagraphCounts: originalCounts}; report.cases.push(result);
      const full = async () => {
        await helper.activateExtensionTabWithoutForeground(context, page);
        await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
      };
      const hover = async () => {
        await page.locator('.markdown-body p').nth(1).scrollIntoViewIfNeeded();
        const point = await page.locator('.markdown-body p').nth(1).evaluate(p => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          const node = walker.nextNode(); const range = document.createRange();
          range.setStart(node, 0); range.setEnd(node, Math.min(8, node.length));
          const r = range.getBoundingClientRect(); return {x: r.x + 3, y: r.y + r.height / 2};
        });
        await helper.activateExtensionTabWithoutForeground(context, page);
        await page.mouse.move(point.x, point.y);
        await page.keyboard.down('Control'); await page.keyboard.up('Control');
      };
      const count = expected => page.waitForFunction(({owned, expected}) =>
        document.querySelectorAll('.markdown-body p')[1].querySelectorAll(owned).length === expected,
        {owned, expected}, {timeout: 90000});
      const validateFull = async () => {
        await page.waitForFunction(({owned, expected}) => [...document.querySelectorAll('.markdown-body p')]
          .every((p, i) => p.querySelectorAll(owned).length === expected[i]),
          {owned, expected: originalCounts}, {timeout: 120000});
        const state = await page.evaluate(owned => ({
          counts: [...document.querySelectorAll('.markdown-body p')].map(p => p.querySelectorAll(owned).length),
          nested: document.querySelectorAll(`${owned} ${owned}`).length,
          allOriginalsPresent: window.releaseNodes.every(node => node.isConnected),
          linksPreserved: window.releaseLinks.every(([node, href]) => node.getAttribute('href') === href),
          paragraphLines: [...document.querySelectorAll('.markdown-body p')][1].innerText,
          overflow: document.querySelector('.markdown-body').scrollWidth > document.querySelector('.markdown-body').clientWidth + 1,
        }), owned);
        assert.deepEqual(state.counts, originalCounts); assert.equal(state.nested, 0);
        assert.equal(state.allOriginalsPresent, true); assert.equal(state.linksPreserved, true);
        assert.match(state.paragraphLines, /[\u3400-\u9fff]/u);
        assert.equal(state.overflow, baselineOverflow, 'translation must not introduce horizontal overflow');
        assert.equal(page.url(), url);
        return state;
      };
      for (const expected of [1, 0, 1]) {
        await hover(); await count(expected); result.hoverCounts.push(expected);
        assert.equal(await page.locator('.markdown-body p').nth(2).locator(owned).count(), 0);
      }
      await hover(); await count(0);
      assert.equal(await page.locator('.markdown-body').innerHTML(), before);
      await full(); result.first = await validateFull();
      await page.locator('.markdown-body p').first().evaluate(p => p.scrollIntoView({block: 'start'}));
      await page.screenshot({path: path.join(args.artifactsDir, `${width}-translated.png`)});
      await page.locator('.markdown-body p').nth(1).screenshot({path: path.join(args.artifactsDir, `${width}-paragraph.png`)});
      await full();
      await page.waitForFunction(owned => !document.querySelector(`.markdown-body ${owned}`), owned);
      assert.equal(await page.locator('.markdown-body').innerHTML(), before);
      result.exactRestore = true;
      await full(); result.second = await validateFull();
      if (!args.live && width === 1120) {
        await page.locator('.markdown-body').evaluate(body => {
          const p = document.createElement('p'); p.id = 'dynamic-release-line';
          p.innerHTML = 'A newly loaded release line.<br>Another newly loaded line.'; body.appendChild(p);
        });
        await page.waitForFunction(owned => document.querySelector('#dynamic-release-line').querySelectorAll(owned).length === 2, owned);
        result.dynamicCounts = 2;
        await page.locator('#dynamic-release-line').evaluate(p => p.remove());
      }
      await full(); await page.waitForFunction(owned => !document.querySelector(`.markdown-body ${owned}`), owned);
      assert.equal(await page.locator('.markdown-body').innerHTML(), before);
      if (!args.live && width === 1120) {
        await worker.evaluate(() => { globalThis.releaseFail = true; });
        await hover();
        await page.locator('.markdown-body p').nth(1).locator('.fluent-read-retry').waitFor({state: 'visible'});
        await worker.evaluate(() => { globalThis.releaseFail = false; });
        await page.locator('.markdown-body p').nth(1).locator('.fluent-read-retry').click(); await count(1);
        result.retryRecovered = true;
        await hover(); await count(0);
        assert.equal(await page.locator('.markdown-body').innerHTML(), before);
      }
      await page.close(); save();
    }
    report.passed = true;
  } catch (error) { primaryError = error; report.failure = error.stack; throw error; }
  finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {
      if (session) {await session.close(); browserClosed = true;}
    });
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
    await cleanup(() => {save();});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
