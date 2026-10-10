#!/usr/bin/env node
/**
 * Live Hacker News / Product Hunt scroll regression. Production extension and real shortcuts,
 * fixed Microsoft responses, original website HTML/CSS, temporary focus-safe Edge profile.
 * Measures every frame: endpoint-only scroll checks would miss a jump followed by restoration.
 */
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {assertFreshProductionExtension, waitForTranslationIdle} = require('../run-site-translation-test.cjs');
const siteCases = require('../../tests/browser-translation-cases.json');
const root = path.resolve(__dirname, '../..');
const args = {focusSafeHelper: path.join(__dirname, 'focus-safe-browser.cjs')};
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--allow-network') { args.allowNetwork = true; continue; }
  if (flag === '--expect-regression') { args.expectRegression = true; continue; }
  assert.ok(flag.startsWith('--') && process.argv[i + 1], `Invalid argument ${flag}`);
  args[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = process.argv[++i];
}
assert.ok(args.allowNetwork, 'Live pages require --allow-network');
for (const name of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
  assert.ok(args[name], `Missing --${name}`); args[name] = path.resolve(args[name]);
}
const helper = require(args.focusSafeHelper);
const {chromium} = createRequire(path.join(args.playwrightRoot, 'viewport-test.cjs'))('playwright');
const owned = '.fluent-read-bilingual-content';
const specs = [
  {id: 'hacker-news-home', selector: '.titleline > a', readingSelector: '.titleline > a', mid: 250, index: y => y ? 9 : 2},
  {id: 'producthunt-posting-access', selector: 'article p', readingSelector: 'h1, article p', mid: 180, index: () => 2},
];
if (args.case) assert.ok(specs.some(s => s.id === args.case), `Unknown case ${args.case}`);
const report = {scope: 'live-websites', provider: 'deterministic-microsoft-response-200ms',
  profileMode: 'new-temporary-profile', baseline: !!args.expectRegression, cases: [], errors: []};
fs.mkdirSync(args.artifactsDir, {recursive: true});
const save = () => fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));

async function main() {
  if (!args.expectRegression) assertFreshProductionExtension(args.extensionDir, root);
  report.contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extensionDir, 'content-scripts/content.js'))).digest('hex');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-viewport-'));
  let session, page, primaryError;
  const cdpSessions = new Set();
  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: args.browserPath || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    const context = session.context;
    report.browserVersion = context.browser().version();
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const installed = new WeakMap();
    const installWorker = worker => {
      if (!installed.has(worker)) installed.set(worker, worker.evaluate(() => {
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input?.url || input));
          if (url.hostname !== 'edge.microsoft.com' || url.pathname !== '/translate/translatetext') throw Error('External provider disabled');
          const texts = JSON.parse(init?.body ?? await input.text());
          await new Promise(resolve => setTimeout(resolve, 200));
          return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))),
            {headers: {'content-type': 'application/json'}});
        };
      }));
      return installed.get(worker);
    };
    context.on('serviceworker', worker => { void installWorker(worker).catch(e => report.errors.push(e.message)); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await installWorker(worker);
    const popup = await helper.newPageWithoutForeground(context);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(600);
    const config = await popup.evaluate(async () => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const c = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      const updates = {
        on: true, service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, style: 1,
        hotkey: 'Control', floatingBallHotkey: 'Alt+T', mouseHoverTranslationDelay: 0,
        fullPageTranslationMode: 'all', useCache: false, autoTranslate: false,
        enableAIContext: false, enableAIMultiSegment: false, uiLanguageSetupCompleted: true,
      };
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
        expected: Object.fromEntries(Object.keys(updates).map(key => [key, c[key]])),
        clientId: 'viewport-test', sequence: 1, baseRevision: c.__fluentConfigRevision});
    });
    assert.equal(config.success, true, JSON.stringify(config));
    for (const spec of specs.filter(s => !args.case || s.id === args.case)) {
      for (const mode of ['hover', 'full']) for (const startY of [0, spec.mid]) {
        const site = siteCases[spec.id];
        const result = {site: spec.id, url: site.url, mode, startY, phases: []}; report.cases.push(result);
        page = await helper.newPageWithoutForeground(context);
        let stage = 'loading';
        result.pageDiagnostics = [];
        page.on('pageerror', e => {
          const diagnostic = {stage, message: e.message, stack: e.stack};
          result.pageDiagnostics.push(diagnostic);
          if (stage !== 'loading') report.errors.push({site: spec.id, ...diagnostic});
        });
        const cdp = await context.newCDPSession(page), worlds = [];
        cdpSessions.add(cdp);
        cdp.on('Runtime.executionContextCreated', e => worlds.push(e.context));
        await cdp.send('Runtime.enable');
        // No routing / page fixture: public website markup and assets are fetched unchanged.
        const response = await page.goto(site.url, {waitUntil: 'domcontentloaded', timeout: 45000});
        assert.equal(response.status(), 200);
        await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
        await page.waitForLoadState('load');
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(800);
        await helper.activateExtensionTabWithoutForeground(context, page);
        for (const world of worlds) await cdp.send('Runtime.evaluate', {contextId: world.id, expression: `
          globalThis.__frViewportCalls = [];
          { const original = window.scrollBy; window.scrollBy = function(...args) {
            const before = scrollY, result = original.apply(this, args);
            __frViewportCalls.push({args, before, after: scrollY, stack: new Error().stack}); return result;
          }; }`}).catch(() => {});
        await page.evaluate(y => scrollTo(0, y), startY); await page.waitForTimeout(400);
        const target = page.locator(spec.selector).nth(spec.index(startY));
        const originalText = await target.textContent();
        const sourceLinks = () => target.locator('a').evaluateAll(nodes => nodes
          .filter(n => !n.closest('.fluent-read-bilingual-content')).map(n => n.getAttribute('href')));
        const linksBefore = await sourceLinks();
        const targetHref = await target.getAttribute('href');
        const press = async () => {
          if (mode === 'hover') {
            const box = await target.boundingBox(); assert.ok(box && box.y >= 0 && box.y < 890, 'Hover target must be visible without auto-scroll');
            await page.mouse.move(box.x + 10, box.y + 5); await page.keyboard.press('Control');
          } else await page.keyboard.press('Alt+t');
        };
        for (const phase of args.expectRegression ? ['translate'] : ['translate', 'restore', 'retranslate']) {
          stage = phase;
          await page.evaluate(({selector, readingSelector, index}) => {
            const target = document.querySelectorAll(selector)[index];
            const reading = [...document.querySelectorAll(readingSelector)].find(el => {
              const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.height > 0;
            });
            const textTop = element => {
              if (!element) return null;
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let text;
              while ((text = walker.nextNode())) if (text.textContent.trim() && !text.parentElement.closest('.fluent-read-bilingual-content')) {
                const range = document.createRange(); range.selectNodeContents(text); return range.getBoundingClientRect().top;
              }
              return null;
            };
            window.__frViewportFrames = []; window.__frViewportStop = false;
            const frame = () => {
              __frViewportFrames.push({time: performance.now(), scrollY, targetTop: textTop(target), readingTop: textTop(reading),
                wrappers: document.querySelectorAll('.fluent-read-bilingual-content').length});
              if (!__frViewportStop) requestAnimationFrame(frame);
            };
            frame();
          }, {selector: spec.selector, readingSelector: spec.readingSelector, index: spec.index(startY)});
          await press();
          if (phase === 'restore') await page.waitForFunction(selector => !document.querySelector(selector), owned);
          else await page.waitForFunction(({selector, index, owned}) => document.querySelectorAll(selector)[index]?.querySelector(owned),
            {selector: spec.selector, index: spec.index(startY), owned});
          await waitForTranslationIdle(page, 10000, `${spec.id}-${mode}-${phase}`, 10000);
          await page.waitForTimeout(500);
          const frames = await page.evaluate(() => { window.__frViewportStop = true; return window.__frViewportFrames; });
          assert.ok(frames.length > 1 && frames.every(frame => Number.isFinite(frame.readingTop) && Number.isFinite(frame.targetTop)),
            'Both original text anchors must remain measurable throughout the gesture');
          const item = {phase, frames, minY: Math.min(...frames.map(f => f.scrollY)), maxY: Math.max(...frames.map(f => f.scrollY)),
            targetDrift: frames.at(-1).targetTop - frames[0].targetTop,
            readingDrift: frames.at(-1).readingTop - frames[0].readingTop,
            maxReadingDrift: Math.max(...frames.map(f => Math.abs(f.readingTop - frames[0].readingTop)))};
          result.phases.push(item); save();
          // Full-page expansion above a scrolled reader can legitimately change scrollY through native anchoring.
          // Do not confuse that with a visible paragraph / page-top scroll regression.
          if (!args.expectRegression && (mode === 'hover' || startY === 0)) {
            assert.ok(item.maxY - item.minY <= 1, `Unexpected viewport jump: ${spec.id}/${mode}/${phase} ${item.maxY - item.minY}px`);
            if (mode === 'hover') assert.ok(Math.abs(item.targetDrift) <= 2, `Original text moved ${item.targetDrift}px`);
          }
          if (!args.expectRegression) assert.ok(item.maxReadingDrift <= 2, `Reading anchor moved ${item.maxReadingDrift}px`);
          assert.equal(await target.locator(owned).count(), phase === 'restore' ? 0 : 1);
          if (mode === 'hover') assert.equal(await page.locator(owned).count(), phase === 'restore' ? 0 : 1);
          if (phase !== 'restore') assert.match(await target.locator(owned).textContent(), /测试译文/);
          assert.equal(await page.locator(`${owned} ${owned}`).count(), 0);
          for (const selector of site.forbiddenSelectors) assert.equal(await page.locator(`${selector} ${owned}`).count(), 0);
          await page.screenshot({path: path.join(args.artifactsDir, `${spec.id}-${mode}-${startY}-${phase}.png`)});
          if (phase === 'restore') assert.equal(await target.textContent(), originalText);
        }
        result.calls = [];
        for (const world of worlds) {
          const r = await cdp.send('Runtime.evaluate', {contextId: world.id, expression: 'JSON.stringify(globalThis.__frViewportCalls)', returnByValue: true}).catch(() => null);
          if (r?.result?.value) result.calls.push({world: world.name, calls: JSON.parse(r.result.value)});
        }
        assert.equal(await target.getAttribute('href'), targetHref);
        assert.deepEqual(await sourceLinks(), linksBefore);
        assert.equal(page.url(), site.url);
        // Keep completed tabs until session cleanup: closing an active third-party page may
        // focus a different browser window. Each new tab still passes the helper's focus guard.
        result.passed = true; save(); await cdp.detach(); cdpSessions.delete(cdp); page = null;
        console.log(JSON.stringify({...result, calls: undefined, pageDiagnostics: result.pageDiagnostics.length,
          phases: result.phases.map(({frames, ...p}) => p)}));
      }
    }
    if (args.expectRegression) {
      assert.ok(report.cases.some(c => (c.mode === 'hover' || c.startY === 0) && c.phases[0].maxY - c.phases[0].minY > 2));
      report.reproduced = true;
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    primaryError = error;
    report.error = error.stack;
    if (page) await page.screenshot({path: path.join(args.artifactsDir, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
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
    for (const cdp of cdpSessions) await cleanup('CDP session', () => cdp.detach());
    let browserClosed = false;
    await cleanup('browser', async () => { if (session) { await session.close(); browserClosed = true; } });
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
    await cleanup('report', () => { save(); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
