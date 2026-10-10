'use strict';
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');

// 生产 Popup 冷文档与重复打开性能探针；只使用临时 Edge profile，不接触日常浏览器。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-popup-performance'));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const report = {extensionDir, samples: [], consoleErrors: []};
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-popup-perf-'));
fs.mkdirSync(artifactsDir, {recursive: true});

async function verifyLanguageMenus(page) {
  const target = page.locator('.language-pair .el-select').nth(1);
  if (!/简体中文/u.test(await target.innerText())) throw new Error('关闭菜单时未显示已保存的目标语言');
  if (await page.locator('.el-select-dropdown__item').count()) throw new Error('关闭菜单仍挂载语言选项');
  await target.locator('.el-select__wrapper').click();
  await target.locator('input').fill('Japanese');
  await page.locator('.el-select-dropdown:visible').getByRole('option', {name: /日本語/u}).waitFor({state: 'visible'});
  await target.locator('input').press('ArrowDown');
  await target.locator('input').press('Enter');
  await waitForAsyncCondition(() => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}))?.value?.to === 'ja'), {timeoutMs: 30000, message: "Popup 目标语言尚未持久化为日语"});
  if (!/日本語/u.test(await target.innerText())) throw new Error('键盘选择后标签未更新');
  await target.locator('.el-select__wrapper').click();
  await target.locator('input').press('Escape');
  await page.waitForFunction(() => !document.querySelector('.el-select-dropdown__item'));

  const patchConfig = async (patch, sequence) => page.evaluate(async ({patch, sequence}) => {
    const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const result = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
      expected: Object.fromEntries(Object.keys(patch).map(key => [key, current.value[key]])),
      clientId: 'popup-performance-ui', sequence, baseRevision: current.value.__fluentConfigRevision || 0});
    if (!result?.success) throw new Error(result?.error || '配置更新失败');
  }, {patch, sequence});
  await patchConfig({to: 'de', uiLanguage: 'en-US', theme: 'dark'}, 1);
  await page.waitForFunction(() => document.documentElement.lang === 'en-US' && document.body.innerText.includes('Settings'));
  await page.waitForFunction(() => /German|Deutsch/u.test(document.querySelectorAll('.language-pair .el-select')[1]?.textContent || ''));
  await page.locator('.popup-shell').screenshot({path: path.join(artifactsDir, 'popup-dark-en.png')});
  await patchConfig({uiLanguage: 'zh-CN'}, 2);
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && document.body.innerText.includes('设置'));
  const expected = (await target.innerText()).trim();
  await page.reload({waitUntil: 'load'});
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
  if ((await page.locator('.language-pair .el-select').nth(1).innerText()).trim() !== expected) throw new Error('重新打开后语言标签未保持');
  return {search: true, keyboardSelection: true, escape: true, closedOptions: 0, crossPageSync: true, languageRoundTrip: true, reopened: true};
}

async function verifyProviders(page, context, base) {
  const read = () => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value);
  const patch = async values => page.evaluate(async values => {
    const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const result = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: values,
      expected: Object.fromEntries(Object.keys(values).map(key => [key, current.value[key]])),
      clientId: 'popup-provider-layout', sequence: Date.now(), baseRevision: current.value.__fluentConfigRevision || 0});
    if (!result?.success) throw new Error(result?.error || 'provider config failed');
  }, values);
  const checkWidth = async () => {
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('Provider UI overflows');
  };
  const open = async () => { await page.locator('[data-testid="popup-feature-services"]').click(); await page.locator('.popup-provider-fields').waitFor(); };
  const choose = async (id, label) => {
    const field = page.locator(`[data-feature-service="${id}"]`);
    await field.locator('.el-select__wrapper').click();
    const combobox = field.getByRole('combobox');
    const list = await combobox.getAttribute('aria-controls');
    await page.locator(`#${list}`).getByRole('option', {name: label, exact: true}).click();
  };
  await patch({theme: 'light', to: 'zh-Hans'});
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await open();
  if (await page.locator('[data-feature-service]').count() !== 10) throw new Error('Missing feature assignments');
  if (await page.locator('.el-select-dropdown__item').count()) throw new Error('Closed provider menus mount hidden options');
  await page.locator('.popup-drawer').screenshot({path: path.join(artifactsDir, 'providers.png')});
  const before = await read();
  await choose('selection', '微软翻译');
  await choose('default', '谷歌翻译');
  await waitForAsyncCondition(() => page.evaluate(async () => {
    const c = (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value;
    return c.service === 'google' && c.selectionTranslationService === 'microsoft';
  }), {timeoutMs: 30000, message: "Popup 默认与划词服务分配尚未持久化"});
  let saved = await read();
  if (saved.hoverTranslationService !== before.hoverTranslationService || saved.videoService !== before.videoService) throw new Error('Assigning a feature changed another feature');
  await choose('selection', '跟随默认 · 谷歌翻译');
  await page.reload({waitUntil: 'load'});
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor();
  saved = await read();
  if (saved.selectionTranslationService !== '' || saved.service !== 'google') throw new Error('Quick close lost inherited assignment');
  await open();
  const reading = page.locator('[data-feature-service="reading"]');
  await reading.locator('.el-select__wrapper').click();
  let list = await reading.getByRole('combobox').getAttribute('aria-controls');
  if (await page.locator(`#${list}`).getByRole('option', {name: '微软翻译', exact: true}).count()) throw new Error('AI-only feature offers machine service');
  await reading.getByRole('combobox').press('Escape');
  const defaultField = page.locator('[data-feature-service="default"]');
  await defaultField.locator('.el-select__wrapper').click();
  await defaultField.getByRole('combobox').fill('gpt');
  list = await defaultField.getByRole('combobox').getAttribute('aria-controls');
  await page.locator(`#${list}`).getByRole('option', {name: 'OpenAI', exact: true}).waitFor();
  await defaultField.getByRole('combobox').press('Escape');
  if (await page.locator('.provider-drawer-actions, [data-testid="ai-context-help"]').count()) throw new Error('Removed provider footer actions are still mounted');
  await page.locator('.drawer-surface button[aria-label="关闭"]').click();
  await page.locator('.popup-drawer').waitFor({state: 'hidden'});
  if (await page.locator('[data-testid="ai-context-help"]:visible').count()) throw new Error('AI shortcut still in main popup');
  await page.locator('.popup-shell').screenshot({path: path.join(artifactsDir, 'popup-providers-assigned.png')});
  for (const skin of ['compact', 'minimal', 'default']) {
    await patch({interfaceSkin: skin});
    await page.waitForFunction(skin => document.querySelector('.popup-shell')?.dataset.interfaceSkin === skin, skin);
    await checkWidth();
    await page.locator('.popup-shell').screenshot({path: path.join(artifactsDir, `popup-${skin}.png`)});
  }
  const settings = await newPageWithoutForeground(context, 30000);
  settings.on('pageerror', error => report.consoleErrors.push(error.message));
  await settings.setViewportSize({width: 1440, height: 960});
  await settings.goto(`${base}/options.html#settings-services`);
  const catalog = settings.locator('.service-catalog');
  await catalog.waitFor();
  if (await settings.locator('.el-overlay:visible').count()) throw new Error('Service management still opens in an overlay');
  if (await settings.locator('#settings-services [data-testid="feature-services"]').count()) throw new Error('Feature assignments still appear in translation services');
  await settings.locator('[data-service-value="microsoft"]').click();
  if (await catalog.getAttribute('data-default-service') !== 'google') throw new Error('Editing a connection changed default');
  await settings.screenshot({path: path.join(artifactsDir, 'service-workspace.png')});
  await settings.setViewportSize({width: 390, height: 900});
  await settings.locator('.mobile-directory-toggle').click();
  await settings.locator('[data-service-value="google"]').click();
  if (await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Service page overflows mobile viewport');
  await settings.screenshot({path: path.join(artifactsDir, 'service-workspace-mobile.png')});
  await settings.setViewportSize({width: 1440, height: 960});
  await settings.goto(`${base}/options.html#settings-general`);
  await settings.locator('.search-box input').fill('功能分配');
  await settings.locator('.search-results button').filter({hasText: '功能分配'}).first().click();
  await settings.locator('#feature-services').waitFor();
  if (await settings.locator('#feature-services [data-feature-service]').count() !== 9) throw new Error('General settings are missing feature service assignments');
  await settings.locator('#feature-services').scrollIntoViewIfNeeded();
  await settings.screenshot({path: path.join(artifactsDir, 'general-assignments.png')});
  await settings.locator('#feature-services [data-feature-service="hover"] .feature-service-connection').click();
  await settings.locator('#settings-services .service-catalog').waitFor();
  if (await catalog.getAttribute('data-default-service') !== 'google') throw new Error('Opening feature connection changed default service');
  if (await settings.locator('#settings-services [data-feature-service]').count()) throw new Error('Feature connection opens assignments in service directory');
  await settings.goto(`${base}/options.html#settings-general`);
  const master = settings.locator('[data-testid="plugin-master-setting"]').getByRole('switch');
  await master.waitFor();
  const bounds = await master.boundingBox();
  if (bounds.y > 220) throw new Error('Global switch is not at the top of General settings');
  await settings.screenshot({path: path.join(artifactsDir, 'general-master.png')});
  // Offline fixtures exercise the production content lifecycle, without logging in or sending translation requests.
  const fixtures = [];
  for (const site of ['youtube', 'x']) {
    const url = site === 'youtube' ? 'https://www.youtube.com/watch?v=fluentread-global-switch' : 'https://x.com/FluentRead/status/123456/video/1';
    const container = site === 'youtube' ? 'id="movie_player" class="html5-video-player"' : 'data-testid="videoPlayer"';
    const controls = site === 'youtube' ? 'class="ytp-right-controls"' : 'class="fixture-controls"';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${site} switch fixture</title></head><body><main><article><div ${container} style="position:relative;width:800px;height:450px;background:#182434"><video muted controls style="width:100%;height:100%"></video><div ${controls} style="position:absolute;bottom:0;right:0;display:flex;height:40px"><button aria-label="Play">Play</button><button aria-label="Settings">Settings</button><button aria-label="Fullscreen">Fullscreen</button></div></div></article></main></body></html>`;
    await context.route(url, route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
    const fixture = await newPageWithoutForeground(context, 30000);
    await fixture.goto(url);
    await fixture.locator('.fluent-read-video-subtitle-button').waitFor({timeout: 20000});
    fixtures.push({site, page: fixture});
  }
  const preferencesBeforePause = await read();
  await master.click();
  await waitForAsyncCondition(() => settings.evaluate(async () => !(await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value.on), {timeoutMs: 30000, message: "Popup 全局暂停开关尚未持久化"});
  for (const fixture of fixtures) {
    await fixture.page.locator('.fluent-read-video-subtitle-button').waitFor({state: 'detached'});
    if (await fixture.page.locator('.fluent-read-video-ui').count()) throw new Error(`${fixture.site}: video UI remains after pause`);
    await fixture.page.screenshot({path: path.join(artifactsDir, `${fixture.site}-paused.png`)});
    await fixture.page.reload();
    await fixture.page.waitForTimeout(600);
    if (await fixture.page.locator('.fluent-read-video-ui').count()) throw new Error(`${fixture.site}: disabled UI reappears on reload`);
  }
  if ((await read()).videoTranslationEnabled !== preferencesBeforePause.videoTranslationEnabled) throw new Error('Global switch overwrote subtitle preferences');
  await master.click();
  for (const fixture of fixtures) {
    await fixture.page.locator('.fluent-read-video-subtitle-button').waitFor();
    await fixture.page.close();
  }
  report.globalSwitch = {topOfGeneral: true, youtubeRemoved: true, xRemoved: true, survivesReload: true, restored: true, preservesPreferences: true, fixture: 'offline DOM with production content scripts'};
  await settings.goto(`${base}/options.html#settings-selection`);
  await settings.locator('.harness-provider-row').waitFor();
  await settings.locator('.harness-provider-row').scrollIntoViewIfNeeded();
  await settings.screenshot({path: path.join(artifactsDir, 'selection-preferences.png')});
  const visibleSections = ['context', 'memory', 'instructions', 'speech'];
  for (const anchor of visibleSections) {
    const section = settings.locator(`[data-settings-anchor="${anchor}"]`);
    await section.scrollIntoViewIfNeeded();
    if (!await section.isVisible()) throw new Error(`Selection settings section is hidden: ${anchor}`);
    if (await section.locator('details:not([open]) textarea').count()) throw new Error('Instruction editor is hidden in a disclosure');
  }
  await settings.screenshot({path: path.join(artifactsDir, 'selection-preferences-visible.png')});
  report.disclosures = {commonPreferencesVisible: true, contextMemoryInstructionsAndSpeechVisible: true, visibleSections};
  await settings.close();
  report.providers = {independentAssignments: true, inheritDefault: true, quickClose: true, aiOnly: true, modelSearch: true, noHiddenOptions: true, localDrawer: true, stableServiceWorkspace: true, assignmentLocation: 'general', assignmentSearchAndConnectionLink: true, editingPreservesDefault: true, skins: ['default', 'minimal', 'compact']};
}

async function main() {
  let launched;
  try {
    launched = await launchFocusSafePersistentContext({
      chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      headless: false, background: true, viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    const {context} = launched;
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout: 30000});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    report.manifestEntrypoint = manifest.action.default_popup;
    // 用扩展自带图片文档调用真实配置端口，不加载 popup/options JS；配置实际由后台加密仓库保存。
    const setup = await newPageWithoutForeground(context, 30000);
    await setup.goto(`${extensionOrigin}/icon/128.png`);
    await setup.evaluate(async () => {
      const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!current?.success) throw new Error('无法读取性能测试配置');
      const patch = {uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', interfaceSkin: 'default', interfaceFont: 'system'};
      const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
        expected: Object.fromEntries(Object.keys(patch).map(key => [key, current.value[key]])),
        clientId: 'popup-performance-setup', sequence: 1, baseRevision: current.value.__fluentConfigRevision || 0});
      if (!response?.success) throw new Error(`无法准备性能测试配置: ${response?.error || '无响应'}`);
      const saved = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!saved?.value?.uiLanguageSetupCompleted) throw new Error('性能测试配置未持久化');
    });
    await setup.close();
    for (let index = 0; index < 7; index++) {
      const page = await newPageWithoutForeground(context, 30000);
      page.on('pageerror', error => report.consoleErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      await page.setViewportSize({width: 400, height: 600});
      await page.addInitScript(() => {
        window.__popupPerf = {readyMs: null, longTasks: [], treeWalks: 0};
        const original = Document.prototype.createTreeWalker;
        Document.prototype.createTreeWalker = function (...args) { window.__popupPerf.treeWalks++; return original.apply(this, args); };
        new PerformanceObserver(list => window.__popupPerf.longTasks.push(...list.getEntries().map(entry => ({start: entry.startTime, duration: entry.duration})))).observe({type: 'longtask', buffered: true});
        const observer = new MutationObserver(() => {
          if (document.querySelector('.popup-shell[data-config-ready="true"]') && window.__popupPerf.readyMs === null) {
            window.__popupPerf.readyMs = performance.now();
            requestAnimationFrame(() => { window.__popupPerf.frameMs = performance.now(); });
            observer.disconnect();
          }
        });
        observer.observe(document, {subtree: true, childList: true, attributes: true});
      });
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      await session.send('Network.enable');
      await session.send('Network.setCacheDisabled', {cacheDisabled: true});
      if (index === 0 && process.argv.includes('--cold-worker')) {
        // 仅操作本次隔离实例；首个配置请求必须重新唤醒扩展后台。
        const versions = new Map();
        session.on('ServiceWorker.workerVersionUpdated', event => {
          for (const version of event.versions) versions.set(version.versionId, version);
        });
        await session.send('ServiceWorker.enable');
        await session.send('ServiceWorker.stopAllWorkers');
        const deadline = Date.now() + 10000;
        while (![...versions.values()].some(version => version.scriptURL.startsWith(extensionOrigin) && version.runningStatus === 'stopped')) {
          if (Date.now() >= deadline) throw new Error('未确认隔离扩展后台已停止，不能报告后台冷启动数据');
          await page.waitForTimeout(50);
        }
        report.coldWorkerStopped = true;
      }
      await page.goto(`${extensionOrigin}/${manifest.action.default_popup}`, {waitUntil: 'load'});
      await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
      if (await page.locator('.language-onboarding-shell').count()) throw new Error('正常菜单性能用例意外进入首次安装引导');
      await page.waitForTimeout(250);
      const sample = await page.evaluate(() => ({...window.__popupPerf,
        domNodes: document.querySelectorAll('*').length,
        hiddenOptions: document.querySelectorAll('.el-select-dropdown__item').length,
        width: document.querySelector('.popup-shell').getBoundingClientRect().width,
        height: document.querySelector('.popup-shell').getBoundingClientRect().height,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      const {metrics} = await session.send('Performance.getMetrics');
      sample.metrics = Object.fromEntries(metrics.filter(item => ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'JSHeapUsedSize', 'LayoutCount'].includes(item.name)).map(item => [item.name, item.value]));
      sample.index = index;
      report.samples.push(sample);
      if (index === 0) {
        await page.locator('.popup-shell').screenshot({path: path.join(artifactsDir, 'popup.png')});
        // 记录浏览器实际解析的脚本字节，不依赖扩展协议缺失的 Resource Timing。
        const parsed = new Set();
        session.on('Debugger.scriptParsed', event => { if (event.url.startsWith(extensionOrigin)) parsed.add(new URL(event.url).pathname); });
        await session.send('Debugger.enable');
        report.initialScripts = [...parsed].map(file => ({file, bytes: fs.statSync(path.join(extensionDir, file)).size}));
        report.initialScriptBytes = report.initialScripts.reduce((sum, item) => sum + item.bytes, 0);
      }
      if (index === 6 && process.argv.includes('--verify-ui')) {
        await page.setViewportSize({width: Math.ceil(sample.width), height: Math.max(440, Math.ceil(sample.height))});
        report.languageMenus = await verifyLanguageMenus(page);
        const features = await page.locator('[data-popup-quick-feature]').evaluateAll(items => items.map(item => item.dataset.popupQuickFeature));
        if (features.join(',') !== 'hover,selection,image,document') throw new Error('Popup 默认快捷入口不正确');
        if (await page.locator('.popup-header [role="switch"]').count()) throw new Error('Popup 仍有插件总开关');
        if (await page.locator('.translate-action').count()) throw new Error('Popup 仍有重复网页翻译按钮');
        await page.locator('[data-popup-quick-feature="image"]').click();
        const imageSwitch = page.getByRole('switch', {name: '启用或关闭图片翻译', exact: true});
        const areaSwitch = page.getByRole('switch', {name: '启用或关闭圈选翻译', exact: true});
        await areaSwitch.waitFor();
        const beforeImage = await imageSwitch.getAttribute('aria-checked');
        const beforeArea = await areaSwitch.getAttribute('aria-checked');
        await imageSwitch.click();
        if (await areaSwitch.getAttribute('aria-checked') !== beforeArea) throw new Error('图片开关影响圈选偏好');
        await imageSwitch.click();
        await areaSwitch.click();
        if (await imageSwitch.getAttribute('aria-checked') !== beforeImage) throw new Error('圈选开关影响图片偏好');
        await areaSwitch.click();
        await page.locator('.popup-drawer').screenshot({path: path.join(artifactsDir, 'popup-image-area.png')});
        await page.locator('.drawer-header button').click();
        await page.locator('[data-popup-quick-feature="hover"]').click();
        await page.locator('[data-testid="section-translation"]').waitFor();
        await page.locator('.popup-drawer').screenshot({path: path.join(artifactsDir, 'popup-hover.png')});
        await page.locator('.drawer-header button').click();
        report.compactWorkflow = {features, imageAndAreaIndependent: true, sectionActionReachable: true};
        if (process.argv.includes('--verify-providers')) await verifyProviders(page, context, extensionOrigin);
      }
      await session.detach();
      await page.close();
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    report.median = {readyMs: median(report.samples.map(item => item.readyMs)), frameMs: median(report.samples.map(item => item.frameMs)), scriptMs: median(report.samples.map(item => item.metrics.ScriptDuration * 1000))};
    report.ok = report.consoleErrors.length === 0 && report.samples.every(item => !item.overflowX && item.height <= 600);
    if (!report.ok) throw new Error('Popup 性能采样发现控制台或布局异常');
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close().catch(() => {});
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
  console.log(JSON.stringify({ok: report.ok, median: report.median, initialScriptBytes: report.initialScriptBytes, first: report.samples[0]}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
