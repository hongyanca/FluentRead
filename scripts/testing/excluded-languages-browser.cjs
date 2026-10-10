'use strict';
// Issue #627 专项：由中文翻译 runner 提供临时后台 Edge、配置端口与本地响应。
// 本文件只操作 runner 创建的页面，所有点击和快捷键通过 CDP 完成。
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function runExcludedLanguagesCases({context, popup, createPage, patchConfig, waitConfig,
  activateExtensionTabWithoutForeground, shot, report, fixture, extensionOrigin, paragraphs}) {
  const url = `${extensionOrigin}/options.html#settings-translation`;
  const openSettings = async name => {
    const page = await createPage(url, name);
    await page.locator('[data-testid="excluded-language-settings"]').waitFor({state: 'visible'});
    await page.locator('[data-testid="excluded-language-settings"]').scrollIntoViewIfNeeded();
    return page;
  };
  const choice = (page, language) => page.locator(`[data-testid="excluded-language-settings"] [data-language="${language}"]`);
  const selected = async (page, expected) => {
    await page.waitForFunction(expected => {
      const actual = [...document.querySelectorAll('[data-testid="excluded-language-settings"] [aria-pressed="true"]')].map(el => el.dataset.language);
      return JSON.stringify(actual) === JSON.stringify(expected);
    }, expected);
  };
  let settings = await openSettings('excluded-settings');
  await selected(settings, []);
  await choice(settings, 'zh-Hant').click();
  await choice(settings, 'en').click();
  await settings.close();
  await waitConfig(config => JSON.stringify(config.excludedLanguages) === JSON.stringify(['zh-Hant', 'en']));
  settings = await openSettings('excluded-settings-reopened');
  await selected(settings, ['zh-Hant', 'en']);
  const other = await openSettings('excluded-settings-sync');
  await choice(settings, 'ja').focus();
  await settings.keyboard.press('Space');
  await selected(other, ['zh-Hant', 'en', 'ja']);
  await choice(other, 'en').click();
  await selected(settings, ['zh-Hant', 'ja']);
  await settings.getByRole('button', {name: '更多语言', exact: true}).click();
  await choice(settings, 'de').click();
  await settings.getByRole('button', {name: '收起语言', exact: true}).click();
  assert(await choice(settings, 'de').isVisible(), '收起后必须保留已选语言');
  await choice(settings, 'de').click();
  await selected(other, ['zh-Hant', 'ja']);
  report.ui.quickClose = true;
  report.ui.crossPageSync = true;
  report.ui.latestWriteWins = true;
  report.ui.keyboardSelection = true;
  report.ui.collapsedSelectionVisible = true;
  await other.close();
  assert(await settings.locator('[data-testid="excluded-language-settings"]').evaluate(el => {
    const groups = [...document.querySelectorAll('.settings-group')].filter(group => group.getBoundingClientRect().height > 0);
    return groups.at(-1) === el;
  }), '排除语言必须位于翻译设置最后');
  report.ui.lastTranslationSetting = true;
  report.ui.locales = [];
  const localeCases = {
    'zh-CN': ['不翻译的语言', '简体中文', '繁體中文'],
    'en-US': ['Languages to skip', 'Simplified Chinese', 'Traditional Chinese'],
    'ja-JP': ['翻訳しない言語', '中国語（簡体字）', '中国語（繁体字）'],
    'ko-KR': ['번역하지 않을 언어', '중국어 간체', '중국어 번체'],
    'fr-FR': ['Langues à ne pas traduire', 'chinois simplifié', 'chinois traditionnel'],
    'ru-RU': ['Языки без перевода', 'китайский (упрощённый)', 'китайский (традиционный)'],
    'es-ES': ['Idiomas que no se traducen', 'Chino simplificado', 'Chino tradicional'],
  };
  for (const [locale, [title, simplified, traditional]] of Object.entries(localeCases)) {
    await patchConfig({uiLanguage: locale});
    await settings.locator('[data-testid="excluded-language-settings"] h2').filter({hasText: title}).waitFor({state: 'visible'});
    await settings.locator('[data-testid="excluded-language-settings"]').scrollIntoViewIfNeeded();
    assert.equal((await choice(settings, 'zh-Hans').innerText()).trim(), simplified);
    assert.equal((await choice(settings, 'zh-Hant').innerText()).trim(), traditional);
    if (locale === 'zh-CN') {
      assert.equal((await choice(settings, 'ja').innerText()).trim(), '日语');
      assert.equal((await choice(settings, 'en').innerText()).trim(), '英语');
    }
    const text = await settings.locator('[data-testid="excluded-language-settings"]').innerText();
    assert(!text.includes('settings.excludedLanguages.'));
    if (locale !== 'zh-CN') {
      for (const chinese of ['选择你无需翻译', '更多语言', '清空选择', '自动保存']) assert(!text.includes(chinese));
    }
    await selected(settings, ['zh-Hant', 'ja']);
    report.ui.locales.push({locale, title, simplified, traditional, status: 'passed'});
    await shot(settings, `excluded-settings-locale-${locale}`);
    await shot(settings.locator('[data-testid="excluded-language-settings"]'), `excluded-language-card-${locale}`);
  }
  await patchConfig({uiLanguage: 'zh-CN'});
  report.ui.layouts = [];
  for (const theme of ['light', 'dark']) {
    await patchConfig({theme});
    for (const width of theme === 'light' ? [1440, 1024, 820, 390] : [1440, 390]) {
      await settings.setViewportSize({width, height: 900});
      const group = settings.locator('[data-testid="excluded-language-settings"]');
      await group.scrollIntoViewIfNeeded();
      await wait(150);
      const layout = await group.evaluate(el => {
        const box = el.getBoundingClientRect();
        return {width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth,
          buttonOverflow: [...el.querySelectorAll('[data-language]')].some(button => {
            const rect = button.getBoundingClientRect();
            return rect.left < box.left || rect.right > box.right;
          }), rowCount: new Set([...el.querySelectorAll('[data-language]')].map(button => Math.round(button.getBoundingClientRect().top))).size};
      });
      assert.equal(layout.pageOverflow, false);
      assert.equal(layout.buttonOverflow, false);
      report.ui.layouts.push({theme, ...layout});
      await shot(settings, `excluded-settings-${theme}-${width}`);
    }
  }
  await settings.setViewportSize({width: 1440, height: 900});
  await patchConfig({theme: 'light', from: 'auto', to: 'zh-Hans', useCache: false, pageTitleTranslationEnabled: true});
  const page = await createPage(`${fixture.url}/article?source=excluded-languages`, 'excluded-page');
  await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
  const wrapper = id => page.locator(`#${id} .fluent-read-bilingual-content`);
  const hover = async id => {
    await activateExtensionTabWithoutForeground(context, page, 30000);
    const element = page.locator(`#${id}`);
    await element.click(); await element.hover();
    await page.keyboard.down('Control'); await page.keyboard.up('Control');
  };
  const full = async () => {
    await activateExtensionTabWithoutForeground(context, page, 30000);
    await page.locator('main').click({position: {x: 5, y: 5}});
    await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
  };
  let start = fixture.requests.length;
  await hover('traditional-control');
  await wait(500);
  assert.equal(fixture.requests.length, start, '繁体悬浮不应发送请求');
  assert.equal(await wrapper('traditional-control').count(), 0);
  const hoverCounts = [];
  for (const count of [1, 0, 1, 0]) {
    await hover('english-control');
    await page.waitForFunction(count => document.querySelectorAll('#english-control .fluent-read-bilingual-content').length === count, count);
    hoverCounts.push(await wrapper('english-control').count());
  }
  report.fixture.cases.push({name: 'hover-exclusion-and-neighbor', status: 'passed', excludedRequests: 0, neighborCounts: hoverCounts});
  start = fixture.requests.length;
  for (const count of [1, 0, 1]) {
    await full();
    await page.waitForFunction(count => document.querySelectorAll('#english-control .fluent-read-bilingual-content').length === count, count);
    await wait(300);
    assert.equal(await wrapper('traditional-control').count(), 0);
    assert.equal(await wrapper('japanese-control').count(), 0);
    assert.equal(await page.title(), paragraphs['zh-Hant'][0]);
  }
  assert(fixture.requests.slice(start).every(request => !request.source.includes(paragraphs['zh-Hant'][0]) && !request.source.includes('これは')));
  report.fixture.cases.push({name: 'full-page-restore-repeat-and-title', status: 'passed', excludedRequests: 0, neighborCounts: [1, 0, 1]});
  await shot(page, 'excluded-mixed-page');
  await page.locator('#traditional-control').evaluate((el, text) => {el.textContent = text;}, paragraphs.en[1]);
  await wrapper('traditional-control').waitFor({state: 'visible'});
  report.fixture.cases.push({name: 'dynamic-excluded-text-becomes-english', status: 'passed'});
  await page.close();
  await patchConfig({autoTranslate: true});
  start = fixture.requests.length;
  const automatic = await createPage(`${fixture.url}/article?source=excluded-languages&mode=auto`, 'excluded-auto');
  await automatic.locator('#english-control .fluent-read-bilingual-content').waitFor({state: 'visible'});
  await wait(500);
  assert.equal(await automatic.locator('#traditional-control .fluent-read-bilingual-content').count(), 0);
  assert.equal(await automatic.locator('#japanese-control .fluent-read-bilingual-content').count(), 0);
  assert.equal(await automatic.title(), paragraphs['zh-Hant'][0]);
  assert(fixture.requests.slice(start).every(request => !request.source.includes(paragraphs['zh-Hant'][0])));
  report.fixture.cases.push({name: 'automatic-full-page', status: 'passed', excludedRequests: 0});
  await automatic.close();
  await patchConfig({autoTranslate: false});
  await settings.getByRole('button', {name: '清空选择', exact: true}).click();
  await waitConfig(config => config.excludedLanguages.length === 0);
  await settings.reload({waitUntil: 'domcontentloaded'});
  await selected(settings, []);
  const restored = await createPage(`${fixture.url}/article?source=zh-Hant&mode=cleared`, 'excluded-cleared');
  await restored.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
  await activateExtensionTabWithoutForeground(context, restored, 30000);
  await restored.locator('#chinese-primary').click(); await restored.locator('#chinese-primary').hover();
  await restored.keyboard.down('Control'); await restored.keyboard.up('Control');
  await restored.locator('#chinese-primary .fluent-read-bilingual-content').waitFor({state: 'visible'});
  assert.equal((await restored.locator('#chinese-primary .fluent-read-bilingual-content').innerText()).trim(), paragraphs['zh-Hans'][0]);
  report.fixture.cases.push({name: 'clear-restores-traditional-to-simplified', status: 'passed'});
  await restored.close();
  await choice(settings, 'zh-Hant').click(); await choice(settings, 'ja').click();
  await waitConfig(config => JSON.stringify(config.excludedLanguages) === JSON.stringify(['zh-Hant', 'ja']));
  await popup.reload({waitUntil: 'domcontentloaded'});
  await settings.reload({waitUntil: 'domcontentloaded'});
  await selected(settings, ['zh-Hant', 'ja']);
  await settings.locator('[data-testid="excluded-language-settings"]').scrollIntoViewIfNeeded();
  await shot(settings, 'excluded-settings-final');
  report.ui.reopenPersistence = true;
  report.ui.clearSelection = true;
  await settings.close();
};
