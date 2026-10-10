'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');

// Focused production Popup/options proof for the compact quick-settings surface.
// This runner intentionally owns only test artifacts and a temporary Edge profile.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = path.resolve(arg(
  'playwright-root',
  '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
));
const focusSafeHelper = path.resolve(arg(
  'focus-safe-helper',
  path.join(__dirname, 'focus-safe-browser.cjs'),
));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-popup-quick-settings-ui'));
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const timeout = Number(arg('timeout', '30000'));
const displayTarget = arg('display', 'secondary');

if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`扩展产物不存在：${extensionDir}`);
if (!fs.existsSync(focusSafeHelper)) throw new Error(`防抢焦点 helper 不存在：${focusSafeHelper}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {
  launchFocusSafePersistentContext,
  newPageWithoutForeground,
} = require(focusSafeHelper);

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details === undefined ? '' : `: ${JSON.stringify(details)}`}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pageErrors(errors, page) {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function shot(page, name) {
  await sleep(500);
  const target = path.join(artifactsDir, name);
  await page.screenshot({path: target, fullPage: false});
  return target;
}

async function waitPopup(page, timeoutMs) {
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible', timeout: timeoutMs});
  await page.locator('.popup-shell').evaluate(node => {
    if (node.getAttribute('aria-busy') !== 'false') throw new Error('Popup remains busy after config hydration');
  });
}

async function waitOptions(page, timeoutMs) {
  await page.locator('.settings-app').waitFor({state: 'visible', timeout: timeoutMs});
  await page.locator('nav[aria-label="设置分类"] button').first().waitFor({state: 'visible', timeout: timeoutMs});
}

async function openPage(context, url, timeoutMs, errors) {
  const page = await newPageWithoutForeground(context, timeoutMs);
  pageErrors(errors, page);
  if (url.includes('/popup.html')) await page.setViewportSize({width: 360, height: 560});
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: timeoutMs});
  return page;
}

async function readConfig(page) {
  return page.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!result?.success || !result.value) throw new Error('无法读取已保存配置');
    return result.value;
  });
}

async function applyTheme(page, theme) {
  const current = await readConfig(page);
  const response = await page.evaluate(config => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'replace', config}), {...current, theme});
  assert(response?.success, '测试主题设置失败');
  await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
}

async function selectDifferent(page, selector, timeoutMs) {
  const control = page.locator(selector).first();
  await control.waitFor({state: 'visible', timeout: timeoutMs});
  const before = await control.locator('.el-select__selected-item:not(.el-select__input-wrapper)').textContent().catch(() => '');
  await control.click();
  const options = page.locator('.el-select-dropdown__item:not(.is-disabled):visible');
  await options.first().waitFor({state: 'visible', timeout: timeoutMs});
  const labels = await options.allTextContents();
  const index = labels.findIndex(label => label.trim() && label.trim() !== before.trim());
  assert(index >= 0, `没有可切换的选项 ${selector}`, {before, labels});
  await options.nth(index).click();
  return {before: before.trim(), after: labels[index].trim()};
}

async function openDrawer(page, id, timeoutMs) {
  const card = page.locator(`[data-popup-quick-feature="${id}"]`);
  await card.waitFor({state: 'visible', timeout: timeoutMs});
  await card.click();
  const drawer = page.locator('.drawer-surface');
  await drawer.waitFor({state: 'visible', timeout: timeoutMs});
  await sleep(400);
  return drawer;
}

async function closeDrawer(page, timeoutMs) {
  const close = page.locator('.drawer-surface button[aria-label="关闭"]').first();
  await close.click();
  await page.locator('.drawer-surface').waitFor({state: 'hidden', timeout: timeoutMs});
}

async function inspectPopup(page, report, timeoutMs) {
  await waitPopup(page, timeoutMs);
  const metrics = await page.locator('.popup-shell').evaluate(shell => {
    const rect = shell.getBoundingClientRect();
    const html = document.documentElement;
    const body = document.body;
    return {
      width: rect.width,
      height: rect.height,
      scrollWidth: shell.scrollWidth,
      clientWidth: shell.clientWidth,
      horizontalOverflow: [html, body, shell].some(node => node.scrollWidth > node.clientWidth + 1),
      featureIds: [...shell.querySelectorAll('[data-popup-quick-feature]')].map(node => node.getAttribute('data-popup-quick-feature')),
      duplicateIds: [...document.querySelectorAll('[id]')].map(node => node.id).filter((id, index, ids) => ids.indexOf(id) !== index),
      unlabeledControls: [...shell.querySelectorAll('button, input, select, textarea')]
        .filter(node => node.getAttribute('aria-label') === null && !node.textContent?.trim() && !node.getAttribute('title'))
        .map(node => node.outerHTML.slice(0, 160)),
    };
  });
  assert(metrics.width <= 400, 'Popup 宽度超过 400 CSS px', metrics);
  assert(!metrics.horizontalOverflow, 'Popup 存在横向滚动', metrics);
  assert(metrics.featureIds.includes('hover') && metrics.featureIds.includes('selection')
    && metrics.featureIds.includes('appearance') && metrics.featureIds.includes('image')
    && metrics.featureIds.includes('area') && metrics.featureIds.includes('video'), '快捷入口缺少目标功能', metrics);
  assert(metrics.duplicateIds.length === 0, 'Popup 存在重复 ID', metrics);
  report.layout.popup = metrics;
  report.screenshots.push(await shot(page, 'popup-light.png'));
  return metrics;
}

async function seedCompatibilityConfig(page) {
  return page.evaluate(async () => {
    const config = {
      on: true,
      service: 'freeTranslation',
      display: 1,
      from: 'auto',
      to: 'ja',
      uiLanguage: 'zh-CN',
      uiLanguageSetupCompleted: true,
      popupQuickFeatureVisibility: {appearance: true},
      selectionTranslatorMode: 'translation-only',
      videoTranslationEnabled: true,
      videoSubtitleVisible: false,
      videoSubtitleDisplayMode: 'original-only',
      videoService: 'microsoft',
      videoLocalModel: 'base',
      videoSourceLanguage: 'ko',
      videoSubtitleAppearance: {fontScale: 140, bottomOffset: 9},
      hotkey: 'custom',
      customHotkey: 'Alt+J',
      selectionTranslatorTrigger: 'custom',
      customSelectionTranslatorHotkey: 'Alt+K',
      selectionTranslatorDelay: 450,
      selectionTtsVoices: ['en-US-AriaNeural'],
      style: 4,
      theme: 'light',
    };
    const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'replace', config});
    if (!response?.success) throw new Error(`兼容性配置写入失败: ${response?.error || 'unknown error'}`);
    return response;
  });
}

async function migrationCase(context, origin, errors, report, timeoutMs) {
  const seedPage = await openPage(context, `${origin}/options.html#settings-general`, timeoutMs, errors);
  await waitOptions(seedPage, timeoutMs);
  const seedResponse = await seedCompatibilityConfig(seedPage);
  await seedPage.close();
  await sleep(500);

  const popup = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await inspectPopup(popup, report, timeoutMs);
  const popupState = await popup.evaluate(() => ({
    target: document.querySelector('.el-select:has([aria-label="目标语言"]) .el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || '',
    featureIds: [...document.querySelectorAll('[data-popup-quick-feature]')].map(node => node.getAttribute('data-popup-quick-feature')),
  }));
  assert(popupState.featureIds.includes('selection') && popupState.featureIds.includes('video'), '迁移后快捷入口未挂载', popupState);

  const selection = await openDrawer(popup, 'selection', timeoutMs);
  const selectionModes = await selection.locator('.chips[aria-label="划词翻译模式"] button').allTextContents();
  assert(selectionModes.map(text => text.trim()).join('|') === '关闭|双语显示|仅译文', '迁移后划词三态不完整', selectionModes);
  assert(await selection.locator('.chips button.selected').textContent() === '仅译文', '迁移后的划词模式未保留', await selection.locator('.chips button').allTextContents());
  await closeDrawer(popup, timeoutMs);

  const video = await openDrawer(popup, 'video', timeoutMs);
  assert(await video.locator('button').filter({hasText: '显示字幕'}).count() === 1, '迁移后的隐藏字幕状态未保留');
  await video.locator('button').filter({hasText: '显示字幕'}).click();
  assert(await video.locator('.chips[aria-label="字幕显示模式"] button').count() === 3, '字幕恢复后没有三种显示模式');
  assert(await video.locator('.chips button.selected').textContent() === '仅原文', '迁移后的字幕模式未保留');
  report.screenshots.push(await shot(popup, 'popup-migration-video-restored.png'));
  await closeDrawer(popup, timeoutMs);
  report.migration = {
    ok: true,
    method: 'runtime-persisted-compatibility-snapshot',
    seedResponse,
    popupState,
    selectionModes,
    retainedSelectionMode: 'translation-only',
    retainedVideoMode: 'original-only',
    hiddenVideoRestored: true,
  };
  await popup.close();
}

async function drawerCases(context, origin, errors, report, timeoutMs) {
  const page = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(page, timeoutMs);
  const cases = {};
  for (const id of ['hover', 'selection', 'appearance', 'image', 'area', 'video']) {
    const drawer = await openDrawer(page, id, timeoutMs);
    const text = (await drawer.textContent()) || '';
    const link = drawer.locator('.drawer-settings-link');
    assert(await link.count() === 1, `${id} 缺少完整设置入口`);
    if (id === 'hover') {
      assert(await drawer.getByRole('button', {name: '关闭默认悬浮快捷键', exact: true}).count() === 1, '悬停抽屉关闭入口缺失');
      assert(await drawer.locator('.chips').count() === 0, '悬停抽屉仍显示快捷键编辑器');
      assert(!text.includes('悬停翻译延迟') && !text.includes('触发快捷键'), '悬停抽屉仍暴露已移除参数');
    } else if (id === 'selection') {
      const buttons = drawer.locator('.chips[aria-label="划词翻译模式"] button');
      assert(await buttons.count() === 3, '划词抽屉三态选择缺失');
      assert((await buttons.allTextContents()).map(value => value.trim()).join('|') === '关闭|双语显示|仅译文', '划词抽屉模式顺序异常');
      for (const label of ['关闭', '双语显示', '仅译文']) {
        await buttons.filter({hasText: label}).click();
        assert(await buttons.filter({hasText: label}).getAttribute('aria-pressed') === 'true', `划词状态未切换到 ${label}`);
      }
      assert(await drawer.locator('.drawer-content input, .drawer-content .el-select').count() === 0, '划词抽屉仍暴露长期参数控件');
    } else if (id === 'appearance') {
      const buttons = drawer.locator('.chips[aria-label="翻译模式"] button');
      assert(await buttons.count() === 2, '译文显示抽屉模式选择缺失');
      assert(!text.includes('译文样式') && !text.includes('界面主题'), '译文显示抽屉仍暴露长期参数');
    } else if (id === 'video') {
      assert(await drawer.locator('.video-quick-settings').count() === 1, '视频抽屉缺少精简容器');
      assert(await drawer.locator('[role="switch"]').count() === 1, '视频抽屉开关数量异常');
      if (await drawer.locator('.chips[aria-label="字幕显示模式"]').count()) {
        assert(await drawer.locator('.chips[aria-label="字幕显示模式"] button').count() === 3, '视频字幕模式不是三态');
      }
      const modes = drawer.locator('.chips[aria-label="字幕显示模式"] button');
      for (const label of ['双语', '仅译文', '仅原文']) {
        const choice = drawer.getByRole('button', {name: label, exact: true});
        await choice.click();
        assert(await choice.getAttribute('aria-pressed') === 'true', `视频模式未切换到 ${label}`);
      }
      const enabled = drawer.locator('[role="switch"]');
      await enabled.click();
      assert(await modes.count() === 0, '关闭视频后仍显示模式控件');
      await enabled.click();
      assert(await drawer.locator('.chips button.selected').textContent() === '仅原文', '重开视频丢失显示模式');
      assert(!text.includes('视频翻译服务') && !text.includes('视频原语言') && !text.includes('字幕字号'), '视频抽屉仍暴露长期参数');
    }
    cases[id] = {text: text.slice(0, 600), settingsRoute: await link.getAttribute('data-i18n-ignore') !== null};
    const measured = await drawer.evaluate(node => {
      const body = node.closest('.el-drawer__body');
      return {height: node.getBoundingClientRect().height, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, width: node.getBoundingClientRect().width};
    });
    assert(measured.scrollHeight <= measured.clientHeight + 1, `${id} 抽屉仍需滚动`, measured);
    cases[id].layout = measured;
    report.screenshots.push(await shot(page, `drawer-${id}-light.png`));
    if (id === 'video' || id === 'selection') {
      await applyTheme(page, 'dark');
      report.screenshots.push(await shot(page, `drawer-${id}-dark.png`));
      await applyTheme(page, 'light');
    }
    await closeDrawer(page, timeoutMs);
  }
  const retained = await readConfig(page);
  const preferences = {videoService: 'microsoft', videoLocalModel: 'base', videoSourceLanguage: 'ko', customHotkey: 'Alt+J', selectionTranslatorTrigger: 'custom', customSelectionTranslatorHotkey: 'Alt+K', selectionTranslatorDelay: 450, selectionTtsVoices: ['en-US-AriaNeural'], style: 4};
  for (const [key, value] of Object.entries(preferences)) assert(JSON.stringify(retained[key]) === JSON.stringify(value), `迁出的设置被修改: ${key}`, retained[key]);
  assert(retained.videoSubtitleAppearance.fontScale === 140, '字幕字号未保留');
  report.retainedPreferences = preferences;
  report.caseCoverage.drawers = cases;
  await page.close();
}

async function settingsLinkCases(context, origin, errors, report, timeoutMs) {
  const expected = {hover: 'settings-translation', selection: 'settings-translation', appearance: 'settings-interface', image: 'settings-image-translation', area: 'settings-area-translation', video: 'settings-video'};
  const results = {};
  for (const [id, hash] of Object.entries(expected)) {
    const popup = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
    await waitPopup(popup, timeoutMs);
    const drawer = await openDrawer(popup, id, timeoutMs);
    const link = drawer.locator('.drawer-settings-link');
    const opened = context.waitForEvent('page', {timeout: timeoutMs});
    await link.click();
    const options = await opened;
    await options.waitForURL(url => url.pathname.endsWith('/options.html'), {timeout: timeoutMs});
    pageErrors(errors, options);
    await waitOptions(options, timeoutMs);
    results[id] = new URL(options.url()).hash;
    assert(results[id] === `#${hash}`, `${id} 完整设置入口路由错误`, results[id]);
    await options.close();
    await popup.close();
  }
  report.caseCoverage.settingsLinks = results;
}

async function hoverShortcutCase(context, origin, errors, report, timeoutMs) {
  const popup = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(popup, timeoutMs);
  const drawer = await openDrawer(popup, 'hover', timeoutMs);
  await drawer.getByRole('button', {name: '关闭默认悬浮快捷键', exact: true}).click();
  await drawer.getByRole('button', {name: '选择快捷键', exact: true}).waitFor({state: 'visible'});
  await popup.close();
  const reopened = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(reopened, timeoutMs);
  const disabled = await readConfig(reopened);
  assert(disabled.hotkey === 'none' && disabled.customHotkey === 'Alt+J', '关闭悬停后自定义组合丢失或被固定替换', {hotkey: disabled.hotkey, customHotkey: disabled.customHotkey});
  const disabledDrawer = await openDrawer(reopened, 'hover', timeoutMs);
  report.screenshots.push(await shot(reopened, 'drawer-hover-disabled.png'));
  const opened = context.waitForEvent('page', {timeout: timeoutMs});
  await disabledDrawer.getByRole('button', {name: '选择快捷键', exact: true}).click();
  const options = await opened;
  await options.waitForURL(url => url.pathname.endsWith('/options.html'), {timeout: timeoutMs});
  pageErrors(errors, options);
  await waitOptions(options, timeoutMs);
  assert(new URL(options.url()).hash === '#settings-translation', '重新选择快捷键没有进入翻译设置');
  assert((await readConfig(options)).hotkey === 'none', '导航到设置页时隐式启用了 Control');
  await options.locator('.el-select:has([aria-label="鼠标悬浮快捷键"])').click();
  await options.locator('.el-select-dropdown__item:visible').filter({hasText: '自定义快捷键'}).click();
  await options.close();
  await reopened.close();
  const restored = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(restored, timeoutMs);
  const restoredConfig = await readConfig(restored);
  assert(restoredConfig.hotkey === 'custom' && restoredConfig.customHotkey === 'Alt+J', '重新选择自定义快捷键没有保存原组合', {hotkey: restoredConfig.hotkey, customHotkey: restoredConfig.customHotkey});
  report.caseCoverage.hoverShortcut = {disabledAfterReopen: true, savedCustomHotkey: 'Alt+J', settingsRoute: '#settings-translation', noImplicitControl: true, explicitlyRestored: true};
  await restored.close();
}

async function persistenceCases(context, origin, errors, report, timeoutMs) {
  const popup = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(popup, timeoutMs);
  const before = await popup.locator('.el-select:has([aria-label="目标语言"]) .el-select__selected-item:not(.el-select__input-wrapper)').textContent();
  const language = await selectDifferent(popup, '.el-select:has([aria-label="目标语言"])', timeoutMs);
  await popup.locator('.service-field').click();
  const services = popup.locator('[data-service-value]');
  await services.first().waitFor({state: 'visible', timeout: timeoutMs});
  const serviceValues = await services.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-service-value')));
  const serviceIndex = serviceValues.findIndex(value => value && value !== 'freeTranslation');
  assert(serviceIndex >= 0, '没有可切换的 Popup 服务');
  await services.nth(serviceIndex).click();
  const selectedService = serviceValues[serviceIndex];
  const snapshot = {before: before?.trim() || '', after: language.after, service: selectedService};
  report.persistenceCases.push({case: 'popup-language-service', ...snapshot, closedImmediatelyAfterChange: true});
  report.quickClose = {popup: true, changed: snapshot};
  await popup.close();
  await sleep(700);

  const reopened = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(reopened, timeoutMs);
  const after = await reopened.locator('.el-select:has([aria-label="目标语言"]) .el-select__selected-item:not(.el-select__input-wrapper)').textContent();
  const serviceAfter = await reopened.locator('.service-field').getAttribute('data-selected-model').catch(() => null);
  assert(after?.trim() === language.after, 'Popup 快速关闭后语言没有保存', {expected: language.after, actual: after});
  assert((await readConfig(reopened)).service === selectedService, 'Popup 快速关闭后服务没有保存');
  report.persistenceCases.push({case: 'popup-reopen', value: after?.trim() || '', serviceSelected: serviceAfter});
  report.screenshots.push(await shot(reopened, 'popup-reopened-persisted.png'));
  await reopened.close();

  const options = await openPage(context, `${origin}/options.html#settings-general`, timeoutMs, errors);
  await waitOptions(options, timeoutMs);
  const stateSwitch = options.locator('[aria-label="插件状态"]');
  await options.locator('.el-switch:has([aria-label="插件状态"]) .el-switch__core').click();
  const optionLanguage = await selectDifferent(options, '[data-config-field="to"]', timeoutMs);
  report.persistenceCases.push({case: 'options-toggle-language', changed: optionLanguage, switchAriaChecked: await stateSwitch.getAttribute('aria-checked')});
  report.crossPageSync = {optionsChanged: true, popupReopen: false};
  await options.close();
  await sleep(700);
  const crossPopup = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(crossPopup, timeoutMs);
  const crossValue = await crossPopup.locator('.el-select:has([aria-label="目标语言"]) .el-select__selected-item:not(.el-select__input-wrapper)').textContent();
  assert(crossValue?.trim() === optionLanguage.after, 'Options 修改后跨页 Popup 没有同步最终语言', {expected: optionLanguage.after, actual: crossValue});
  report.crossPageSync = {optionsChanged: true, popupReopen: true, expected: optionLanguage.after, actual: crossValue?.trim() || ''};
  report.screenshots.push(await shot(crossPopup, 'popup-cross-page-persisted.png'));
  await crossPopup.close();

  const latest = await openPage(context, `${origin}/options.html#settings-general`, timeoutMs, errors);
  await waitOptions(latest, timeoutMs);
  const firstWrite = await selectDifferent(latest, '[data-config-field="to"]', timeoutMs);
  const secondWrite = await selectDifferent(latest, '[data-config-field="to"]', timeoutMs);
  await latest.close();
  await sleep(700);
  const finalPopup = await openPage(context, `${origin}/popup.html`, timeoutMs, errors);
  await waitPopup(finalPopup, timeoutMs);
  const finalValue = await finalPopup.locator('.el-select:has([aria-label="目标语言"]) .el-select__selected-item:not(.el-select__input-wrapper)').textContent();
  assert(finalValue?.trim() === secondWrite.after, '连续写入没有保持最新值', {firstWrite, secondWrite, finalValue});
  report.latestWriteWins = {first: firstWrite.after, second: secondWrite.after, final: finalValue?.trim() || '', passed: true};
  await finalPopup.close();
}

async function optionsResponsive(context, origin, errors, report, timeoutMs) {
  const page = await openPage(context, `${origin}/options.html#settings-general`, timeoutMs, errors);
  await waitOptions(page, timeoutMs);
  const nav = page.locator('nav[aria-label="设置分类"] button');
  const ids = await nav.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-section')));
  assert(ids.length >= 8 && new Set(ids).size === ids.length, '设置导航数量或 ID 异常', ids);
  for (const id of ids) {
    await page.locator(`button[data-section="${id}"]`).click();
    await page.waitForFunction(expected => location.hash === `#${expected}`, id, {timeout: timeoutMs});
  }
  report.caseCoverage.optionsNavigation = {count: ids.length, ids};
  await page.locator('button[data-section="settings-general"]').click();
  await page.setViewportSize({width: 390, height: 900});
  const narrow = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  assert(!narrow.overflow, '390px 设置页存在横向滚动', narrow);
  report.layout.optionsNarrow = narrow;
  report.screenshots.push(await shot(page, 'options-narrow-light.png'));
  await applyTheme(page, 'dark');
  report.screenshots.push(await shot(page, 'options-narrow-dark.png'));

  await applyTheme(page, 'light');
  await page.setViewportSize({width: 1200, height: 900});
  await applyTheme(page, 'light');
  await page.locator('button[data-section="settings-video"]').click();
  const videoEnable = page.locator('button[aria-label="视频字幕翻译"]');
  if (await videoEnable.getAttribute('aria-checked') !== 'true') await videoEnable.click();
  const modelList = page.locator('.video-model-list');
  await modelList.waitFor({state: 'visible', timeout: timeoutMs});
  const modelCards = modelList.locator('.video-model-card');
  const modelCount = await modelCards.count();
  assert(modelCount >= 2, '视频本地模型卡片数量不足', {modelCount});
  const initialModel = await modelList.locator('input[name="video-local-model"]:checked').getAttribute('value').catch(() => null);
  const otherCard = modelCards.nth(initialModel === 'tiny' ? 1 : 0);
  const otherModel = await otherCard.locator('input[name="video-local-model"]').getAttribute('value');
  await otherCard.locator('.video-model-description').click();
  const selectedAfterDescription = await modelList.locator('input[name="video-local-model"]:checked').getAttribute('value').catch(() => null);
  const capabilityDisabled = await otherCard.evaluate(card => card.classList.contains('disabled'));
  if (!capabilityDisabled) assert(selectedAfterDescription === otherModel, '点击模型卡片描述没有选择该模型', {initialModel, otherModel, selectedAfterDescription});

  report.screenshots.push(await shot(page, 'options-video-models-light.png'));
  const canToggleVideo = await videoEnable.count() > 0 && !(await videoEnable.isDisabled().catch(() => true));
  let disabledModel = selectedAfterDescription;
  if (canToggleVideo) {
    await videoEnable.click();
    assert(await videoEnable.getAttribute('aria-checked') === 'false', '视频关闭按钮状态错误');
    await page.waitForFunction(() => [...document.querySelectorAll('input[name="video-local-model"]')].every(input => input.disabled));
    assert((await readConfig(page)).videoTranslationEnabled === false, '视频关闭未保存');
    disabledModel = await modelList.locator('input[name="video-local-model"]:checked').getAttribute('value').catch(() => null);
    await modelCards.nth(disabledModel === 'tiny' ? 1 : 0).locator('.video-model-description').click();
    const selectedWhileDisabled = await modelList.locator('input[name="video-local-model"]:checked').getAttribute('value').catch(() => null);
    assert(selectedWhileDisabled === disabledModel, '关闭视频字幕后模型卡片仍可改变选择', {disabledModel, selectedWhileDisabled});
  }
  const downloading = await modelList.locator('.video-model-download-button.is-loading').count();
  assert(downloading === 0, '模型卡片描述点击意外开始下载', {downloading});
  report.caseCoverage.videoModelCards = {
    modelCount,
    initialModel,
    selectedAfterDescription,
    capabilityDisabled,
    disabledSelectionRetained: canToggleVideo,
    downloading,
  };
  const advancedAppearance = page.locator('.subtitle-appearance-advanced');
  assert(await advancedAppearance.getAttribute('open') === null, '低频字幕外观设置默认展开');
  await page.locator('[data-skin="clean"].subtitle-skin-option').click();
  await advancedAppearance.locator('summary').click();
  const fontSize = page.locator('input[aria-label="字幕字号"]');
  assert(await fontSize.inputValue() === '140', '配置草稿替换后字号未保留');
  await fontSize.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('[data-video-subtitle-preview]')?.style.getPropertyValue('--fluent-read-video-subtitle-preview-font-size') === '16.9px');
  // 预览只证明 Vue 草稿已更新，不能代表异步后台持久化已经完成。
  // 皮肤选择会产生多个字段保存；短暂读到目标值后仍可能收到前序提交。
  // 连续确认目标值稳定，再由下方的关闭重开断言验证最终结果。
  const appearanceDeadline = Date.now() + timeoutMs;
  let appearanceStableSince = 0;
  while (Date.now() < appearanceDeadline) {
    const saved = (await readConfig(page)).videoSubtitleAppearance;
    if (saved.skin === 'clean' && saved.fontScale === 130) {
      appearanceStableSince ||= Date.now();
      if (Date.now() - appearanceStableSince >= 500) break;
    } else {
      appearanceStableSince = 0;
    }
    await sleep(100);
  }
  assert(appearanceStableSince > 0 && Date.now() - appearanceStableSince >= 500, '字幕外观保存未稳定');
  const appearance = (await readConfig(page)).videoSubtitleAppearance;
  assert(appearance.skin === 'clean' && appearance.fontScale === 130, '设置页替换草稿后字幕外观无法保存', appearance);
  report.caseCoverage.subtitleAppearance = {collapsedInitially: true, updatedAfterDraftReplacement: true, skin: appearance.skin, fontScale: appearance.fontScale};
  await page.locator('button[data-section="settings-translation"]').click();
  const voices = page.locator('.el-select:has([aria-label="划词翻译语音回退顺序"])');
  await voices.scrollIntoViewIfNeeded();
  assert((await readConfig(page)).selectionTtsVoices.includes('en-US-AriaNeural'), '迁入设置页的音色丢失');
  await voices.click();
  await page.locator('.el-select-dropdown__item:not(.is-selected):visible').first().click();
  await page.keyboard.press('Escape');
  await sleep(300);
  const editedVoices = (await readConfig(page)).selectionTtsVoices;
  assert(editedVoices.length === 2, '迁入的音色选择器不能编辑', editedVoices);
  report.screenshots.push(await shot(page, 'options-selection-voices.png'));
  await page.close();
  const reopenedVoices = await openPage(context, `${origin}/options.html#settings-translation`, timeoutMs, errors);
  await waitOptions(reopenedVoices, timeoutMs);
  assert(JSON.stringify((await readConfig(reopenedVoices)).selectionTtsVoices) === JSON.stringify(editedVoices), '迁入的音色设置重开丢失');
  const reopenedAppearance = (await readConfig(reopenedVoices)).videoSubtitleAppearance;
  assert(reopenedAppearance.skin === 'clean' && reopenedAppearance.fontScale === 130, '字幕外观重开丢失', reopenedAppearance);
  report.caseCoverage.movedVoices = {editedVoices, reopened: true};
  await reopenedVoices.close();
}

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-popup-quick-settings-edge-'));
  const errors = [];
  const report = {
    ok: false,
    suite: 'popup-quick-settings-focused',
    artifactKind: path.basename(extensionDir) === 'chrome-mv3' ? 'production' : 'dev',
    extensionDir,
    artifactsDir,
    browser: 'Microsoft Edge',
    profileDir,
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    manifest: null,
    layout: {},
    caseCoverage: {},
    persistenceCases: [],
    quickClose: {},
    crossPageSync: {},
    latestWriteWins: {},
    migration: {ok: false, attempted: true},
    consoleErrors: errors,
    screenshots: [],
    fullSuiteBaseline: {
      status: 'not-run-by-focused-runner',
      note: 'full UI runner 独立运行；结果见交付报告，专项结果不代表完整套件通过。',
    },
  };
  let launched, primaryError;
  let launchAttempted = false;
  try {
    report.manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    assert(typeof (report.manifest.action?.default_popup || report.manifest.browser_action?.default_popup) === 'string', 'manifest 缺少 Popup');
    assert(typeof (report.manifest.options_page || report.manifest.options_ui?.page) === 'string', 'manifest 缺少 options');
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      displayTarget,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: {width: 1440, height: 1000},
      timeout,
    });
    guardBrowserClose(launched, profileDir);
    report.launchMode = launched.launchMode;
    report.focusPolicy = launched.focusPolicy;
    report.windowPlacement = launched.windowPlacement;
    const {context} = launched;
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;

    await migrationCase(context, origin, errors, report, timeout);
    await drawerCases(context, origin, errors, report, timeout);
    await settingsLinkCases(context, origin, errors, report, timeout);
    await hoverShortcutCase(context, origin, errors, report, timeout);
    await persistenceCases(context, origin, errors, report, timeout);
    await optionsResponsive(context, origin, errors, report, timeout);
    report.ok = errors.length === 0;
    assert(report.ok, '浏览器控制台存在错误', errors);
  } catch (error) {
    primaryError = error;
    report.ok = false;
    report.error = error instanceof Error ? {message: error.message, stack: error.stack} : {message: String(error)};
  } finally {
    const cleanupErrors = [];
    const cleanup = async (resource, release) => {
      try { await release(); } catch (error) {
        cleanupErrors.push(error);
        (report.cleanupErrors ||= []).push({resource, error: String(error.stack || error)});
        report.ok = false;
        process.exitCode = 1;
        console.error(`Cleanup failed (${resource}):`, error);
      }
    };
    let browserClosed = false;
    await cleanup('browser', async () => { if (launched) { await launched.close(); browserClosed = true; } });
    await cleanup('profile', () => {
      if (!profileDir) return;
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        try { fs.rmdirSync(profileDir); } catch (error) {
          // 未尝试启动浏览器时，仅移除初始空目录。
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup('report', () => { fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
