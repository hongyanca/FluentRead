'use strict';
const {waitForAsyncCondition} = require('./testing/wait-for-async-condition.cjs');
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');

// 网站适配生产包回归：隔离 Edge、真实快捷键、局部合成网页和本地翻译响应。
// 默认使用自建网页；--live 加载公开实站。两种模式均使用本地翻译响应。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {inspectFixtureTranslationParts} = require('./site-translation/fixture-translation-parts.cjs');
const argument = (key, fallback) => {
  const index = process.argv.indexOf(`--${key}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const root = path.resolve(__dirname, '..');
const extensionDir = path.resolve(argument('extension-dir', path.join(root, '.output/chrome-mv3')));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-site-adaptation-browser'));
const packages = argument('playwright-root', '');
const helperPath = argument('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs'));
if (!packages || !helperPath) throw new Error('需要 --playwright-root 和 --focus-safe-helper');
const {chromium} = require(path.join(packages, 'playwright'));
const helper = require(path.resolve(helperPath));
const timeout = 15000;
const wrapper = '.fluent-read-bilingual-content';
let profileDir;
fs.mkdirSync(artifactsDir, {recursive: true});
const isLive = process.argv.includes('--live');
const cases = JSON.parse(fs.readFileSync(path.join(root, isLive ? 'scripts/site-translation/site-adaptation-live-cases.json' : 'scripts/site-translation/site-adaptation-fixtures.json'), 'utf8'));
if (!isLive) cases.unshift(...JSON.parse(fs.readFileSync(path.join(root, 'scripts/site-translation/site-adaptation-established-fixtures.json'), 'utf8')));
const selectedIds = argument('cases', '').split(',').filter(Boolean);
if (selectedIds.length) cases.splice(0, cases.length, ...cases.filter(item => selectedIds.includes(item.id)));
const customPack = {version: 1, rules: [{
  id: 'reader-local-test', name: '阅读范围测试', match: {hosts: ['reader.example.test'], paths: ['/articles/*']},
  mode: 'focus', content: [{css: ['article p[data-readable="yes"]'], resolve: 'closest'}], protect: ['.private'],
}]};
const customCase = {id: 'custom-rule', url: 'https://reader.example.test/articles/start',
  html: '<article><p id="first" data-readable="yes">This first article paragraph has readable source text.</p><p id="second" data-readable="yes">The second article paragraph remains independently selectable.</p><p id="private" class="private">Private metadata must remain original.</p></article><section><p id="outside">This unrelated panel is outside the reading scope.</p></section>',
  required: ['#first', '#second'], forbidden: ['#private', '#outside']};
if (!isLive && (!selectedIds.length || selectedIds.includes('custom-rule'))) cases.push(customCase);
const pageHtml = item => '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{font:18px/1.65 system-ui;margin:40px;max-width:900px}p,li,h1,h2{margin:16px 0}button{font:inherit}pre{white-space:pre-wrap}nav,aside{border:1px solid #ddd;padding:10px}</style></head><body>' + item.html + '</body></html>';
const report = {scope: isLive ? 'production-extension-live-pages-local-provider' : 'production-extension-domain-fixtures', provider: 'microsoft-local-response', fixtureCases: [], ui: {}, consoleErrors: [], externalRequests: []};
let session;
let sequence = 0;
let popup;
let options;
let worker;
let context;
async function configRead() {
  return popup.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!result.success) throw new Error(result.error);
    return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
  });
}
async function configPatch(updates) {
  const response = await popup.evaluate(async ({updates, sequence}) => {
    const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const config = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    const expected = Object.fromEntries(Object.keys(updates).map(key => [key, config[key]]));
    return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates, expected,
      clientId: 'site-adaptation-browser', sequence, baseRevision: config.__fluentConfigRevision});
  }, {updates, sequence: ++sequence});
  assert.equal(response.success, true, JSON.stringify(response));
}
async function waitCount(page, selector, count) {
  await page.waitForFunction(({selector, count, wrapper}) =>
    document.querySelector(selector)?.querySelectorAll(wrapper).length === count,
  {selector, count, wrapper}, {timeout});
}
async function fullToggle(page) {
  await helper.activateExtensionTabWithoutForeground(context, page);
  await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
}
async function hoverToggle(page, selector, positioningAttempt = 0) {
  await helper.activateExtensionTabWithoutForeground(context, page);
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  // 实站可能带平滑滚动或吸顶导航；等待布局停止后再定位正文文字。
  await target.evaluate(async element => {
    let previous = element.getBoundingClientRect(), stable = 0;
    for (let index = 0; index < 40 && stable < 5; index++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const next = element.getBoundingClientRect();
      stable = Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y) < 0.5 ? stable + 1 : 0;
      previous = next;
    }
  });
  const box = await target.boundingBox();
  assert.ok(box && box.width && box.height, selector);
  const point = await target.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const x = rect.x + Math.min(12, rect.width / 2), y = rect.y + rect.height / 2;
        if (rect.width && rect.height && element.contains(document.elementFromPoint(x, y))) return {x, y};
      }
    }
    return null;
  });
  assert.ok(point, `No visible readable text at ${selector}`);
  await page.mouse.move(0, 0);
  await page.mouse.move(point.x, point.y, {steps: 4});
  await page.waitForTimeout(100);
  if (isLive) {
    const observed = await target.evaluate((element, point) => ({point,
      currentHit: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 250),
      targetHit: element.contains(document.elementFromPoint(point.x, point.y)),
      mouse: globalThis.__lastReadingMouse,
    }), point);
    (report.pointerChecks ??= []).push({url: page.url(), ...observed});
    if (!observed.targetHit) {
      assert.ok(positioningAttempt < 5, 'Live page kept moving away from the reading pointer');
      return hoverToggle(page, selector, positioningAttempt + 1);
    }
  }
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
}
async function verifyProtected(page, item, original) {
  for (let index = 0; index < item.forbidden.length; index++) {
    const node = page.locator(item.forbidden[index]);
    assert.equal(await node.locator(wrapper).count(), 0, `${item.id} protected wrapper`);
    assert.equal(await node.textContent(), original[index], `${item.id} protected text`);
  }
  assert.equal(page.url(), item.url);
  assert.equal(await page.locator(`${wrapper} ${wrapper}`).count(), 0, 'nested wrappers');
}
async function runCase(page, item) {
  item.stage = 'navigation';
  await page.goto(item.url, {waitUntil: 'domcontentloaded'});
  await page.locator('#fluent-read-page-styles').waitFor({state: 'attached', timeout});
  await page.waitForTimeout(200);
  if (isLive) {
    // Docusaurus 的客户端接管可能替换服务端节点；完成后再添加断言标记。
    const generator = await page.evaluate(() => document.querySelector('meta[name="generator"]')?.getAttribute('content'));
    if (generator?.startsWith('Docusaurus')) {
      await page.locator('html[data-has-hydrated="true"]').waitFor({state: 'attached', timeout});
    }
    await page.evaluate(() => document.addEventListener('mousemove', event => {
      globalThis.__lastReadingMouse = {x: event.clientX, y: event.clientY, trusted: event.isTrusted,
        target: event.target?.outerHTML?.slice(0, 250)};
    }, {capture: true}));
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)]
      .some(node => node.textContent.trim().length >= 70 && node.getBoundingClientRect().height > 0), item.selector, {timeout});
    const count = await page.locator(item.selector).evaluateAll(nodes => {
      const candidates = nodes.filter(node => node.textContent.trim().length >= 70 && node.getBoundingClientRect().height > 0 && !node.closest('nav,pre,code,button,li,[contenteditable]'));
      candidates.slice(0, 2).forEach((node, index) => node.setAttribute('data-reading-check', String(index)));
      return candidates.length;
    });
    assert.ok(count >= 1, 'live readable paragraphs unavailable');
    item.required = Array.from({length: Math.min(count, 2)}, (_, index) => `[data-reading-check="${index}"]`);
    const guardCount = await page.locator('pre, nav').evaluateAll(nodes => {
      const candidates = nodes.filter(node => node.textContent.trim() && node.getBoundingClientRect().height > 0).slice(0, 2);
      candidates.forEach((node, index) => node.setAttribute('data-reading-guard', String(index)));
      return candidates.length;
    });
    item.forbidden = Array.from({length: guardCount}, (_, index) => `[data-reading-guard="${index}"]`);
    for (const selector of item.guardSelectors ?? []) {
      if (await page.locator(selector).count() === 1) item.forbidden.push(selector);
    }
    item.requestedUrl = item.url; item.url = page.url();
  }
  const original = await Promise.all(item.forbidden.map(selector => page.locator(selector).textContent()));
  const source = await Promise.all(item.required.map(selector => page.locator(selector).textContent()));
  const restoredHTML = await Promise.all((item.restoreSelectors ?? []).map(selector => page.locator(selector).innerHTML()));
  const evidence = {id: item.id, url: item.url, kind: isLive ? 'live-page-local-provider' : 'synthetic-domain-fixture', hover: [], full: [], protected: item.forbidden.length};
  for (const count of process.argv.includes('--full-only') ? [] : [1, 0, 1, 0]) {
    item.stage = `hover-${evidence.hover.length}-${count}`;
    await hoverToggle(page, item.required[0]);
    await waitCount(page, item.required[0], count);
    await page.waitForTimeout(350);
    await verifyProtected(page, item, original);
    for (const selector of item.required.slice(1)) assert.equal(await page.locator(selector).locator(wrapper).count(), 0, 'hover changed neighbor');
    evidence.hover.push(count);
  }
  for (const count of [1, 0, 1]) {
    item.stage = `full-${evidence.full.length}-${count}`;
    await fullToggle(page);
    for (const selector of item.required) await waitCount(page, selector, count);
    if (item.translationParts) {
      if (count === 1) {
        await page.waitForFunction(inspectFixtureTranslationParts, {parts: item.translationParts, requireAll: true}, {timeout});
        (evidence.translationParts ??= []).push(await page.evaluate(inspectFixtureTranslationParts, {parts: item.translationParts}));
      } else {
        await page.waitForFunction(() => !document.querySelector(
          '.fluent-read-bilingual-content, [data-fr-translation-segment="true"]'), null, {timeout});
      }
    }
    await verifyProtected(page, item, original);
    if (count === 0) for (let index = 0; index < item.required.length; index++) assert.equal(await page.locator(item.required[index]).textContent(), source[index]);
    if (count === 0) for (let index = 0; index < restoredHTML.length; index++) {
      assert.equal(await page.locator(item.restoreSelectors[index]).innerHTML(), restoredHTML[index], `${item.id}: mixed source structure not restored`);
    }
    evidence.full.push(count);
  }
  if (!isLive) {
    const payload = await worker.evaluate(() => globalThis.__adaptationRequests.flat().join('\n'));
    for (const protectedText of original) assert.ok(!payload.includes(protectedText.trim()), `${item.id}: protected text reached provider`);
    for (const part of item.translationParts ?? []) {
      assert.ok(payload.replace(/\s+/gu, ' ').includes(part.sourceIncludes), `${item.id}: source part did not reach provider`);
      for (const literal of [...(part.preservedText ?? []), ...(part.omittedText ?? [])]) {
        assert.ok(!payload.replace(/\s+/gu, ' ').includes(literal.replace(/\s+/gu, ' ')), `${item.id}: protected part reached provider`);
      }
    }
    evidence.providerProtection = true;
  }
  if (item.id === 'custom-rule') {
    await page.evaluate(() => {
      const p = document.createElement('p'); p.id = 'dynamic'; p.dataset.readable = 'yes'; p.textContent = 'A newly inserted paragraph must enter the active translation session.';
      document.querySelector('article').append(p);
    });
    await waitCount(page, '#dynamic', 1);
    evidence.dynamic = true;
    await page.locator('#second').evaluate(node => { node.dataset.readable = 'no'; });
    await waitCount(page, '#second', 0);
    await page.locator('#second').evaluate(node => { node.dataset.readable = 'yes'; });
    await waitCount(page, '#second', 1);
    evidence.attributeReclassification = true;
    const updated = structuredClone(customPack);
    updated.rules[0].protect.push('#second');
    await configPatch({siteAdaptation: {enabled: true, disabledRuleIds: [], custom: updated}});
    await page.waitForFunction(wrapper => document.querySelectorAll(wrapper).length === 0, wrapper, {timeout});
    await fullToggle(page);
    await waitCount(page, '#first', 1);
    assert.equal(await page.locator('#second').locator(wrapper).count(), 0);
    evidence.liveConfigInvalidation = true;
    await fullToggle(page);
    await worker.evaluate(() => { globalThis.__adaptationHold = true; });
    await page.locator('#first').evaluate(node => { node.textContent = 'This delayed source must never resurrect after a stricter rule is saved.'; });
    await fullToggle(page);
    await worker.evaluate(async () => {
      const deadline = Date.now() + 8000;
      while (!globalThis.__adaptationReleases.length) {
        if (Date.now() > deadline) throw new Error('Delayed provider request did not arrive');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    updated.rules[0].protect.push('#first');
    await configPatch({siteAdaptation: {enabled: true, disabledRuleIds: [], custom: updated}});
    await worker.evaluate(() => { globalThis.__adaptationHold = false; globalThis.__adaptationReleases.splice(0).forEach(release => release()); });
    await page.waitForTimeout(500);
    assert.equal(await page.locator(wrapper).count(), 0, 'late response resurrected cancelled translation');
    evidence.lateResponseCancelled = true;
    await page.evaluate(() => history.pushState({}, '', '/settings'));
    // 切换路由后 focus 规则不再命中，原本不在正文白名单内的面板恢复通用候选资格。
    await hoverToggle(page, '#outside');
    await waitCount(page, '#outside', 1);
    evidence.spaPathRematch = true;
  }
  await page.screenshot({path: path.join(artifactsDir, `${item.id}.png`), fullPage: false});
  if (item.id !== 'custom-rule') await fullToggle(page);
  report.fixtureCases.push(evidence);
  fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
}
async function openAdaptation() {
  await options.locator('[data-section="settings-sites"]').click();
  const card = options.locator('[data-setting="site-adaptation"]');
  if ((await card.getAttribute('open')) === null) await card.locator(':scope > summary').click();
  return card;
}
async function main() {
  let primaryError;
  let launchAttempted = false;
  try {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-site-adaptation-'));
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      viewport: {width: 1280, height: 900}, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    context = session.context;
    if (isLive) await context.setExtraHTTPHeaders({'Accept-Language': 'en-US,en;q=0.9'});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const attach = page => page.on('pageerror', error => report.consoleErrors.push(error.message));
    const installWorker = async current => current.evaluate(() => {
      globalThis.__adaptationRequests = [];
      globalThis.__adaptationHold = false; globalThis.__adaptationReleases = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (url.hostname === 'edge.microsoft.com' && url.pathname === '/translate/translatetext') {
          const body = init?.body ?? await input.text();
          const texts = JSON.parse(body);
          globalThis.__adaptationRequests.push(texts);
          if (globalThis.__adaptationHold) await new Promise(resolve => globalThis.__adaptationReleases.push(resolve));
          return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))), {status: 200, headers: {'content-type': 'application/json'}});
        }
        throw new Error(`External worker fetch disabled: ${url.origin}`);
      };
    });
    context.on('serviceworker', next => { void installWorker(next).catch(error => report.consoleErrors.push(error.message)); });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await installWorker(worker);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const item = cases.find(item => item.url === url.href);
      if (!isLive && item && route.request().isNavigationRequest()) return route.fulfill({status: 200, contentType: 'text/html', body: pageHtml(item)});
      if (isLive) return route.continue();
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (!url.pathname.endsWith('favicon.ico')) report.externalRequests.push(url.origin + url.pathname);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const id = new URL(worker.url()).host;
    popup = await helper.newPageWithoutForeground(context); attach(popup);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForTimeout(1000);
    await configPatch({service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false, hotkey: 'Control', mouseHoverTranslationDelay: 0,
      fullPageTranslationMode: 'all', useCache: false, enableAIContext: false, enableAIMultiSegment: false,
      uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true,
      siteAdaptation: {enabled: true, disabledRuleIds: [], custom: customPack}});
    options = await helper.newPageWithoutForeground(context); attach(options);
    await options.goto(`chrome-extension://${id}/options.html#settings-sites`);
    await options.waitForTimeout(600);
    let card = await openAdaptation();
    if (!isLive) {
    const textarea = card.locator('textarea');
    const persistedBefore = (await configRead()).siteAdaptation;
    await textarea.fill('{"version":9,"rules":[]}');
    await card.getByRole('button', {name: '保存规则', exact: true}).click();
    await card.getByRole('alert').waitFor();
    assert.deepEqual((await configRead()).siteAdaptation, persistedBefore);
    report.ui.invalidDraftPreserved = true;
    await textarea.fill(JSON.stringify(customPack, null, 2));
    const extra = structuredClone(customPack); extra.rules[0].name = '持久化阅读规则';
    await textarea.fill(JSON.stringify(extra, null, 2));
    await options.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__restoreAdaptationSend = () => { chrome.runtime.sendMessage = original; };
      chrome.runtime.sendMessage = (message, ...args) => {
        if (message?.type === 'persistConfig' && message.config?.siteAdaptation) {
          const response = {success: false, error: 'fixture: simulated configuration persistence failure'};
          const callback = args.at(-1);
          if (typeof callback === 'function') { queueMicrotask(() => callback(response)); return; }
          return Promise.resolve(response);
        }
        return original(message, ...args);
      };
    });
    await card.getByRole('button', {name: '保存规则', exact: true}).click();
    await card.getByRole('alert').filter({hasText: '保存失败'}).waitFor();
    assert.equal(JSON.parse(await textarea.inputValue()).rules[0].name, '持久化阅读规则');
    assert.deepEqual((await configRead()).siteAdaptation, persistedBefore);
    await options.evaluate(() => globalThis.__restoreAdaptationSend());
    report.ui.failedSaveKeepsDraft = true;
    await card.getByRole('button', {name: '保存规则', exact: true}).click();
    await options.waitForTimeout(800);
    assert.equal((await configRead()).siteAdaptation.custom.rules[0].name, '持久化阅读规则');
    await options.reload(); card = await openAdaptation();
    assert.equal(JSON.parse(await card.locator('textarea').inputValue()).rules[0].name, '持久化阅读规则');
    report.ui.reopenPersistence = true;
    await card.getByRole('textbox', {name: '输入完整网址', exact: true}).fill(customCase.url);
    await card.locator('.adaptation-preview').getByText('持久化阅读规则').waitFor();
    report.ui.urlPreview = true;
    const downloadPromise = options.waitForEvent('download');
    await card.getByRole('button', {name: '导出已保存规则', exact: true}).click();
    const download = await downloadPromise;
    const exportPath = path.join(artifactsDir, 'custom-rules-export.json');
    await download.saveAs(exportPath);
    assert.equal(JSON.parse(fs.readFileSync(exportPath, 'utf8')).rules[0].name, '持久化阅读规则');
    await card.getByRole('button', {name: '清空自定义草稿', exact: true}).click();
    assert.equal(JSON.parse(await card.locator('textarea').inputValue()).rules.length, 0);
    await card.getByRole('button', {name: '撤销草稿替换', exact: true}).click();
    assert.equal(JSON.parse(await card.locator('textarea').inputValue()).rules[0].name, '持久化阅读规则');
    await card.locator('input[type="file"]').setInputFiles(exportPath);
    await card.getByRole('status').filter({hasText: '已导入草稿'}).waitFor();
    assert.equal(JSON.parse(await card.locator('textarea').inputValue()).rules[0].name, '持久化阅读规则');
    report.ui.importExportUndo = true;
    await card.getByText('查看内置规则', {exact: true}).click();
    await card.locator('input[type="search"]').fill('github.com');
    const github = card.locator('[data-adaptation-rule="github"]');
    await github.locator('.el-switch').click();
    await waitForAsyncCondition(() => options.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const config = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
      return config.siteAdaptation.disabledRuleIds.includes('github');
    }, undefined), {timeoutMs: timeout, message: "GitHub 内置适配规则未持久化为禁用"});
    await github.locator('.el-switch').click();
    await waitForAsyncCondition(() => options.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const config = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
      return !config.siteAdaptation.disabledRuleIds.includes('github');
    }, undefined), {timeoutMs: timeout, message: "GitHub 内置适配规则未持久化为启用"});
    await github.getByRole('button', {name: /GitHub/}).click();
    await card.getByRole('button', {name: '复制到自定义草稿', exact: true}).click();
    assert.ok(JSON.parse(await card.locator('textarea').inputValue()).rules.some(rule => rule.id === 'github'));
    await card.getByRole('button', {name: '撤销草稿替换', exact: true}).click();
    assert.equal(JSON.parse(await card.locator('textarea').inputValue()).rules.length, 1);
    report.ui.builtinSearchDisableCopy = true;
    await card.getByText('查看内置规则', {exact: true}).click();
    await options.screenshot({path: path.join(artifactsDir, 'settings-desktop.png')});
    await options.setViewportSize({width: 390, height: 820});
    await card.evaluate(element => element.scrollIntoView({block: 'start'}));
    await options.waitForTimeout(200);
    report.ui.mobileOverflow = await options.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(report.ui.mobileOverflow, false);
    await options.screenshot({path: path.join(artifactsDir, 'settings-mobile.png')});
    await card.locator('textarea').scrollIntoViewIfNeeded();
    await options.screenshot({path: path.join(artifactsDir, 'settings-mobile-editor.png')});
    await options.setViewportSize({width: 1280, height: 900});
    }
    await configPatch({siteAdaptation: {enabled: true, disabledRuleIds: [], custom: isLive ? {version: 1, rules: []} : customPack}});
    const page = await helper.newPageWithoutForeground(context); attach(page);
    for (const item of cases) {
      try { await runCase(page, item); }
      catch (error) {
        report.fixtureCases.push({id: item.id, stage: item.stage, error: error.message, diagnostics: await page.evaluate(() => ({url: location.href, targets: [...document.querySelectorAll('[data-reading-check]')].map(node => node.outerHTML.slice(0, 1500)), wrappers: [...document.querySelectorAll('.fluent-read-bilingual-content')].map(node => ({parent: node.parentElement.id, text: node.textContent})), retries: document.querySelectorAll('.fluent-read-retry-wrapper').length}))});
        await fs.promises.writeFile(path.join(artifactsDir, `${item.id}-failed.html`), await page.content());
        await fs.promises.writeFile(path.join(artifactsDir, `${item.id}-requests.json`), JSON.stringify(await worker.evaluate(() => globalThis.__adaptationRequests), null, 2));
        await page.screenshot({path: path.join(artifactsDir, `${item.id}-failed.png`)});
        if (!isLive) throw error;
        fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
      }
    }
    report.translationRequests = await worker.evaluate(() => globalThis.__adaptationRequests.length);
    if (!isLive) assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
    report.success = report.fixtureCases.every(item => !item.error);
  } catch (error) {
    primaryError = error;
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
    await cleanup(() => {
      if (!profileDir) return;
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        // No browser launch was attempted; only remove an empty initial profile.
        try {fs.rmdirSync(profileDir);} catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    if (cleanupErrors.length) {
      report.success = false;
      report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
    }
    await cleanup(() => {fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
}
main().then(() => { console.log(JSON.stringify({success: report.success, passed: report.fixtureCases.filter(item => !item.error).length, total: report.fixtureCases.length, report: path.join(artifactsDir, 'report.json')})); if (!report.success) process.exitCode = 1; }).catch(error => {console.error(error.stack); process.exitCode = 1;});
