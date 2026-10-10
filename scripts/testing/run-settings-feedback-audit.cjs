#!/usr/bin/env node
'use strict';
// 设置反馈逐页核对：隔离临时配置、第二屏后台窗口，检查所有设置的层级、响应式和明确反馈。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const argument = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const subset = (actual, expected) => expected && typeof expected === 'object' && !Array.isArray(expected)
  ? actual && Object.entries(expected).every(([key, value]) => subset(actual[key], value))
  : JSON.stringify(actual) === JSON.stringify(expected);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
  const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-settings-feedback-audit'));
  const packages = argument('playwright-root'); const helperPath = argument('focus-safe-helper');
  assert(packages && helperPath, '需要 --playwright-root 与 --focus-safe-helper'); assert(fs.existsSync(path.join(extensionDir, 'manifest.json')));
  const {chromium} = require(require.resolve('playwright', {paths: [packages]}));
  const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(helperPath);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-settings-feedback-audit-edge-'));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const report = {ok: false, extensionDir, profileDir, artifactsDir, checks: [], consoleErrors: [], screenshots: [], metrics: {},
    evidenceBoundary: 'Settings-only navigation, presentation and local persistence in a clean Edge profile; no live translation provider claim.'};
  let launched;
  try {
    launched = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async url => {
      const result = await newPageWithoutForeground(context, 30000);
      result.on('pageerror', error => report.consoleErrors.push(`pageerror: ${error.message}`));
      result.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(`console: ${message.text()}`); });
      await result.goto(url, {waitUntil: 'domcontentloaded'}); return result;
    };
    const shot = async (surface, name) => {
      const owner = typeof surface.page === 'function' ? surface.page() : surface;
      const viewport = owner.viewportSize() || await owner.evaluate(() => ({width: innerWidth, height: innerHeight}));
      let expanded = false;
      if (surface !== owner) {
        // 设置页在内部容器中滚动；让整组真实进入视口再截图，避免截图把被裁剪的区域渲染成空白。
        const height = Math.ceil(await surface.evaluate(element => element.getBoundingClientRect().height));
        if (height + 100 > viewport.height) {
          await owner.setViewportSize({width: viewport.width, height: height + 100});
          expanded = true;
        }
        await surface.scrollIntoViewIfNeeded();
      }
      const file = path.join(artifactsDir, `${name}.png`);
      await surface.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);
      if (expanded) await owner.setViewportSize(viewport);
    };
    const popup = await createPage(`${origin}/popup.html`);
    const readConfig = () => popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!result?.success) throw new Error(result?.error); return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const untilConfig = async (predicate, label = 'configuration') => {
      for (let i = 0; i < 200; i++) {const config = await readConfig(); if (config && predicate(config)) return config; await wait(50);}
      throw new Error(`${label} did not converge`);
    };
    await untilConfig(config => config.to && config.service);
    const patchConfig = async patch => {
      const current = await readConfig(); const initial = Object.hasOwn(patch, 'token');
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]));
      const result = await popup.evaluate(({patch, current, expected, initial}) => chrome.runtime.sendMessage({
        type: 'persistConfig', mode: initial ? 'replace' : 'patch', config: initial ? {...current, ...patch} : patch, expected,
        baseRevision: initial ? current.__fluentConfigRevision : undefined, clientId: `settings-feedback-audit-${crypto.randomUUID()}`, sequence: 1,
      }), {patch, current, expected, initial});
      assert.equal(result?.success, true, result?.error);
      await untilConfig(config => Object.keys(patch).filter(key => key !== 'token').every(key => subset(config[key], patch[key])));
    };
    await patchConfig({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', animations: false});
    const page = await createPage(`${origin}/options.html#settings-general`);
    await page.locator('[data-testid="plugin-master-setting"]').waitFor();
    const groups = await page.locator('.nav-group-toggle').evaluateAll(elements => elements.map(e => e.getAttribute('aria-expanded')));
    assert.equal(groups.length, 4); assert(groups.every(value => value === 'true'));
    const sections = await page.locator('.nav-group-items [data-section]').evaluateAll(elements => elements.map(e => ({id: e.dataset.section, label: e.innerText})));
    report.pages = [];
    for (const section of sections) {
      await page.locator(`.nav-group-items [data-section="${section.id}"]`).click();
      await page.locator(`#${section.id}`).waitFor({state: 'visible'});
      await wait(180);
      const metrics = await page.evaluate(() => {
        const card = document.querySelector('.settings-card');
        return {pageWidth: document.documentElement.clientWidth, outerWidth: document.documentElement.scrollWidth,
          cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth, cardHeight: card.clientHeight, cardScrollHeight: card.scrollHeight,
          tabs: [...document.querySelectorAll('.settings-page-tabs button')].map(e => e.innerText),
          featureCards: [...card.querySelectorAll('.feature-enable-card button')].filter(e => e.getClientRects().length).map(e => ({text: e.innerText, width: e.clientWidth, height: e.clientHeight, state: e.getAttribute('aria-checked')})),
          disclosures: [...card.querySelectorAll('details > summary')].filter(e => e.getClientRects().length).map(e => ({text: e.innerText, height: e.clientHeight, background: getComputedStyle(e).backgroundColor})),
        };
      });
      assert(metrics.outerWidth <= metrics.pageWidth + 1, `${section.id} page overflow`);
      assert(metrics.cardScrollWidth <= metrics.cardWidth + 1, `${section.id} card overflow`);
      assert.equal(metrics.tabs.length, section.id === 'settings-translation-stats' ? 2 : section.id === 'settings-sites' ? 3 : 0);
      for (const card of metrics.featureCards) {assert(card.height >= 44); assert(!/^(未开启|已开启)$/mu.test(card.text));}
      report.pages.push({...section, ...metrics});
      await shot(page, `${section.id}-top`);
      if (metrics.cardScrollHeight > metrics.cardHeight + 120) {
        await page.locator('.settings-card').evaluate(e => {e.scrollTop = e.scrollHeight;});
        await shot(page, `${section.id}-bottom`);
      }
    }
    await patchConfig({selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'hover', inputBoxTranslationTrigger: 'triple_space', disableFloatingBall: false});
    report.metrics.numericFields = [];
    for (const id of ['settings-general', 'settings-services', 'settings-translation', 'settings-interface', 'settings-selection', 'settings-advanced']) {
      await page.locator(`.nav-group-items [data-section="${id}"]`).click();
      const section = page.locator(`#${id}`); await section.waitFor({state: 'visible'});
      await page.locator('.settings-card details').evaluateAll(elements => elements.forEach(e => {e.open = true;}));
      if (id === 'settings-translation') {
        await page.getByTestId('input-translation-timing-toggle').click();
        await page.getByTestId('input-translation-interval').waitFor({state: 'visible'});
        await wait(350);
      }
      const numbers = await page.locator('.settings-card .el-input-number:not(.is-without-controls), .fluentread-settings-number-popover .el-input-number').evaluateAll(elements => elements.filter(e => e.getClientRects().length).map(e => {
        const input = e.querySelector('input'); const bounds = input.getBoundingClientRect();
        const minus = e.querySelector('.el-input-number__decrease').getBoundingClientRect();
        const plus = e.querySelector('.el-input-number__increase').getBoundingClientRect();
        const style = getComputedStyle(input); const canvas = document.createElement('canvas').getContext('2d');
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const max = input.getAttribute('aria-valuemax');
        return {label: input.getAttribute('aria-label'), value: input.value, max,
          textWidth: bounds.width, requiredWidth: canvas.measureText(max || input.value).width,
          leftGap: bounds.left - minus.right, rightGap: plus.left - bounds.right};
      }));
      for (const number of numbers) {
        assert(number.leftGap >= 6 && number.rightGap >= 6, `${id}: ${JSON.stringify(number)}`);
        assert(number.textWidth >= number.requiredWidth + 2, `${id} value clipped: ${JSON.stringify(number)}`);
      }
      report.metrics.numericFields.push({id, numbers});
      if (id === 'settings-translation') {
        await shot(page.getByTestId('input-translation-timing-panel'), 'number-input-timing');
        await page.getByTestId('input-translation-timing-toggle').click();
        await page.getByTestId('input-translation-timing-panel').waitFor({state: 'hidden'});
      }
    }
    report.checks.push('all sidebar groups expanded; every settings page opens without ordinary page tabs, horizontal overflow or duplicate switch-state labels');

    // 设置行的数值框统一为不带加减按钮的紧凑输入；键盘步进、手动编辑、范围限制和持久化都使用生产组件。
    await page.goto(`${origin}/options.html#settings-advanced`);
    const minLength = page.getByRole('spinbutton', {name: '翻译段落最少字符数', exact: true});
    const eager = page.getByRole('spinbutton', {name: '免滚动预翻译字符数', exact: true});
    await minLength.waitFor();
    const numberMetrics = async input => input.evaluate(e => {
      const field = e.closest('.settings-number-input').getBoundingClientRect();
      const style = getComputedStyle(e); const canvas = document.createElement('canvas').getContext('2d');
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return {fieldWidth: field.width, hasSteppers: Boolean(e.closest('.el-input-number').querySelector('.el-input-number__increase')),
        textWidth: e.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        requiredWidth: canvas.measureText(e.getAttribute('aria-valuemax') || e.value).width};
    });
    report.metrics.numbers = await Promise.all([numberMetrics(minLength), numberMetrics(eager)]);
    for (const metric of report.metrics.numbers) {
      assert(!metric.hasSteppers && metric.fieldWidth >= 120 && metric.fieldWidth <= 140, JSON.stringify(metric));
      assert(metric.textWidth >= metric.requiredWidth + 2, `value clipped: ${JSON.stringify(metric)}`);
    }
    await minLength.focus(); await page.keyboard.press('ArrowUp');
    await untilConfig(config => config.minTranslationTextLength === 3);
    await page.keyboard.press('ArrowDown');
    await untilConfig(config => config.minTranslationTextLength === 2);
    await minLength.fill('1'); await minLength.press('Tab');
    await untilConfig(config => config.minTranslationTextLength === 1);
    await minLength.focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await minLength.inputValue(), '1');
    await eager.focus(); await page.keyboard.press('ArrowUp');
    await untilConfig(config => config.eagerTranslationCharacters === 100);
    await eager.fill('100000'); await eager.press('Tab');
    await untilConfig(config => config.eagerTranslationCharacters === 100000);
    await eager.focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await eager.inputValue(), '100000');
    await page.reload(); await eager.waitFor(); assert.equal(await eager.inputValue(), '100000');
    await shot(page, 'number-controls-desktop');
    await shot(eager.locator('xpath=ancestor::section[1]'), 'number-controls-detail');
    await page.setViewportSize({width: 390, height: 900});
    report.metrics.numbersMobile = await numberMetrics(eager);
    assert(report.metrics.numbersMobile.textWidth >= report.metrics.numbersMobile.requiredWidth + 2);
    await shot(page, 'number-controls-mobile');
    await page.setViewportSize({width: 1440, height: 960});
    report.checks.push('compact numeric fields have no steppers and never clip their maximum value; ArrowUp/ArrowDown, min/max, six-digit edit and reload persistence pass');

    await patchConfig({vocabularyBookEnabled: false, selectionTranslatorMode: 'disabled', harness: {...(await readConfig()).harness, enabled: false}});
    await page.goto(`${origin}/options.html#settings-vocabulary`);
    const saving = page.getByRole('switch', {name: '学习收藏', exact: true});
    await saving.waitFor(); assert((await saving.boundingBox()).height >= 44);
    await saving.focus(); await page.keyboard.press('Space');
    await untilConfig(config => config.vocabularyBookEnabled);
    await page.reload(); await saving.waitFor(); assert.equal(await saving.getAttribute('aria-checked'), 'true');
    await shot(page, 'vocabulary-saving-enabled');
    await page.locator('.selection-reminder button').click();
    await page.locator('#settings-selection').waitFor({state: 'visible'});
    assert.equal(await page.locator('.nav-group-items [aria-current=page]').getAttribute('data-section'), 'settings-selection');
    report.checks.push('learning saving uses stable named whole-row switch with keyboard and persistence; enable-entry link opens selection settings directly');

    await page.goto(`${origin}/options.html#settings-glossary`);
    const glossary = page.getByTestId('glossary-settings'); await glossary.waitFor();
    const builtinCards = glossary.locator('.builtin-card');
    assert(await builtinCards.count() > 0);
    assert.equal(await builtinCards.first().evaluate(e => Boolean(e.closest('details:not([open])'))), false);
    const master = glossary.getByRole('switch', {name: '启用术语库', exact: true});
    const bounds = await master.evaluate(e => ({copy: e.querySelector('.feature-enable-copy').getBoundingClientRect().right, knob: e.querySelector('.feature-enable-control').getBoundingClientRect().left}));
    assert(bounds.knob > bounds.copy);
    await master.focus(); await page.keyboard.press('Space');
    await untilConfig(config => config.glossaryEnabled);
    await glossary.getByRole('button', {name: '添加词条', exact: true}).click();
    await glossary.locator('.glossary-entry-form input').first().fill('FluentRead');
    await glossary.locator('.glossary-entry-form input').nth(1).fill('流畅阅读');
    await glossary.locator('.glossary-entry-form button[type=submit]').click();
    await untilConfig(config => config.glossaryLibraries.some(library => library.entries.some(entry => entry.source === 'FluentRead' && entry.target === '流畅阅读')));
    await page.reload(); await glossary.locator('.glossary-table tbody').getByText('FluentRead', {exact: true}).waitFor();
    await shot(page, 'glossary-with-entry');
    await glossary.locator('.glossary-builtins-page').scrollIntoViewIfNeeded();
    await shot(page, 'glossary-builtins-visible');
    report.checks.push('glossary has right-aligned keyboard-operable switch, direct builtin cards after editor, and saved entries survive reload');

    await page.goto(`${origin}/options.html#settings-model-usage`);
    await page.locator('#settings-model-usage').waitFor();
    assert.equal(await page.locator('.settings-page-tabs [aria-current=true]').innerText(), '模型用量');
    await page.locator('.settings-page-tabs button').filter({hasText: '翻译概览'}).click();
    await shot(page, 'stats-overview');
    await page.locator('.settings-page-tabs button').filter({hasText: '模型用量'}).click();
    await shot(page, 'stats-usage');
    await page.goto(`${origin}/options.html#settings-area-translation`);
    await page.locator('#settings-area-translation').waitFor();
    assert.equal(await page.locator('.nav-group-items [aria-current=page]').getAttribute('data-section'), 'settings-image-translation');
    assert.equal(await page.locator('.settings-page-tabs').count(), 0);
    await shot(page, 'image-area-alias');
    report.checks.push('model usage and region translation legacy links resolve to merged sections; statistics and website rules retain task view navigation');

    for (const section of sections) {
      await page.setViewportSize({width: 390, height: 900});
      await page.goto(`${origin}/options.html#${section.id}`);
      await page.locator(`#${section.id}`).waitFor({state: 'visible'});
      const overflow = await page.evaluate(() => ({body: document.documentElement.scrollWidth - innerWidth,
        card: document.querySelector('.settings-card').scrollWidth - document.querySelector('.settings-card').clientWidth}));
      report.pages.find(item => item.id === section.id).mobile = overflow;
      assert(overflow.body <= 1 && overflow.card <= 1, `${section.id} mobile overflow: ${JSON.stringify(overflow)}`);
      await shot(page, `${section.id}-mobile`);
    }
    report.checks.push('every settings page fits 390px without horizontal overflow');
    await patchConfig({theme: 'dark'});
    await page.setViewportSize({width: 1440, height: 960});
    for (const id of ['settings-selection', 'settings-image-translation', 'settings-glossary', 'settings-advanced', 'settings-vocabulary']) {
      await page.goto(`${origin}/options.html#${id}`); await page.locator(`#${id}`).waitFor();
      await shot(page, `${id}-dark`);
    }
    assert.deepEqual(report.consoleErrors, []); report.ok = true;
  } catch (error) {report.error = error.stack || String(error); throw error;}
  finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close(); fs.rmSync(profileDir, {recursive: true, force: true});
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
