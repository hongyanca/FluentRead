'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
/**
 * @file scripts/testing/run-chrome-translation-ui-test.cjs
 * 文件职责：用隔离真实 Chrome 验证内置翻译准备 UI、实际模型和后续 Offscreen 翻译。
 * 主要内容：通过 CDP 加载生产扩展，分别记录原生 API 结果与可控 API 边界回归，检查自动语言、激活、失败帮助和响应式。
 * 模块边界：只操作新建临时 profile；模型 mock 仅用于明确标记的 UI 合约，不作为原生翻译成功证据。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-chrome-translation-ui'));
const {chromium} = require(path.join(arg('playwright-root', ''), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const storagePrefix = 'fluentread.chromeTranslationPreparation.';
const pendingKey = (source, target) => `${storagePrefix}${source}:${target}`;
const skipNative = arg('skip-native', 'false') === 'true';
assert.ok(!skipNative || arg('require-native', 'false') !== 'true', 'Native verification cannot be required and skipped together');
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {extensionDir, scope: skipNative ? 'ui-contract' : 'native-and-ui-contract', cases: [], native: {}, screenshots: [], consoleErrors: []};

async function main() {
  const suppliedProfile = arg('profile-dir', '');
  const profileDir = suppliedProfile ? path.resolve(suppliedProfile) : fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-chrome-ui-'));
  assert.ok((profileDir.startsWith('/private/tmp/') || profileDir.startsWith(os.tmpdir())) && path.basename(profileDir).startsWith('fluentread-chrome-ui-'), 'Only dedicated temporary test profiles are permitted');
  report.profileMode = suppliedProfile ? 'reused-task-model-cache' : 'fresh';
  let launched, cdp;
  let primaryError;
  let launchAttempted = false;
  try {
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({
      chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      headless: false, background: true,
      browserArgs: ['--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging'],
      viewport: {width: 1440, height: 1000}, timeout: 30000,
    });
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    const {context} = launched;
    report.browserVersion = context.browser().version();
    cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: extensionDir});
    const page = await newPageWithoutForeground(context);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error') report.consoleErrors.push(entry.text()); });
    await page.goto(`chrome-extension://${id}/options.html#settings-services`);
    await page.locator('.service-catalog').waitFor();
    await page.evaluate(async () => {
      const {value} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const saved = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: {from: 'auto', to: 'zh-Hans', uiLanguage: 'zh-CN'}, expected: {from: value.from, to: value.to, uiLanguage: value.uiLanguage}, clientId: 'chrome-ui-test', sequence: 1});
      if (!saved?.success) throw new Error(saved?.error || 'Unable to configure isolated fixture');
    });
    await page.reload();
    await page.locator('[data-service-value="chromeTranslator"]').click();
    const button = page.locator('[data-connection-test-button]');
    const status = page.locator('[data-connection-test-status]');
    assert.equal(await page.locator('[data-chrome-preparation-source]').count(), 0);
    assert.equal(await button.textContent().then(text => text.trim()), '准备 Chrome 本地翻译');
    await page.locator('[data-chrome-preparation-help] details summary').click();
    assert.equal(await page.locator('[data-chrome-preparation-help] a[href="https://developer.chrome.com/docs/ai/translator-api"]').count(), 1);
    assert.equal(await page.getByTestId('service-website-link').getAttribute('href'), 'https://developer.chrome.com/docs/ai/translator-api');
    report.cases.push('no-manual-source-and-official-help');

    if (skipNative) {
      report.native.skipped = true;
    } else {
      report.native.availability = await page.evaluate(async () => ({
        translator: typeof Translator === 'undefined' ? 'missing' : await Translator.availability({sourceLanguage: 'en', targetLanguage: 'zh'}),
        detector: typeof LanguageDetector === 'undefined' ? 'missing' : await LanguageDetector.availability(),
      }));
      await page.evaluate(() => {
        globalThis.__chromeNativeProbe = [];
        for (const name of ['Translator', 'LanguageDetector']) {
          const api = globalThis[name];
          const create = api.create.bind(api);
          api.create = options => {
            const event = {api: name, phase: 'creating', activated: navigator.userActivation.isActive};
            globalThis.__chromeNativeProbe.push(event);
            return create(options).then(result => { event.phase = 'created'; return result; }, error => { event.phase = 'failed'; event.error = `${error.name}: ${error.message}`; throw error; });
          };
        }
      });
      await button.click();
      for (let elapsed = 0; elapsed < 310 && await button.isDisabled(); elapsed += 2) {
        await page.waitForTimeout(2000);
        report.native.operations = await page.evaluate(() => globalThis.__chromeNativeProbe);
        report.native.progress = await status.textContent();
        fs.writeFileSync(path.join(artifactsDir, 'progress.json'), JSON.stringify(report, null, 2));
      }
      assert.equal(await button.isDisabled(), false, 'Native preparation exceeded its bounded timeout');
      report.native.preparation = await status.textContent();
      report.native.preparationSucceeded = await status.evaluate(element => element.classList.contains('is-success'));
      if (report.native.preparationSucceeded) {
        report.native.offscreen = await page.evaluate(async () => {
          const requestId = 'native-chrome-ui-offscreen';
          // Trigger the provider's existing background connection check, which creates the production Offscreen document.
          return await chrome.runtime.sendMessage({type: 'testTranslationService', service: 'chromeTranslator', requestId});
        });
      }
      await page.screenshot({path: path.join(artifactsDir, 'chrome-native-preparation.png')});
      report.screenshots.push('chrome-native-preparation.png');
    }

    // These cases replace only the browser API boundary. They do not claim native model success.
    await page.evaluate(() => {
      globalThis.__chromeUiProbe = {source: 'fr', calls: [], fail: false, destroyed: 0};
      globalThis.LanguageDetector = {create: async () => ({detect: async () => [{detectedLanguage: globalThis.__chromeUiProbe.source, confidence: 0.99}], destroy: () => globalThis.__chromeUiProbe.destroyed++})};
      globalThis.Translator = {create: async options => {
        globalThis.__chromeUiProbe.calls.push({sourceLanguage: options.sourceLanguage, targetLanguage: options.targetLanguage, activated: navigator.userActivation.isActive});
        if (globalThis.__chromeUiProbe.fail) throw new DOMException('The language model component is not available.', 'NotSupportedError');
        return {translate: async () => { if (globalThis.__chromeUiProbe.hold) await new Promise(resolve => { globalThis.__chromeUiProbe.release = resolve; }); return '这是一句浏览器边界测试译文。'; }, destroy: () => globalThis.__chromeUiProbe.destroyed++};
      }};
    });
    await page.evaluate(async key => { await chrome.storage.session.set({[key]: {sourceLanguage: 'fr', targetLanguage: 'zh', updatedAt: Date.now()}}); }, pendingKey('fr', 'zh'));
    await page.waitForTimeout(200);
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-connection-test-status]')?.classList.contains('is-success'));
    const first = await page.evaluate(() => globalThis.__chromeUiProbe.calls.at(-1));
    assert.deepEqual(first, {sourceLanguage: 'fr', targetLanguage: 'zh', activated: true});
    assert.equal(await page.evaluate(async key => (await chrome.storage.session.get(key))[key] || null, pendingKey('fr', 'zh')), null);
    report.cases.push('pending-source-consumed-with-real-user-activation');

    await page.evaluate(async key => {
      globalThis.__chromeUiProbe.source = 'en';
      await chrome.storage.session.set({[key]: {sourceLanguage: 'ja', targetLanguage: 'fr', updatedAt: Date.now()}});
    }, pendingKey('ja', 'fr'));
    await page.waitForTimeout(200);
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-connection-test-status]')?.classList.contains('is-success'));
    assert.deepEqual(await page.evaluate(() => globalThis.__chromeUiProbe.calls.at(-1)), {sourceLanguage: 'en', targetLanguage: 'zh', activated: true});
    assert.deepEqual(await page.evaluate(async key => { const {sourceLanguage, targetLanguage} = (await chrome.storage.session.get(key))[key]; return {sourceLanguage, targetLanguage}; }, pendingKey('ja', 'fr')), {sourceLanguage: 'ja', targetLanguage: 'fr'});
    report.cases.push('other-target-pending-not-reused-or-cleared');

    // A second extension document writes a new pair while this settings page is preparing the previous pair.
    const otherPage = await newPageWithoutForeground(context);
    await otherPage.goto(`chrome-extension://${id}/options.html#settings-services`);
    await page.evaluate(async key => {
      globalThis.__chromeUiProbe.source = 'fr';
      globalThis.__chromeUiProbe.hold = true;
      await chrome.storage.session.set({[key]: {sourceLanguage: 'fr', targetLanguage: 'zh', updatedAt: Date.now()}});
    }, pendingKey('fr', 'zh'));
    await page.waitForTimeout(200);
    await button.click();
    await page.waitForFunction(() => typeof globalThis.__chromeUiProbe.release === 'function');
    await otherPage.evaluate(async key => {
      await chrome.storage.session.set({[key]: {sourceLanguage: 'ja', targetLanguage: 'zh', updatedAt: Date.now()}});
    }, pendingKey('ja', 'zh'));
    await page.evaluate(() => { globalThis.__chromeUiProbe.hold = false; globalThis.__chromeUiProbe.release(); });
    await page.waitForFunction(() => document.querySelector('[data-connection-test-status]')?.classList.contains('is-success'));
    assert.equal(await page.evaluate(async key => (await chrome.storage.session.get(key))[key] || null, pendingKey('fr', 'zh')), null);
    assert.equal(await otherPage.evaluate(async key => (await chrome.storage.session.get(key))[key]?.sourceLanguage, pendingKey('ja', 'zh')), 'ja');
    await page.evaluate(() => { globalThis.__chromeUiProbe.source = 'ja'; });
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-connection-test-status]')?.classList.contains('is-success'));
    assert.deepEqual(await page.evaluate(() => globalThis.__chromeUiProbe.calls.at(-1)), {sourceLanguage: 'ja', targetLanguage: 'zh', activated: true});
    await otherPage.close();
    report.cases.push('other-context-pending-survives-successful-preparation');

    await page.evaluate(() => { globalThis.__chromeUiProbe.fail = true; });
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-connection-test-status]')?.classList.contains('is-error'));
    assert.match(await status.textContent(), /当前 Chrome 无法创建本地翻译模型/);
    assert.doesNotMatch(await status.textContent(), /Chrome 不支持本地翻译语言对/);
    await status.locator('details summary').click();
    assert.match(await status.locator('code').textContent(), /language model component/);
    report.cases.push('native-error-retained-without-false-language-rejection');
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({width, height: 1000});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `Horizontal overflow at ${width}`);
      const buttonFits = await button.evaluate(element => {
        const buttonBounds = element.getBoundingClientRect();
        const panelBounds = element.closest('.service-detail').getBoundingClientRect();
        return buttonBounds.left >= panelBounds.left && buttonBounds.right <= panelBounds.right
          && element.scrollWidth <= element.clientWidth;
      });
      assert.equal(buttonFits, true, `Preparation button is clipped at ${width}`);
      const file = `chrome-preparation-${width}.png`;
      await page.screenshot({path: path.join(artifactsDir, file)});
      report.screenshots.push(file);
    }
    report.cases.push('responsive-1440-820-390');
    report.mockBoundary = await page.evaluate(() => globalThis.__chromeUiProbe);
    assert.equal(report.consoleErrors.length, 0, 'The settings page emitted console or page errors');
    report.uiContractPassed = true;
    report.nativePassed = report.native.preparationSucceeded === true && report.native.offscreen?.success === true;
    report.ok = report.uiContractPassed && (skipNative || report.nativePassed);
    if (arg('require-native', 'false') === 'true') assert.equal(report.nativePassed, true, 'Native Chrome model preparation or Offscreen translation failed');
  } catch (error) {
    primaryError = error;
    report.ok = false;
    report.error = error.stack || String(error);
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {await cdp?.detach();});
    await cleanup(async () => {
      if (launched) {await launched.close(); browserClosed = true;}
    });
    await cleanup(() => {
      if (suppliedProfile) return;
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
}
main().catch(error => { console.error(error); process.exitCode = 1; });
