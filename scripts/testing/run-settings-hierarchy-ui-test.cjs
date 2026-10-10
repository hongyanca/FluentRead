'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
// 设置层级专项：在隔离生产扩展中检查入口、渐进展开、配置保留、移动目录和主题布局。
const fs = require('node:fs');
const path = require('node:path');
function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; }
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-settings-hierarchy'));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const assert = (value, message) => { if (!value) throw new Error(message); };
fs.mkdirSync(artifactsDir, {recursive: true});
async function main() {
  const profileDir = fs.mkdtempSync('/private/tmp/fr-settings-hierarchy-');
  const report = {ok: false, artifact: 'production', extensionDir, cases: [], persistenceCases: [], quickClose: false, latestWriteWins: false, crossPageSync: false, screenshots: [], consoleErrors: []};
  let launched, page, primaryError;
  const timeout = 30000;
  let launchAttempted = false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    report.manifest = {options: manifest.options_page || manifest.options_ui?.page, popup: manifest.action?.default_popup};
    assert(report.manifest.options && report.manifest.popup, 'Manifest UI entries missing');
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium, profileDir, timeout, background: true, headless: false,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', displayTarget: arg('display', 'secondary'), viewport: {width: 1440, height: 900},
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const url = `${origin}/${report.manifest.options}`;
    async function openPage(target = url) {
      const next = await newPageWithoutForeground(context, timeout);
      next.on('pageerror', e => report.consoleErrors.push(e.message));
      next.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
      await next.goto(target, {waitUntil: 'domcontentloaded'});
      return next;
    }
    async function settled() { await page.waitForTimeout(180); }
    async function shot(name) { const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file); }
    async function check(name) {
      await settled();
      const state = await page.evaluate(() => {
        const visible = e => !!e.getClientRects().length;
        const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
        const overflow = [...document.querySelectorAll('.settings-card, .service-detail, .catalog-layout, .settings-group, .service-disclosure')]
          .filter(visible).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className);
        return {width: innerWidth, height: innerHeight, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, scrollX, scrollY, overflow, duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i)};
      });
      assert(state.docWidth <= state.width + 1 && state.docHeight <= state.height + 1 && !state.scrollX && !state.scrollY, `${name}: document overflow ${JSON.stringify(state)}`);
      assert(!state.overflow.length && !state.duplicateIds.length, `${name}: container overflow or duplicate ids ${JSON.stringify(state)}`);
      report.cases.push({name, state});
    }
    async function navigate(id) { await page.locator(`nav button[data-section="${id}"]`).click(); await settled(); }
    async function selectService(service) {
      if (await page.locator('.mobile-directory-toggle').isVisible() && await page.locator('.mobile-directory-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('.mobile-directory-toggle').click();
      await page.locator(`[data-service-value="${service}"]`).click();
      await page.locator(`[data-service-configuration-service="${service}"]`).waitFor();
      await settled();
    }
    async function expand(group) {
      if (group === 'keys') return page.locator('[data-api-key-list]');
      await page.locator(`[data-service-settings-tabs] [id$="tab-${group}"]`).click();
      const panel = page.locator(`[data-configuration-group="${group}"]`);
      await panel.waitFor({state: 'visible'});
      return panel;
    }
    async function readConfig() {
      const r = await page.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
      assert(r?.success && r.value, 'Unable to read isolated config'); return r.value;
    }
    async function patchFixture(patch) {
      const config = await readConfig();
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, config[key]]));
      const r = await page.evaluate(({patch, expected}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch, expected}), {patch, expected});
      assert(r?.success, 'Unable to prepare isolated fixture'); await settled();
    }
    page = await openPage();
    await page.locator('[data-testid="configure-default-translation-service"]').waitFor();
    assert((await page.locator('.settings-group-heading h2:visible').allTextContents()).join('|') === '日常翻译|网页辅助|基本偏好', 'General settings order');
    await check('general-desktop'); await shot('general-desktop');
    const defaultService = await page.locator('[data-testid="default-translation-service-card"]').getAttribute('data-default-service');
    await page.locator('[data-testid="configure-default-translation-service"]').click();
    await page.locator('.service-catalog').waitFor();
    assert(await page.locator('.service-catalog').getAttribute('data-editing-service') === defaultService, 'Configure shortcut selects wrong service');
    await selectService('doubao');
    assert(await page.locator('.service-catalog').getAttribute('data-default-service') === defaultService, 'Browsing changes default service');
    assert(await page.locator('[data-service-settings-tabs] [role="tabpanel"]:visible').count() === 1, 'Only the active settings pane is visible');
    assert(await page.locator('[data-testid="model-picker-trigger"]').isVisible(), 'Model must be visible');
    assert(await page.locator('[data-api-key-list] .api-key-entry input').isVisible(), 'API key must be visible');
    assert(await page.locator('[data-configuration-group="advanced"]').count() === 0, 'Nested advanced container remains');
    await check('doubao-default'); await shot('doubao-default');
    // The tab strip is keyboard accessible and displays only one settings group.
    const modelTab = page.locator('[id$="tab-translation"]');
    await modelTab.focus(); await page.keyboard.press('Enter');
    await page.locator('[data-testid="model-thinking-control"] .el-switch').waitFor();
    assert(!await page.locator('[data-configuration-group="prompts"]').isVisible(), 'Inactive prompt pane remains visible');
    await page.locator('[data-testid="model-thinking-control"] .el-switch').click();
    const chosenModel = (await page.locator('[data-testid="model-picker-trigger"] strong').textContent()).trim();
    const thinking = await page.locator('[data-testid="model-thinking-control"] [role="switch"]').getAttribute('aria-checked');
    await check('model-preferences'); await shot('model-preferences');
    await expand('keys');
    await page.locator('[data-api-key-list] .api-key-entry input').first().fill('fixture-key-one');
    await page.locator('.api-key-add').click();
    await page.locator('[data-api-key-list] .api-key-entry input').nth(1).fill('fixture-key-two');
    await check('multiple-keys'); await shot('multiple-keys');
    // Using only the first key keeps every saved key visible and marks the rest as standby.
    await page.locator('[data-api-key-rotation-setting] input[value="single"]').check();
    assert(await page.locator('[data-api-key-list] .api-key-entry input').count() === 2, 'First-key-only mode must not hide saved keys');
    assert(await page.locator('[data-api-key-standby]').count() === 1, 'Unused key is not marked as standby');
    await page.locator('[data-api-key-rotation-setting] input[value="rotation"]').check();
    assert(await page.locator('[data-api-key-standby]').count() === 0, 'Rotation must use every key');
    assert(await page.locator('[data-api-key-list] .api-key-entry input').nth(1).inputValue() === 'fixture-key-two', 'Rotation switch discarded the second key');
    await expand('prompts');
    const prompt = page.locator('[data-testid="prompt-template-list"] textarea').last();
    await prompt.fill('First {{origin}}');
    await prompt.fill('Translate {{origin}} into {{to}}. UI persistence fixture.');
    await expand('requests');
    await page.locator('[data-testid="request-limit-settings"] .request-limit-inheritance').getByRole('radio', {name: '自定义', exact: true}).click();
    const concurrency = page.locator('[data-testid="request-limit-settings"] input[role="spinbutton"]').first();
    await concurrency.fill('3'); await concurrency.press('Tab');
    await expand('custom-request');
    const customBody = page.getByRole('textbox', {name: '自定义请求体', exact: true});
    await customBody.fill('{"temperature":0.2}');
    await page.close();
    page = await openPage(`${url}#settings-services`);
    await selectService('doubao');
    await expand('keys');
    assert(await page.locator('[data-api-key-list] .api-key-entry input').count() === 2, 'Multi-key mode was not persisted');
    assert(await page.locator('[data-api-key-list] .api-key-entry input').nth(1).inputValue() === 'fixture-key-two', 'Key was not persisted');
    await expand('translation');
    assert(await page.locator('[data-testid="model-thinking-control"] [role="switch"]').getAttribute('aria-checked') === thinking, 'Thinking did not persist');
    await expand('prompts');
    assert(await page.locator('[data-testid="prompt-template-list"] textarea').last().inputValue() === 'Translate {{origin}} into {{to}}. UI persistence fixture.', 'Prompt latest write lost');
    await expand('requests');
    assert(await page.locator('[data-testid="request-limit-settings"] input[role="spinbutton"]').first().inputValue() === '3', 'Request limit lost');
    await expand('custom-request');
    assert(await page.getByRole('textbox', {name: '自定义请求体', exact: true}).inputValue() === '{"temperature":0.2}', 'Rapid close lost request body');
    report.persistenceCases.push('rotation-retains-keys', 'model-thinking', 'prompt-latest-write', 'model-request-limit', 'custom-request-body');
    report.quickClose = true; report.latestWriteWins = true;
    // Switching providers resets the active settings pane and preserves model choices.
    await selectService('microsoft');
    assert(await page.locator('[data-configuration-group="translation"]').count() === 0, 'Machine provider shows model preferences');
    await check('machine-service'); await shot('machine-service');
    await selectService('aliyunTranslation');
    const guide = page.locator('[data-testid="service-credential-guide"]');
    assert(await guide.getAttribute('open') === null, 'Setup guide takes over the form');
    await guide.locator('summary').click();
    assert(await page.locator('[data-testid="service-credential-console"]').isVisible(), 'Setup guide is inaccessible');
    await check('cloud-service'); await shot('cloud-service');
    await selectService('doubao');
    assert(await page.locator('[id$="tab-translation"]').getAttribute('aria-selected') === 'true', 'Service switch must reset to model preferences');
    assert((await page.locator('[data-testid="model-picker-trigger"] strong').textContent()).trim() === chosenModel, 'Service switch loses selected model');
    await expand('keys');
    await page.locator('[data-api-key-rotation-setting] input[value="single"]').check();
    await patchFixture({theme: 'dark'});
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await check('service-dark'); await shot('service-dark');
    for (const [width, height] of [[1024, 768], [820, 720], [390, 844]]) {
      await page.setViewportSize({width, height}); await check(`service-${width}`); await shot(`service-${width}`);
      if (width < 700) {
        assert(await page.locator('.mobile-directory-toggle').getAttribute('aria-expanded') === 'false', 'Mobile service directory defaults open');
        const icon = await page.locator('.mobile-directory-toggle > .service-brand-icon').boundingBox();
        assert(icon && icon.width <= 32 && icon.height <= 32 && Math.abs(icon.width - icon.height) < 1, 'Mobile service icon was stretched');
        await page.locator('.mobile-directory-toggle').click();
        await check('mobile-directory-open'); await shot('mobile-directory-open');
        await selectService('openai');
        assert(await page.locator('.mobile-directory-toggle').getAttribute('aria-expanded') === 'false', 'Mobile service directory stays open after selection');
        await expand('custom-request'); await check('mobile-compatibility'); await shot('mobile-compatibility');
      }
      await navigate('settings-general'); await check(`general-${width}`); await shot(`general-${width}`);
      await navigate('settings-services');
    }
    await page.setViewportSize({width: 1440, height: 900});
    await patchFixture({theme: 'light', uiLanguage: 'en-US'});
    await page.waitForFunction(() => document.querySelector('[id$="tab-prompts"]')?.textContent?.includes('Prompt'));
    await check('service-english'); await shot('service-english');
    await patchFixture({uiLanguage: 'zh-CN'});
    await navigate('settings-general');
    const second = await openPage(`${url}#settings-general`);
    await second.locator('[data-testid="configure-default-translation-service"]').waitFor();
    const onSwitch = page.locator('.settings-item:has([role="switch"][aria-label="插件状态"]) .el-switch');
    const previous = await onSwitch.locator('[role="switch"]').getAttribute('aria-checked');
    await onSwitch.click();
    await second.waitForFunction(previous => document.querySelector('[role="switch"][aria-label="插件状态"]')?.getAttribute('aria-checked') !== previous, previous);
    report.crossPageSync = true;
    await second.close();
    await patchFixture({uiLanguageSetupCompleted: true});
    const popup = await openPage(`${origin}/${report.manifest.popup}`);
    await popup.locator('.popup-shell:not(.config-loading):not(.language-onboarding-shell)').waitFor();
    await popup.waitForTimeout(250);
    const popupImage = path.join(artifactsDir, 'popup-cross-page.png'); await popup.locator('.popup-shell').screenshot({path: popupImage}); report.screenshots.push(popupImage);
    await popup.close();
    await check('general-reopened'); await shot('general-reopened');
    const sectionIds = await page.locator('nav button[data-section]').evaluateAll(nodes => nodes.map(node => node.dataset.section));
    for (const id of sectionIds) { await navigate(id); await check(`navigation-${id}`); }
    await navigate('settings-general');
    await page.locator('.search-box input').fill('software language');
    await page.locator('.search-box input').fill('language');
    await page.locator('.search-results button').first().click();
    await page.locator('[data-testid="ui-language-select"]').waitFor();
    await check('language-search-after-reorder');
    assert(report.consoleErrors.length === 0, `Browser errors: ${report.consoleErrors.join('\n')}`);
    report.ok = true;
  } catch (e) { primaryError = e; report.error = e.stack || String(e); if (page && !page.isClosed()) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {}); }
  finally {
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
  console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, error: report.error, artifactsDir}));
  if (!report.ok) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
