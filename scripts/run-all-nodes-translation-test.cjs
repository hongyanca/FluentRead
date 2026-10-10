#!/usr/bin/env node
'use strict';

// Production extension, temporary Edge profile and deterministic loopback provider.
// Fixtures independently reproduce Epoch navigation/footer, workflow controls,
// tree/tabs, expanded content and a dynamically mounted portal. This is deliberately
// separate from real-site/provider matrix evidence.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {startTranslationFixtureServer} = require('./run-full-page-translation-test.cjs');

function parseArgs(argv) {
  const args = {timeout: 45000, liveEpoch: false, allowNetwork: false, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--background') continue;
    if (key === '--live-epoch') {args.liveEpoch = true;continue;}
    if (key === '--live-only') {args.liveOnly = true;args.liveEpoch = true;continue;}
    if (key === '--allow-network') {args.allowNetwork = true;continue;}
    if (!key.startsWith('--') || key === '--headed') throw new Error('此脚本仅允许不抢焦点的 --background 隔离浏览器');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${key}`);
    args[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
    if (!args[key]) throw new Error(`缺少 ${key}`);
    args[key] = path.resolve(args[key]);
  }
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('timeout 必须为正数');
  if (args.liveEpoch && !args.allowNetwork) throw new Error('--live-epoch 必须显式传入 --allow-network');
  return args;
}

async function installProvider(worker, translationUrl, blockedUrl) {
  await worker.evaluate(({translationUrl, blockedUrl}) => {
    if (globalThis.__frAllNodesFixtureInstalled) return;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (url.hostname === 'edge.microsoft.com' && url.pathname === '/translate/translatetext') {
        return original(input instanceof Request ? new Request(translationUrl, input) : translationUrl, init);
      }
      if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
        return original(`${blockedUrl}?url=${encodeURIComponent(url.href)}`);
      }
      return original(input, init);
    };
    globalThis.__frAllNodesFixtureInstalled = true;
  }, {translationUrl, blockedUrl});
}

let configSequence = 0;
async function configure(popup, updates = {}) {
  assert(!Object.hasOwn(updates, 'translationScope'), '识别范围只能通过真实设置开关修改');
  return popup.evaluate(async ({updates, sequence}) => {
    const send = message => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(response);
    }));
    const stored = await send({type: 'configStorageRead', key: 'local:config'});
    if (!stored.success) throw new Error(stored.error || '读取配置失败');
    const config = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    const revision = config.__fluentConfigRevision;
    for (const key of Object.keys(config)) if (key.startsWith('__fluentConfig')) delete config[key];
    Object.assign(config, {on: true, display: 1, service: 'freeTranslation', uiLanguage: 'zh-CN',
      uiLanguageSetupCompleted: true, theme: 'auto', fullPageTranslationMode: 'all', mouseHoverTranslationDelay: 0}, updates);
    const result = await send({type: 'persistConfig', config, clientId: 'all-nodes-browser-fixture', sequence, baseRevision: revision});
    if (!result.success) throw new Error(result.error || '配置未保存');
    return {service: config.service, display: config.display, fullPageTranslationMode: config.fullPageTranslationMode, uiLanguage: config.uiLanguage, translationScope: config.translationScope};
  }, {updates, sequence: ++configSequence});
}

async function action(popup, url, actionName) {
  assert(['fullPage', 'restore'].includes(actionName), '只允许现有全文翻译和恢复动作');
  return popup.evaluate(async ({url, actionName}) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab?.id) throw new Error('找不到隔离 fixture 页签');
    const response = await chrome.tabs.sendMessage(tab.id, {type: 'contextMenuTranslate', action: actionName});
    if (response?.status !== 'success') throw new Error(`翻译动作 ${actionName} 失败: ${JSON.stringify(response)}`);
    return response;
  }, {url, actionName});
}

async function readConfig(popup) {
  return popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!response.success) throw new Error(response.error || '读取配置失败');
    return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
  });
}

async function createSettingsDriver(context, popup, helper, session, optionsUrl, args, report) {
  const name = /^(识别全部节点|Detect all nodes)$/;
  report.settings = {entry: 'options#settings-advanced / Page recognition', persistenceCases: [], quickClose: [], crossPageSync: [], latestWriteWins: [], layouts: [], consoleErrors: []};
  report.focusChecks = [];
  const browserCDP = await context.browser().newBrowserCDPSession();
  const {processInfo} = await browserCDP.send('SystemInfo.getProcessInfo');
  const browserPid = processInfo.find(process => process.type === 'browser')?.id;
  assert(browserPid, '无法确认隔离浏览器进程');
  await browserCDP.detach();
  async function checkFocus(options, label) {
    const frontmost = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      "ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)});"], {encoding: 'utf8', timeout: 5000}));
    assert.notEqual(frontmost.pid, browserPid, '隔离 Edge 意外成为前台应用');
    const cdp = await context.newCDPSession(options);
    const {bounds} = await cdp.send('Browser.getWindowForTarget');
    await cdp.detach();
    const expected = session.windowPlacement.bounds;
    for (const key of ['left', 'top', 'width', 'height']) assert.equal(bounds[key], expected[key], `后台窗口边界改变：${key}`);
    assert.equal(bounds.windowState, 'normal');
    report.focusChecks.push({label, browserPid, frontmost, browserFrontmost: false, bounds, screenIndex: session.windowPlacement.screenIndex});
  }
  async function open(width = 1440, colorScheme = 'light') {
    const options = await helper.newPageWithoutForeground(context, args.timeout);
    options.on('pageerror', error => report.settings.consoleErrors.push(error.message));
    options.on('console', message => {if (message.type() === 'error') report.settings.consoleErrors.push(message.text());});
    await options.setViewportSize({width, height: 1000});
    await options.emulateMedia({colorScheme});
    await options.goto(`${optionsUrl}#settings-advanced`);
    // Element Plus uses a visually hidden accessible input inside its visible switch.
    await options.getByRole('switch', {name}).locator('xpath=..').waitFor({state: 'visible', timeout: args.timeout});
    await checkFocus(options, `options-open-${width}-${colorScheme}`);
    return options;
  }
  async function waitPersisted(scope) {
    const deadline = Date.now() + args.timeout;
    let config;
    do {
      config = await readConfig(popup);
      if (config.translationScope === scope) return config;
      await popup.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw new Error(`设置未保存：expected=${scope}, actual=${config?.translationScope}`);
  }
  async function setScope(scope, label) {
    const before = await readConfig(popup);
    const options = await open();
    const toggle = options.getByRole('switch', {name});
    assert.equal(await toggle.getAttribute('aria-checked'), String(before.translationScope === 'all'), '设置初始值与已保存配置不一致');
    if (before.translationScope !== scope) await toggle.locator('xpath=..').click();
    const afterClick = await toggle.getAttribute('aria-checked');
    assert.equal(afterClick, String(scope === 'all'));
    // No persistence wait before closing: exercise the short-lived options page.
    await options.close();
    const saved = await waitPersisted(scope);
    const reopened = await open();
    const reopenedValue = await reopened.getByRole('switch', {name}).getAttribute('aria-checked');
    assert.equal(reopenedValue, String(scope === 'all'), '关闭重开设置后开关值丢失');
    await reopened.screenshot({path: path.join(args.artifactsDir, `settings-${label}-reopened.png`)});
    await reopened.close();
    const evidence = {label, before: before.translationScope, afterClick, closedBeforePersistenceWait: true,
      savedScope: saved.translationScope, revisionBefore: before.__fluentConfigRevision, revisionAfter: saved.__fluentConfigRevision, reopenedValue};
    report.settings.persistenceCases.push(evidence);
    report.settings.quickClose.push(evidence);
    report.settings.crossPageSync.push({label, surface: 'options-closed-to-popup-runtime-read', savedScope: saved.translationScope});
    return evidence;
  }
  async function verifyLatestWriteWins() {
    const before = await readConfig(popup);
    const options = await open();
    const toggle = options.getByRole('switch', {name});
    await toggle.locator('xpath=..').click();
    await toggle.locator('xpath=..').click();
    await options.close();
    await popup.waitForTimeout(350);
    await waitPersisted(before.translationScope);
    const reopened = await open();
    assert.equal(await reopened.getByRole('switch', {name}).getAttribute('aria-checked'), String(before.translationScope === 'all'));
    await reopened.close();
    report.settings.latestWriteWins.push({twoConsecutiveToggles: true, closedImmediately: true, finalScope: before.translationScope});
  }
  async function captureLayouts() {
    for (const language of ['zh-CN', 'en-US']) {
      await configure(popup, {uiLanguage: language});
      for (const colorScheme of ['light', 'dark']) {
        for (const width of [1440, 1024, 820, 390]) {
          const options = await open(width, colorScheme);
          await options.getByRole('switch', {name}).locator('xpath=..').scrollIntoViewIfNeeded();
          await options.waitForTimeout(250);
          const geometry = await options.getByRole('switch', {name}).evaluate(element => {
            const rect = element.parentElement.getBoundingClientRect();
            return {viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
              left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              dark: document.documentElement.classList.contains('dark'), label: element.getAttribute('aria-label'),
              checked: element.getAttribute('aria-checked')};
          });
          assert(geometry.documentWidth <= width + 1, `设置页面横向溢出：${JSON.stringify(geometry)}`);
          assert(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= 1000, '识别开关未完整可见');
          assert.equal(geometry.dark, colorScheme === 'dark', '设置深浅主题未跟随系统');
          assert.equal(geometry.label, language === 'en-US' ? 'Detect all nodes' : '识别全部节点');
          const screenshot = `settings-${language}-${colorScheme}-${width}.png`;
          await options.screenshot({path: path.join(args.artifactsDir, screenshot)});
          await checkFocus(options, screenshot);
          report.settings.layouts.push({language, colorScheme, width, screenshot, geometry});
          await options.close();
        }
      }
    }
    await configure(popup);
    assert.deepEqual(report.settings.consoleErrors, [], '设置页控制台异常');
    report.settings.layoutsPassed = true;
  }
  const initial = await readConfig(popup);
  assert.equal(initial.translationScope, 'content', '新配置必须默认普通识别');
  await setScope('content', 'default-off');
  return {setScope, verifyLatestWriteWins, captureLayouts};
}

async function snapshot(page) {
  return page.evaluate(() => {
    const wrapper = '.fluent-read-bilingual-content';
    const tracked = [...document.querySelectorAll('[data-all-node], [data-dynamic-node], #article-body, #workflow-body, #project-body')];
    return {
      count: document.querySelectorAll(wrapper).length,
      translatedLabels: tracked.filter(e => !e.querySelector(wrapper) && /[\u3400-\u9fff]/u.test(e.textContent)).length,
      nested: document.querySelectorAll(`${wrapper} ${wrapper}`).length,
      duplicateParents: [...new Set([...document.querySelectorAll(wrapper)].map(e => e.parentElement))]
        .filter(e => e.querySelectorAll(':scope > .fluent-read-bilingual-content').length > 1).map(e => e.id || e.tagName),
      nodes: Object.fromEntries(tracked.map(e => [e.id, {count: e.querySelectorAll(wrapper).length, text: e.textContent, visible: !!e.getClientRects().length}])),
      protected: Object.fromEntries([...document.querySelectorAll('[data-protected]')].map(e => [e.id, {html: e.innerHTML, value: e.value ?? null}])),
      // Bilingual paragraphs may reconstruct inline links inside their translated
      // copy. Check application links, whose attributes and identity must survive.
      links: Object.fromEntries([...document.querySelectorAll('a')].filter(e => !e.closest(wrapper))
        .map(e => [e.id, {href: e.getAttribute('href'), target: e.getAttribute('target'), rel: e.getAttribute('rel')}])),
      identityPreserved: !window.__fixtureOriginalElements || window.__fixtureOriginalElements.every(([id, element]) => document.getElementById(id) === element),
      events: {...window.fixtureEvents},
      url: location.href,
    };
  });
}

function assertInvariant(current, baseline, phase) {
  assert.equal(current.nested, 0, `${phase}: nested translation wrappers`);
  assert.deepEqual(current.duplicateParents, [], `${phase}: repeated wrappers`);
  assert.deepEqual(current.protected, baseline.protected, `${phase}: protected input/code/exclusion changed`);
  assert.deepEqual(current.links, baseline.links, `${phase}: link attributes changed`);
  assert.equal(current.identityPreserved, true, `${phase}: application element identity changed`);
  assert.equal(current.url, baseline.url, `${phase}: unexpected navigation`);
}

async function waitForNodes(page, ids, expectedCount, timeout, controlIds = []) {
  try {
    await page.waitForFunction(({ids, expectedCount, controlIds}) => ids.every(id => {
      const node = document.getElementById(id);
      const translations = node?.querySelectorAll('.fluent-read-bilingual-content');
      if (expectedCount === 1 && controlIds.includes(id)) {
        return translations?.length === 0 && /[\u3400-\u9fff]/u.test(node.textContent);
      }
      return translations?.length === expectedCount && (expectedCount === 0 || [...translations].every(e => /[\u3400-\u9fff]/u.test(e.textContent)));
    }), {ids, expectedCount, controlIds}, {timeout});
  } catch (error) {
    throw new Error(`${error.message}\nNode states: ${JSON.stringify((await snapshot(page)).nodes)}`);
  }
}

async function clickInteractions(page) {
  for (const id of ['workflow-save', 'epoch-contact', 'epoch-graph', 'tab-history']) await page.locator(`#${id}`).click();
}

async function hoverControl(page, context, helper, args) {
  await helper.activateExtensionTabWithoutForeground(context, page, args.timeout);
  const target = page.locator('#epoch-dashboard');
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await target.boundingBox();
  assert(box, '真实悬浮目标不可见');
  await page.mouse.move(box.x + box.width * 0.35, box.y + Math.min(12, box.height * 0.2));
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
}

async function runLiveEpoch(page, popup, context, helper, settings, args, report) {
  const url = 'https://epoch.ai/data/ai-data-centers';
  const evidence = report.liveEpoch = {passed: false, completedPhases: [], sourceUrl: url,
    evidenceType: 'live-site-production-extension-with-controlled-loopback-provider', providerQualityTested: false};
  const checkpoint = (phase, state) => {evidence[phase] = state;evidence.completedPhases.push(phase);};
  const pageErrors = [];
  const recordError = error => pageErrors.push(error.message);
  page.on('pageerror', recordError);
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: args.timeout});
  await page.waitForSelector('nav.secondary-nav a', {timeout: args.timeout});
  await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
  // Epoch sends server-rendered controls before hydrating its interactive chart.
  // Wait for initial hydration, and resolve current chart nodes on each read.
  await page.waitForTimeout(3500);
  await helper.activateExtensionTabWithoutForeground(context, page, args.timeout);
  await page.evaluate(() => {
    const definitions = [
      ...[0, 1, 2, 3].map(index => ({selector: 'nav.secondary-nav a', index, dynamic: false})),
      {selector: 'footer .newsletter-title', index: 0, dynamic: false},
      ...[...document.querySelectorAll('footer a')].flatMap((element, index) =>
        element.getClientRects().length && (element.textContent.match(/\p{L}/gu)?.length || 0) >= 2
          ? [{selector: 'footer a', index, dynamic: false}] : []),
      ...[0, 1, 2].map(index => ({selector: 'button.button-tab', index, dynamic: true})),
    ];
    const controls = definitions.map(definition => ({...definition, element: document.querySelectorAll(definition.selector)[definition.index]})).filter(entry => entry.element);
    window.__epochContract = {
      controls: controls.map(({element, ...definition}) => ({...definition, element, original: element.textContent, href: element.getAttribute('href')})),
      footerHeading: document.querySelector('footer h2.tagline'),
      inputs: [...document.querySelectorAll('input[placeholder*="Search"]')].map(element => ({element, value: element.value, placeholder: element.getAttribute('placeholder')})),
    };
  });
  const read = () => page.evaluate(() => {
    const contract = window.__epochContract;
    return {
      url: location.href,
      title: document.title,
      controls: contract.controls.map(({element: initialElement, original, href, selector, index, dynamic}) => {
        const element = document.querySelectorAll(selector)[index];
        return {original, text: element?.textContent, wrapperCount: element?.querySelectorAll('.fluent-read-bilingual-content').length,
          connected: element?.isConnected === true, hrefUnchanged: element?.getAttribute('href') === href,
          dynamic, remounted: element !== initialElement};
      }),
      footerHeading: {text: contract.footerHeading?.textContent, wrapperCount: contract.footerHeading?.querySelectorAll('.fluent-read-bilingual-content').length},
      inputsUnchanged: contract.inputs.every(({element, value, placeholder}) => element.isConnected && element.value === value && element.getAttribute('placeholder') === placeholder),
      wrapperCount: document.querySelectorAll('.fluent-read-bilingual-content').length,
      nestedWrappers: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
      duplicateParents: [...new Set([...document.querySelectorAll('.fluent-read-bilingual-content')].map(e => e.parentElement))].filter(e => e.querySelectorAll(':scope > .fluent-read-bilingual-content').length > 1).length,
    };
  });
  const baseline = await read();
  assert(baseline.controls.length >= 7, 'Epoch 实站缺少预期导航、页脚和图表控件');
  checkpoint('baseline', baseline);
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-before.png')});
  await action(popup, url, 'fullPage');
  await page.waitForFunction(() => !!document.querySelector('h1 .fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  const ordinary = await read();
  for (const control of ordinary.controls.slice(0, 4)) assert.equal(control.text, control.original, 'Epoch 普通模式意外修改导航');
  checkpoint('ordinary', ordinary);
  await page.evaluate(() => {window.__epochOriginalWrapper = document.querySelector('h1 .fluent-read-bilingual-content');});
  await settings.setScope('all', 'epoch-on');
  await page.waitForTimeout(300);
  const frozen = await read();
  assert.deepEqual(frozen.controls.slice(0, 4).map(e => e.text), ordinary.controls.slice(0, 4).map(e => e.text), '修改识别范围不应扩展当前会话的导航识别');
  assert(await page.evaluate(() => window.__epochOriginalWrapper.isConnected), '设置保存不应更换当前正文');
  checkpoint('frozen', frozen);
  await action(popup, url, 'restore');
  await action(popup, url, 'fullPage');
  try {
    await page.waitForFunction(() => window.__epochContract.controls.every(({selector, index}) => /[\u3400-\u9fff]/u.test(document.querySelectorAll(selector)[index]?.textContent || '')) &&
      !!window.__epochContract.footerHeading?.querySelector('.fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  } catch (error) {
    throw new Error(`${error.message}\nEpoch 控件状态：${JSON.stringify(await read())}`);
  }
  const translated = await read();
  for (const control of translated.controls) {
    assert.equal(control.wrapperCount, 0, 'Epoch 控件应原位翻译');
    assert(control.connected && control.hrefUnchanged, 'Epoch 控件身份或链接发生变化');
    if (!control.dynamic) assert.equal(control.remounted, false, 'Epoch 静态导航和页脚元素身份变化');
  }
  assert(translated.inputsUnchanged, 'Epoch 搜索输入发生变化');
  assert.equal(translated.nestedWrappers, 0, 'Epoch 译文嵌套');
  assert.equal(translated.duplicateParents, 0, 'Epoch 译文重复');
  checkpoint('translated', translated);
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-translated-top.png')});
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-translated-footer.png')});
  await action(popup, url, 'fullPage');
  await page.waitForTimeout(500);
  const repeated = await read();
  assert.deepEqual(repeated.controls.map(e => e.text), translated.controls.map(e => e.text), 'Epoch 重复扫描重译已有控件');
  checkpoint('repeated', repeated);
  await action(popup, url, 'restore');
  await page.waitForFunction(() => !document.querySelector('.fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  const restored = await read();
  for (const control of restored.controls) assert.equal(control.text, control.original, 'Epoch 控件原文未恢复');
  assert(restored.inputsUnchanged, 'Epoch 恢复后搜索输入发生变化');
  checkpoint('restored', restored);
  await action(popup, url, 'fullPage');
  await page.waitForFunction(() => window.__epochContract.controls.every(({selector, index}) => /[\u3400-\u9fff]/u.test(document.querySelectorAll(selector)[index]?.textContent || '')), undefined, {timeout: args.timeout});
  const retranslated = await read();
  for (const control of retranslated.controls) assert.equal(control.wrapperCount, 0, 'Epoch 再译控件应保持原位');
  checkpoint('retranslated', retranslated);
  await settings.setScope('content', 'epoch-off');
  const disabledActiveSession = await read();
  assert.deepEqual(disabledActiveSession.controls.map(e => e.text), retranslated.controls.map(e => e.text), '关闭设置不应改动当前会话');
  await action(popup, url, 'restore');
  await action(popup, url, 'fullPage');
  await page.waitForFunction(() => !!document.querySelector('h1 .fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  const ordinaryAfterDisabled = await read();
  for (const control of ordinaryAfterDisabled.controls.slice(0, 4)) assert.equal(control.text, control.original, 'Epoch 关闭全部节点设置后仍翻译导航');
  await action(popup, url, 'restore');
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-restored-footer.png')});
  page.off('pageerror', recordError);
  process.stdout.write('Epoch 实际站点导航、图表控件和页脚升级/重复/恢复契约通过。\n');
  return {...evidence, passed: true,
    sourceUrl: url, selectors: ['nav.secondary-nav a', 'footer .newsletter-title', 'footer a (visible readable text)', 'button.button-tab', 'footer h2.tagline'],
    baseline, ordinary, frozen, translated, repeated, restored, retranslated, disabledActiveSession, ordinaryAfterDisabled, pageErrors};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(fs.existsSync(path.join(args.extensionDir, 'manifest.json')), '缺少生产 manifest.json');
  const {chromium} = createRequire(path.join(args.playwrightRoot, '__all_nodes_loader.cjs'))('playwright');
  const helper = require(args.focusSafeHelper);
  for (const method of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) assert.equal(typeof helper[method], 'function');
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  fs.rmSync(path.join(args.artifactsDir, 'report.json'), {force: true});
  const html = fs.readFileSync(path.join(__dirname, '../tests/fixtures/all-nodes-translation-fixture.html'));
  const server = http.createServer((request, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});response.end(html);});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/all-nodes.html`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-all-nodes-'));
  const unexpectedNetwork = [];
  const provider = await startTranslationFixtureServer(unexpectedNetwork);
  const runtimeErrors = [];
  const workerErrors = [];
  let permitLivePageNetwork = false;
  let session;
  let page;
  const manifest = JSON.parse(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'), 'utf8'));
  const bundleFiles = fs.readdirSync(args.extensionDir, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile()).map(entry => path.relative(args.extensionDir, path.join(entry.parentPath || entry.path, entry.name))).sort();
  const bundleHash = createHash('sha256');
  for (const filename of bundleFiles) {bundleHash.update(filename);bundleHash.update(fs.readFileSync(path.join(args.extensionDir, filename)));}
  const report = {evidenceType: 'production-extension-equivalent-fixtures', liveSite: false,
    extensionDir: args.extensionDir, extensionBundleSha256: bundleHash.digest('hex'), extensionBundleFiles: bundleFiles,
    examples: ['Epoch semantic navigation/footer and graph controls', 'Workflow menu and action toolbar', 'Project tree and tabs', 'Expanded content and dynamic portal', 'Protected input, editor, code, math and opt-out']};
  try {
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: args.browserPath,
      headless: false, background: true, viewport: {width: 1280, height: 900}, timeout: args.timeout,
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    const context = session.context;
    context.on('serviceworker', worker => installProvider(worker, provider.translationUrl, provider.blockedUrl).catch(error => workerErrors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: args.timeout});
    await installProvider(worker, provider.translationUrl, provider.blockedUrl);
    await context.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (!permitLivePageNetwork && /^https?:$/.test(requestUrl.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(requestUrl.hostname)) {
        unexpectedNetwork.push(requestUrl.href);await route.abort();return;
      }
      await route.continue();
    });
    const popup = await helper.newPageWithoutForeground(context, args.timeout);
    const extensionId = new URL(worker.url()).hostname;
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    report.config = await configure(popup);
    const optionsPath = manifest.options_ui?.page || manifest.options_page;
    assert(optionsPath, '生产清单缺少设置页面');
    const settings = await createSettingsDriver(context, popup, helper, session, `chrome-extension://${extensionId}/${optionsPath}`, args, report);
    report.entry = {surface: 'options', section: 'settings-advanced', group: 'Page recognition',
      realSwitchClickTested: true, persistedConfigField: 'translationScope', actionEvidence: 'existing-fullPage-and-restore-message-route'};
    page = await helper.newPageWithoutForeground(context, args.timeout);
    page.on('pageerror', error => runtimeErrors.push(error.message));
    if (args.liveOnly) {
      permitLivePageNetwork = true;
      report.liveEpoch = await runLiveEpoch(page, popup, context, helper, settings, args, report);
      await settings.captureLayouts();
      Object.assign(report, {passed: true, evidenceType: 'live-site-production-extension-with-controlled-loopback-provider', liveSite: true,
        launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement,
        providerRequests: provider.requestCount(), translatedItems: provider.translatedItemCount(), unexpectedNetwork, workerErrors});
      assert(provider.requestCount() > 0, 'Epoch 受控翻译 provider 未收到请求');
      assert.deepEqual(unexpectedNetwork, [], 'Epoch 翻译请求意外访问真实 provider');
      assert.deepEqual(workerErrors, [], 'Epoch service worker fixture 安装失败');
      fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({passed: true, artifactsDir: args.artifactsDir, liveSite: true, windowPlacement: report.windowPlacement}, null, 2)}\n`);
      return;
    }
    await page.goto(url);
    await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    await helper.activateExtensionTabWithoutForeground(context, page, args.timeout);
    await page.evaluate(() => {window.__fixtureOriginalElements = [...document.querySelectorAll('[id]')].map(e => [e.id, e]);});
    const baseline = await snapshot(page);
    report.baseline = baseline;
    const staticIds = await page.locator('[data-all-node]').evaluateAll(nodes => nodes.map(e => e.id));
    const bodyIds = ['article-body', 'workflow-body', 'project-body'];
    const ordinaryExcludedIds = ['epoch-latest', 'epoch-dashboard', 'footer-about', 'workflow-overview', 'tree-label'];
    const dynamicIds = ['expanded-owner', 'expanded-details', 'tree-child', 'portal-duplicate', 'portal-archive'];
    const controlIds = [...staticIds.filter(id => id !== 'footer-tagline'), ...dynamicIds];
    await hoverControl(page, context, helper, args);
    await page.waitForTimeout(500);
    assert.equal((await snapshot(page)).nodes['epoch-dashboard'].text, baseline.nodes['epoch-dashboard'].text, '默认悬浮不应翻译导航链接');
    await action(popup, url, 'fullPage');
    await waitForNodes(page, bodyIds, 1, args.timeout);
    const ordinary = await snapshot(page);
    for (const id of ordinaryExcludedIds) {
      assert.equal(ordinary.nodes[id].count, 0, `普通模式意外翻译 ${id}`);
      assert.equal(ordinary.nodes[id].text, baseline.nodes[id].text, `普通模式意外替换控件原文 ${id}`);
    }
    assertInvariant(ordinary, baseline, 'ordinary');
    await page.evaluate(ids => {window.__ordinaryWrappers = ids.flatMap(id => [...document.getElementById(id).querySelectorAll('.fluent-read-bilingual-content')]);}, bodyIds);
    report.ordinary = ordinary;
    process.stdout.write('普通模式正文与排除区域契约通过。\n');

    await settings.setScope('all', 'fixture-on');
    await settings.verifyLatestWriteWins();
    await page.waitForTimeout(300);
    const frozen = await snapshot(page);
    // An ordinary heading still queued by the existing session may complete while
    // options is open. Freeze already translated owners and excluded UI controls.
    for (const id of [...bodyIds, ...ordinaryExcludedIds]) {
      assert.deepEqual(frozen.nodes[id], ordinary.nodes[id], `范围设置不应改动当前会话节点 ${id}`);
    }
    assert(await page.evaluate(() => window.__ordinaryWrappers.every(e => e.isConnected)), '设置保存不应更换已译正文');
    report.scopeChangeFrozenSession = frozen;
    await action(popup, url, 'restore');
    await hoverControl(page, context, helper, args);
    await waitForNodes(page, ['epoch-dashboard'], 1, args.timeout, controlIds);
    const hovered = await snapshot(page);
    assert.equal(hovered.nodes['epoch-dashboard'].count, 0, '全部节点悬浮控件应原位翻译');
    await hoverControl(page, context, helper, args);
    await page.waitForFunction(original => document.getElementById('epoch-dashboard').textContent === original, baseline.nodes['epoch-dashboard'].text, {timeout: args.timeout});
    report.hover = {trigger: 'trusted-CDP-Control-key-down-up-with-pointer-on-navigation', defaultExcluded: true, translated: hovered.nodes['epoch-dashboard'], restored: (await snapshot(page)).nodes['epoch-dashboard']};
    await action(popup, url, 'fullPage');
    await waitForNodes(page, [...staticIds, ...bodyIds], 1, args.timeout, controlIds);
    const expanded = await snapshot(page);
    assertInvariant(expanded, baseline, 'all-nodes');
    report.allNodes = expanded;
    await page.screenshot({path: path.join(args.artifactsDir, 'all-nodes-translated.png'), fullPage: true});
    await action(popup, url, 'fullPage');
    await page.waitForTimeout(500);
    const repeated = await snapshot(page);
    assert.equal(repeated.count, expanded.count, '重复扫描不得改变译文数量');
    assert.equal(repeated.translatedLabels, expanded.translatedLabels, '重复扫描不得丢失原位控件译文');
    for (const id of staticIds) assert.equal(repeated.nodes[id].text, expanded.nodes[id].text, `重复扫描重译已有节点 ${id}`);
    assertInvariant(repeated, baseline, 'repeated');
    report.repeated = repeated;
    await clickInteractions(page);
    assert.deepEqual((await snapshot(page)).events, {save: 1, contact: 1, graph: 1, history: 1, portal: 0, expansion: 0});
    for (const id of ['epoch-more', 'tree-expand', 'workflow-portal']) await page.locator(`#${id}`).click();
    await waitForNodes(page, dynamicIds, 1, args.timeout, controlIds);
    await page.locator('#portal-duplicate').click();
    const dynamic = await snapshot(page);
    assertInvariant(dynamic, baseline, 'dynamic');
    assert.equal(dynamic.events.portal, 1);
    report.dynamic = dynamic;
    process.stdout.write('全部节点、重复扫描、展开和动态 portal 契约通过。\n');

    await action(popup, url, 'restore');
    await waitForNodes(page, [...staticIds, ...bodyIds, ...dynamicIds], 0, args.timeout);
    const restored = await snapshot(page);
    assert.equal(restored.count, 0, '恢复后仍有译文');
    assertInvariant(restored, baseline, 'restored');
    for (const id of [...staticIds, ...bodyIds]) assert.equal(restored.nodes[id].text, baseline.nodes[id].text, `恢复原文失败 ${id}`);
    for (const id of dynamicIds.filter(id => baseline.nodes[id])) assert.equal(restored.nodes[id].text, baseline.nodes[id].text, `动态节点恢复失败 ${id}`);
    assert.equal(restored.nodes['portal-duplicate'].text, 'Duplicate workflow');
    assert.equal(restored.nodes['portal-archive'].text, 'Archive workflow');
    await clickInteractions(page);
    report.restored = restored;
    await action(popup, url, 'fullPage');
    await waitForNodes(page, [...staticIds, ...bodyIds, ...dynamicIds], 1, args.timeout, controlIds);
    const retranslated = await snapshot(page);
    assertInvariant(retranslated, baseline, 'retranslated');
    assert.deepEqual(retranslated.events, {save: 2, contact: 2, graph: 2, history: 2, portal: 1, expansion: 1});
    report.retranslated = retranslated;
    await page.screenshot({path: path.join(args.artifactsDir, 'all-nodes-retranslated.png'), fullPage: true});
    await settings.setScope('content', 'fixture-off');
    const disabledActiveSession = await snapshot(page);
    assert.deepEqual(disabledActiveSession.nodes, retranslated.nodes, '关闭设置不应改动已有全部节点翻译');
    await action(popup, url, 'restore');
    await action(popup, url, 'fullPage');
    await waitForNodes(page, bodyIds, 1, args.timeout);
    const ordinaryAgain = await snapshot(page);
    for (const id of ordinaryExcludedIds) {
      assert.equal(ordinaryAgain.nodes[id].text, baseline.nodes[id].text, `关闭后普通模式仍翻译控件 ${id}`);
    }
    assertInvariant(ordinaryAgain, baseline, 'ordinary-after-setting-disabled');
    report.ordinaryAfterDisabled = ordinaryAgain;
    await action(popup, url, 'restore');
    await page.reload();
    await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    await action(popup, url, 'fullPage');
    await waitForNodes(page, bodyIds, 1, args.timeout);
    const afterRefresh = await snapshot(page);
    for (const id of ordinaryExcludedIds) {
      assert.equal(afterRefresh.nodes[id].text, baseline.nodes[id].text, `刷新后普通模式仍翻译控件 ${id}`);
    }
    report.afterRefresh = afterRefresh;
    await action(popup, url, 'restore');
    await settings.captureLayouts();
    assert(provider.requestCount() > 0, '确定性翻译 provider 未收到请求');
    const providerSource = provider.requestPayloads().flat().join('\n');
    for (const protectedText of [
      'private input unchanged', 'Private editor text remains untouched.', 'Editable draft remains untouched.',
      'Do not translate source code', 'Explicit translation exclusion remains untouched.',
      'Another explicit exclusion remains untouched.', 'Hidden application content remains untouched.', 'Vector drawing text',
    ]) assert(!providerSource.includes(protectedText), `受保护内容进入翻译请求：${protectedText}`);
    assert.deepEqual(unexpectedNetwork, [], '本地 fixture 意外访问外网');
    assert.deepEqual(workerErrors, [], 'service worker fixture 安装失败');
    assert.deepEqual(runtimeErrors, [], '页面运行异常');
    Object.assign(report, {passed: true, launchMode: session.launchMode, focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement, provider: 'freeTranslation / Microsoft loopback deterministic fixture',
      providerRequests: provider.requestCount(), translatedItems: provider.translatedItemCount(),
      lifecycleCounts: [expanded.count, restored.count, retranslated.count],
      controlLifecycleCounts: [expanded.translatedLabels, restored.translatedLabels, retranslated.translatedLabels], unexpectedNetwork, runtimeErrors, workerErrors});
    report.fixturePassed = true;
    if (args.liveEpoch) {
      await action(popup, url, 'restore');
      permitLivePageNetwork = true;
      report.fixtureProviderRequests = provider.requestCount();
      report.liveEpoch = await runLiveEpoch(page, popup, context, helper, settings, args, report);
      report.liveEpoch.providerRequests = provider.requestCount() - report.fixtureProviderRequests;
      report.providerRequests = provider.requestCount();
      report.translatedItems = provider.translatedItemCount();
      assert.deepEqual(report.liveEpoch.pageErrors, [], 'Epoch 页面运行异常');
      assert.deepEqual(unexpectedNetwork, [], 'Epoch 翻译请求意外访问真实 provider');
      assert.deepEqual(workerErrors, [], 'Epoch service worker fixture 安装失败');
    }
    fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({passed: true, artifactsDir: args.artifactsDir, lifecycleCounts: report.lifecycleCounts, launchMode: report.launchMode, windowPlacement: report.windowPlacement}, null, 2)}\n`);
  } catch (error) {
    report.passed = false;
    report.error = error.stack || String(error);
    if (/测试 Edge 进程 \d+ 成为了前台应用|隔离 Edge 意外成为前台应用/u.test(error.message)) {
      report.focusViolation = {detected: true, message: error.message};
      report.windowPlacementAtLastSuccessfulCheck = {...session?.windowPlacement};
      report.windowPlacement = {...session?.windowPlacement, browserFrontmost: true};
    }
    report.providerRequests = provider.requestCount();
    report.providerPayloads = provider.requestPayloads();
    if (page && !page.isClosed()) {report.failureState = await snapshot(page).catch(() => null);await page.screenshot({path: path.join(args.artifactsDir, 'failure.png'), fullPage: true}).catch(() => {});}
    fs.writeFileSync(path.join(args.artifactsDir, 'failure-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  } finally {
    await session?.close();
    await provider.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

if (require.main === module) main().catch(error => {process.stderr.write(`${error.stack || error}\n`);process.exitCode = 1;});
module.exports = {parseArgs, assertInvariant};
