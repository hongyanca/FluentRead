#!/usr/bin/env node
'use strict';
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
// PR #640：真实快捷键与指针验证链接提示漂移、语义属性恢复及源骨架重放。
// 只启动临时后台 Edge；翻译响应固定，--live-wikipedia 才访问真实维基页面。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const argument = name => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1];};
const owned = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';

async function main() {
  const extensionDir = path.resolve(argument('extension-dir') || '.output/chrome-mv3');
  const artifactsDir = path.resolve(argument('artifacts-dir') || '/private/tmp/fluentread-attribute-drift');
  const packages = argument('playwright-root');
  const helperPath = (process.argv.includes('--focus-safe-helper') ? argument('focus-safe-helper') : path.join(__dirname, 'focus-safe-browser.cjs'));
  assert(packages && helperPath, 'Pass --playwright-root and --focus-safe-helper');
  const {chromium} = require(path.join(packages, 'playwright'));
  const helper = require(helperPath);
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-attribute-edge-'));
  const report = {ok: false, checks: [], errors: [], screenshots: [], profileMode: 'new-temporary-profile',
    evidenceBoundary: 'Production extension, deterministic Microsoft responses; no live provider quality or Firefox runtime claim.'};
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title translate="no">Attribute drift fixture</title>
      <style>body{padding:70px;font:22px/1.8 system-ui}p{max-width:760px;margin:35px 0}a{color:#305db8}.hidden{display:none}</style></head>
      <body><main><h1 translate="no">Link preview compatibility</h1>
      <p id="primary"><a href="/reference" title="Reference article">Read the detailed reference article.</a></p>
      <p id="neighbor">This neighboring paragraph should only translate in full page mode.</p></main>
      <script>const titles=new WeakMap();document.addEventListener('pointerover', event => {const link=event.target.closest('a'); if(link){titles.set(link,link.title);link.removeAttribute('title');}});
      document.addEventListener('pointerout', event => {const link=event.target.closest('a'); if(link){link.title=titles.get(link)||'Reference article';titles.delete(link);}});</script>
      </body></html>`);
  });
  let launched;
  let page;
  let primaryError;
  let launchAttempted = false;
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const url = `http://127.0.0.1:${server.address().port}`;
    launchAttempted = true;
    launched = await helper.launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1280, height: 900},
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context;
    const requests = [];
    const installed = new WeakMap();
    const installWorker = worker => {
      if (!installed.has(worker)) installed.set(worker, (async () => {
        await worker.evaluate(() => {
          globalThis.__attributeRequests = [];
          globalThis.fetch = async (input, init) => {
            const target = new URL(String(input?.url || input));
            if (target.hostname !== 'edge.microsoft.com' || target.pathname !== '/translate/translatetext') throw Error('External provider disabled');
            const texts = JSON.parse(init?.body ?? await input.text());
            globalThis.__attributeRequests.push(...texts);
            return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))),
              {headers: {'content-type': 'application/json'}});
          };
        });
        requests.push(worker);
      })());
      return installed.get(worker);
    };
    context.on('serviceworker', worker => {void installWorker(worker).catch(error => report.errors.push(error.message));});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await installWorker(worker);
    const requestTexts = async () => (await Promise.all(requests.map(w => w.evaluate(() => globalThis.__attributeRequests)))).flat();
    const requestCount = async () => (await requestTexts()).length;
    const popup = await helper.newPageWithoutForeground(context);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await waitForAsyncCondition(() => popup.evaluate(async () => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const c = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return !!c?.service;
    }), {timeoutMs: 30000, message: "双语属性漂移测试服务配置尚未就绪"});
    const configured = await popup.evaluate(async () => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const c = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      const patch = {on: true, service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, style: 1,
        hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'all', useCache: false,
        autoTranslate: false, mouseHoverTranslationDelay: 0, enableAIContext: false, enableAIMultiSegment: false,
        uiLanguageSetupCompleted: true, bilingualSentenceHighlightEnabled: false, animations: false};
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
        expected: Object.fromEntries(Object.keys(patch).map(key => [key, c[key]])),
        clientId: 'attribute-drift-test', sequence: 1, baseRevision: c.__fluentConfigRevision});
    });
    assert.equal(configured.success, true, configured.error);
    const newPage = async address => {
      const p = await helper.newPageWithoutForeground(context);
      p.on('pageerror', error => report.errors.push(error.message));
      await p.goto(address, {waitUntil: 'domcontentloaded', timeout: 45000});
      await p.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
      await helper.activateExtensionTabWithoutForeground(context, p);
      return p;
    };
    const shot = async name => {const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file);};
    const hoverRounds = async (selector, hoverDelay = 220, allowPreviewRequests = false) => {
      const count = await requestCount();
      const target = page.locator(selector).first();
      const titles = [];
      let previewObserved = false;
      const originalSlots = await target.evaluate(link => {
        const wrapper = link.closest('.fluent-read-bilingual-content');
        const walker = document.createTreeWalker(wrapper.parentElement, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!wrapper.contains(node) && node.textContent.trim().length >= 20) texts.push(node.textContent.trim());
        }
        return texts;
      });
      assert(originalSlots.length > 0, 'Track provider source slots from the original paragraph');
      await target.evaluate(link => {
        window.__retainedLink = link; window.__retainedWrapper = link.closest('.fluent-read-bilingual-content');
        window.__missingFrames = 0; window.__sampleHover = true;
        const sample = () => {if (!window.__sampleHover) return; if (!window.__retainedWrapper.isConnected) window.__missingFrames++; requestAnimationFrame(sample);}; sample();
      });
      for (let i = 0; i < 6; i++) {
        const before = await target.getAttribute('title');
        await target.hover(); await page.waitForTimeout(hoverDelay);
        const during = await target.getAttribute('title');
        previewObserved ||= await page.locator('.mwe-popups:visible').count() > 0;
        await page.mouse.move(10, 10); await page.waitForTimeout(150);
        titles.push({before, during, after: await target.getAttribute('title')});
      }
      const state = await page.evaluate(() => {
        window.__sampleHover = false;
        return {sameLink: window.__retainedLink.isConnected, sameWrapper: window.__retainedWrapper.isConnected,
          missingFrames: window.__missingFrames, text: window.__retainedWrapper.textContent};
      });
      assert(state.sameLink && state.sameWrapper); assert.equal(state.missingFrames, 0);
      assert.match(state.text, /测试译文/u);
      const newRequests = (await requestTexts()).slice(count);
      // 真实 Page Previews 插入的新卡片本来就需要全文翻译；只禁止原段落被再次请求。
      const repeatedSourceRequests = newRequests.filter(text => originalSlots.some(source => text.includes(source)));
      report.hoverRequestDeltas ??= [];
      report.hoverRequestDeltas.push({selector, originalSlots, newRequests, repeatedSourceRequests});
      assert.equal(repeatedSourceRequests.length, 0);
      if (!allowPreviewRequests) assert.equal(newRequests.length, 0);
      assert(titles.some(t => t.before !== t.during || t.during !== t.after), 'Hover must actually change link title');
      return {...state, titles, previewObserved, extraRequests: newRequests.length, repeatedSourceRequests: 0};
    };

    for (const mode of ['hover', 'full']) {
      page = await newPage(url);
      const result = {mode, toggleCounts: []};
      const toggle = async () => {
        await page.mouse.move(10, 10);
        if (mode === 'hover') {await page.locator('#primary').hover(); await page.keyboard.press('Control');}
        else await page.keyboard.press('Alt+t');
      };
      await toggle(); await page.locator(`#primary ${owned}`).waitFor({state: 'attached'});
      result.toggleCounts.push(await page.locator(`#primary ${owned}`).count());
      if (mode === 'hover') assert.equal(await page.locator(`#neighbor ${owned}`).count(), 0);
      await page.mouse.move(10, 10); await page.waitForTimeout(200);
      result.hover = await hoverRounds(`#primary ${owned} a`);
      const beforeReplay = await requestCount();
      await page.locator('#primary > a').evaluate(link => {window.__sourceLink = link; link.href = '/updated-reference'; link.title = 'Updated reference';});
      await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('href')?.endsWith('/updated-reference'), `#primary ${owned} a`);
      assert.equal(await requestCount(), beforeReplay);
      result.sourceReplay = await page.evaluate(() => ({sameWrapper: window.__retainedWrapper.isConnected,
        sameSource: window.__sourceLink === document.querySelector('#primary > a')}));
      assert(result.sourceReplay.sameWrapper && result.sourceReplay.sameSource);
      const beforeTamper = await requestCount();
      await page.locator(`#primary ${owned} a`).evaluate(link => link.setAttribute('href', '/unrelated'));
      await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('href')?.endsWith('/updated-reference'), `#primary ${owned} a`);
      await page.locator(`#primary ${owned} a`).evaluate(link => link.style.display = 'none');
      await page.waitForFunction(selector => {const link = document.querySelector(selector); return link && getComputedStyle(link).display !== 'none';}, `#primary ${owned} a`);
      assert.equal(await requestCount(), beforeTamper);
      result.semanticRepairs = {linkRestored: true, visibilityRestored: true, extraRequests: 0};
      await shot(`${mode}-stable`);
      for (const expected of [0, 1]) {
        await toggle();
        await page.waitForFunction(({selector, expected}) => document.querySelectorAll(selector).length === expected, {selector: `#primary ${owned}`, expected});
        result.toggleCounts.push(await page.locator(`#primary ${owned}`).count());
      }
      assert.deepEqual(result.toggleCounts, [1, 0, 1]); assert.equal(page.url(), `${url}/`);
      report.checks.push(result); await page.close();
    }

    if (process.argv.includes('--live-wikipedia')) {
      page = await newPage('https://en.wikipedia.org/wiki/Menches');
      await page.keyboard.press('Alt+t');
      const selector = `#mw-content-text p ${owned} a[href*="Kerkeosiris"]`;
      await page.locator(selector).first().waitFor({state: 'visible', timeout: 30000});
      // 全页翻译完成后才比较悬停请求数，排除尚在执行的正常翻译。
      await page.waitForFunction(() => !document.querySelector('.fluent-read-loading, .fluent-read-retry-wrapper'));
      await page.waitForTimeout(1000);
      report.wikipedia = await hoverRounds(selector, 1200, true);
      assert(report.wikipedia.previewObserved, 'Wikipedia Page Preview must actually open');
      await page.locator(selector).first().hover(); await page.waitForTimeout(1200);
      await shot('wikipedia-hover');
      await page.mouse.move(10, 10);
      await page.keyboard.press('Alt+t');
      await page.waitForFunction(() => !document.querySelector('.fluent-read-bilingual-content'));
      report.wikipedia.restored = true;
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {
    primaryError = error;
    report.error = error.stack || String(error);
    if (page && !page.isClosed()) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {
      if (launched) {await launched.close(); browserClosed = true;}
    });
    await cleanup(async () => {if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
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
      report.ok = false;
      report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
    }
    await cleanup(() => {fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
