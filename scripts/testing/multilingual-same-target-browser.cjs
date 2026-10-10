'use strict';
// 多语言同目标跳过专项（--multilingual-same-target）：由中文翻译 runner 提供临时后台 Edge、配置端口、
// 本地页面与 OpenAI 兼容响应夹具。本文件只操作 runner 创建的页面，点击和快捷键全部经 CDP 发送；
// 每个目标语言分别验证悬浮与全文零请求、相邻外语 [1,0,1]、标题、链接保留、动态改写和切换目标后重新识别。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modelPost = require('../../tests/fixtures/chinese-language-model-post.json');
const technicalParagraphs = require('../../tests/fixtures/chinese-technical-paragraphs.json');
const technicalChinese = process.argv.includes('--technical-chinese');
const filterIndex = process.argv.indexOf('--same-target-language');
const targetFilter = filterIndex < 0 ? null : process.argv[filterIndex + 1];
if (filterIndex >= 0) assert(targetFilter && !targetFilter.startsWith('--'), '--same-target-language 需要语言代码');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const commitUrl = 'https://github.com/solidSpoon/DashPlayer/commit/84522b3ff33401f87da8d5d7c4510ea5453e40ef';
const releaseNote = '云端模型清单允许清空，且不再连带拒掉无关偏好的保存';
const englishForeign = 'This English paragraph still needs a translation for the reader of this page.';
const englishDynamic = 'The dynamic paragraph was rewritten in English and it must be translated again.';
const germanDynamic = 'Dieser dynamische Absatz wurde ins Deutsche umgeschrieben und muss jetzt wieder übersetzt werden.';

const targetCases = [
  {target: 'de', title: 'Die neuesten Nachrichten aus der Stadt und der Region', same: [
    'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.',
    'Die Datei konnte nicht geöffnet werden.',
  ], foreign: englishForeign},
  {target: 'pt', title: 'Atualizamos a nossa política de privacidade para esclarecer quais configurações ficam guardadas no seu dispositivo', same: [
    'Este é um parágrafo em português que descreve as configurações do aplicativo e a tradução automática.',
  ], foreign: englishForeign},
  {target: 'it', title: 'Le novità della nuova versione', same: [
    "Questo paragrafo italiano descrive le impostazioni dell'applicazione e la traduzione automatica.",
  ], foreign: englishForeign},
  {target: 'fr', title: 'Les nouvelles du jour sur notre site', same: [
    'Bonjour et bienvenue sur notre site.',
    'Ce paragraphe explique comment l\'extension conserve le texte original et affiche la traduction juste en dessous.',
  ], foreign: englishForeign},
  {target: 'en', title: 'Latest news from the city and the region', same: [
    'Welcome to the settings page.',
    'Released GPT-6 Sol with improved reasoning and a smaller model for everyone.',
  ], foreign: 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.', dynamic: germanDynamic},
  {target: 'ru', title: 'Это заголовок страницы с настройками для нашего сайта', same: [
    'Добро пожаловать на наш сайт.',
    'Этот абзац объясняет, как расширение сохраняет исходный текст и показывает перевод прямо под ним.',
  ], foreign: englishForeign},
  {target: 'ja', title: '新しいモデルの発表について', same: [
    'GPT-6 Sol の新しいモデルを発表しました。',
    'この段落では、拡張機能が元のテキストを保持し、そのすぐ下に翻訳を表示する方法を説明します。',
  ], foreign: englishForeign},
  {target: 'ko', title: '새로운 기능 소개', same: [
    'GPT-6 Sol 모델의 새로운 기능을 소개합니다.',
    '이 단락은 확장 프로그램이 원문을 유지하면서 바로 아래에 번역을 표시하는 방법을 설명합니다.',
  ], foreign: englishForeign},
  {target: 'zh-Hans', title: modelPost[0], same: technicalChinese ? [...technicalParagraphs] : [...modelPost], github: true, foreign: englishForeign, technical: technicalChinese},
];
const selectedTargets = targetFilter ? targetCases.filter(item => item.target === targetFilter) : targetCases;
assert(selectedTargets.length > 0, `未知目标语言：${targetFilter}`);

function escapeHtml(value) {
  return value.replace(/[&<>"]/gu, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[character]);
}

/** 宿主页始终声明 lang="en"，证明判断只依据局部文本而非整页语言。 */
function renderMultilingualPage(target) {
  const item = targetCases.find(entry => entry.target === target);
  if (!item) return undefined;
  const same = item.same.map((text, index) => {
    const content = escapeHtml(text).replace('microsoft/onnxruntime#27399',
      '<a data-technical-reference href="https://github.com/microsoft/onnxruntime/pull/27399">microsoft/onnxruntime#27399</a>');
    return `<p data-same="${index}">${content}</p>`;
  }).join('');
  const github = item.github
    ? `<ul><li data-same="github">${releaseNote} (<a href="${commitUrl}">84522b3</a>)</li></ul>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(item.title)}</title></head>`
    + `<body style="padding:32px;font:20px/1.8 sans-serif"><main>${same}${github}`
    + `<p id="foreign">${escapeHtml(item.foreign)}</p><p id="dynamic">${escapeHtml(item.same[0])}</p></main></body></html>`;
}

/** 确定性响应：保留文本包标记，只在每个槽内容前加上目标标记。 */
function multilingualFixtureTranslation(source, targetName) {
  const marker = `[${String(targetName).trim()}] `;
  if (source.startsWith('___FLUENTREAD_')) {
    return source.replace(/(_\d+_BEGIN___)([\s\S]*?)(___FLUENTREAD_)/gu, (_match, begin, content, end) => `${begin}${marker}${content}${end}`);
  }
  return `${marker}${source}`;
}

async function runMultilingualSameTargetCases({context, createPage, patchConfig, activateExtensionTabWithoutForeground, shot, report, fixture, artifactsDir}) {
  report.multilingual = {cases: [], evidenceBoundary: 'Pages and chat-completion responses come from the local loopback fixture; request counts prove the extension decision chain, not external provider quality.'};
  report.scope = `Same-target languages: ${selectedTargets.map(item => item.target).join(', ')}; ${technicalChinese ? 'PR #779 technical Chinese' : 'multilingual'} paragraphs, hover/full-page zero requests, titles, links, dynamic redetection, target switch and excluded-language parity`;
  const sameTexts = item => [...item.same, ...(item.github ? [`${releaseNote} (84522b3)`, releaseNote] : []), item.title];
  const assertNoSameTargetRequest = (item, start) => {
    const leaked = fixture.requests.slice(start).filter(request => sameTexts(item).some(text => request.source.includes(text)));
    assert.deepEqual(leaked.map(request => request.source), [], `${item.target} 同目标文本不得进入请求`);
  };

  for (const item of selectedTargets) {
    await patchConfig({from: 'auto', to: item.target, useCache: false, excludedLanguages: [], pageTitleTranslationEnabled: true});
    const page = await createPage(`${fixture.url}/article?source=multilingual&target=${encodeURIComponent(item.target)}`, `multilingual-${item.target}`);
    const caseReport = {target: item.target, sameTargetElements: item.same.length + (item.github ? 1 : 0), status: 'running'};
    try {
      await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
      const start = fixture.requests.length;
      const wrappers = selector => page.locator(`${selector} .fluent-read-bilingual-content`).count();
      const sameSelectors = [...item.same.map((_, index) => `[data-same="${index}"]`), ...(item.github ? ['[data-same="github"]'] : [])];
      const originals = await Promise.all(sameSelectors.map(selector => page.locator(selector).innerText()));
      const hover = async selector => {
        await activateExtensionTabWithoutForeground(context, page, 30000);
        const element = page.locator(selector);
        await element.click({position: {x: 4, y: 4}}); await element.hover({position: {x: 4, y: 4}});
        await page.keyboard.down('Control'); await page.keyboard.up('Control');
      };
      const full = async () => {
        await activateExtensionTabWithoutForeground(context, page, 30000);
        await page.locator('main').click({position: {x: 2, y: 2}});
        await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
      };
      const assertSameTargetUntouched = async () => {
        for (const [index, selector] of sameSelectors.entries()) {
          assert.equal(await wrappers(selector), 0, `${item.target} ${selector} 不应插入译文`);
          assert.equal(await page.locator(selector).innerText(), originals[index]);
        }
        if (item.github) assert.equal(await page.locator('[data-same="github"] a').getAttribute('href'), commitUrl);
        if (item.technical) assert.equal(await page.locator('[data-technical-reference]').getAttribute('href'), 'https://github.com/microsoft/onnxruntime/pull/27399');
        assert.equal(await page.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
        assertNoSameTargetRequest(item, start);
      };

      for (const selector of sameSelectors) {
        await hover(selector);
        await wait(400);
      }
      assert.equal(fixture.requests.length, start, `${item.target} 同目标悬浮必须零请求`);
      await assertSameTargetUntouched();
      caseReport.hoverSameTargetRequests = 0;

      const hoverCounts = [];
      for (const expected of [1, 0, 1, 0]) {
        await hover('#foreign');
        await page.waitForFunction(expected => document.querySelectorAll('#foreign .fluent-read-bilingual-content').length === expected, expected);
        hoverCounts.push(await wrappers('#foreign'));
        await assertSameTargetUntouched();
      }
      caseReport.foreignHoverCounts = hoverCounts;

      const fullCounts = [];
      for (const expected of [1, 0, 1]) {
        await full();
        await page.waitForFunction(expected => document.querySelectorAll('#foreign .fluent-read-bilingual-content').length === expected, expected);
        await wait(500);
        fullCounts.push(await wrappers('#foreign'));
        assert.equal(await wrappers('#dynamic'), 0);
        assert.equal(await page.title(), item.title, `${item.target} 同目标标题不应翻译`);
        await assertSameTargetUntouched();
      }
      caseReport.foreignFullPageCounts = fullCounts;
      caseReport.titleRequests = fixture.requests.slice(start).filter(request => request.source.includes(item.title)).length;

      // 全文会话仍在进行：把同目标段落改写为新的外语句子后必须重新识别并请求，旧的跳过结论不能残留。
      const dynamicText = item.dynamic ?? englishDynamic;
      const beforeDynamic = fixture.requests.length;
      await page.locator('#dynamic').evaluate((element, text) => {element.textContent = text;}, dynamicText);
      await page.locator('#dynamic .fluent-read-bilingual-content').waitFor({state: 'visible'});
      assert(fixture.requests.slice(beforeDynamic).some(request => request.source.includes(dynamicText)), `${item.target} 动态外语必须请求`);
      caseReport.dynamicRedetection = true;
      await assertSameTargetUntouched();

      await shot(page, `multilingual-${item.target}`);
      fs.writeFileSync(path.join(artifactsDir, `multilingual-${item.target}.html`), await page.content());
      await full();
      await page.waitForFunction(() => document.querySelectorAll('.fluent-read-bilingual-content').length === 0);
      assert.equal(await page.locator('#dynamic').innerText(), dynamicText);
      await assertSameTargetUntouched();
      caseReport.restored = true;
      caseReport.requestSources = fixture.requests.slice(start).map(request => request.source);
      caseReport.status = 'passed';
    } catch (error) {
      caseReport.status = 'failed';
      caseReport.error = error.stack || String(error);
      await shot(page, `multilingual-${item.target}-failure`).catch(() => {});
      fs.writeFileSync(path.join(artifactsDir, `multilingual-${item.target}-failure.html`), await page.content().catch(() => ''));
      report.multilingual.cases.push(caseReport);
      throw error;
    } finally {
      await page.close();
    }
    report.multilingual.cases.push(caseReport);
  }

  // 同一页面切换目标语言：所选非英文正文原先跳过，切到英文后需要翻译，英文正文反而保留。
  const source = selectedTargets.find(item => item.target !== 'en') ?? targetCases[0];
  await patchConfig({to: source.target, excludedLanguages: []});
  const page = await createPage(`${fixture.url}/article?source=multilingual&target=${source.target}`, 'multilingual-target-switch');
  try {
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    const toggle = async () => {
      await activateExtensionTabWithoutForeground(context, page, 30000);
      await page.locator('main').click({position: {x: 2, y: 2}});
      await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
    };
    let start = fixture.requests.length;
    await toggle();
    await page.locator('#foreign .fluent-read-bilingual-content').waitFor({state: 'visible'});
    await wait(500);
    assert.equal(await page.locator('[data-same="0"] .fluent-read-bilingual-content').count(), 0);
    assertNoSameTargetRequestFor(fixture, start, source.same);
    await toggle();
    await page.waitForFunction(() => document.querySelectorAll('.fluent-read-bilingual-content').length === 0);
    await patchConfig({to: 'en'});
    await wait(300);
    start = fixture.requests.length;
    await toggle();
    await page.locator('[data-same="0"] .fluent-read-bilingual-content').waitFor({state: 'visible'});
    await wait(500);
    assert.equal(await page.locator('#foreign .fluent-read-bilingual-content').count(), 0, '切到英文目标后英文段落应保留');
    assert(fixture.requests.slice(start).some(request => request.source.includes(source.same[0])), '切到英文目标后原目标正文必须请求');
    assert(!fixture.requests.slice(start).some(request => request.source.includes(englishForeign)), '英文目标不得请求英文段落');
    await shot(page, 'multilingual-target-switch');
    fs.writeFileSync(path.join(artifactsDir, 'multilingual-target-switch.html'), await page.content());
    report.multilingual.targetSwitch = {status: 'passed', from: source.target, to: 'en'};
  } finally {
    await page.close();
  }

  // 排除语言与目标语言使用同一判断，选择其他目标并排除原目标语言时正文仍然零请求。
  const exclusionTarget = source.target === 'zh-Hans' ? 'ja' : 'zh-Hans';
  await patchConfig({to: exclusionTarget, excludedLanguages: [source.target]});
  const excluded = await createPage(`${fixture.url}/article?source=multilingual&target=${source.target}`, 'multilingual-excluded-language');
  try {
    await excluded.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    const start = fixture.requests.length;
    await activateExtensionTabWithoutForeground(context, excluded, 30000);
    await excluded.locator('main').click({position: {x: 2, y: 2}});
    await excluded.keyboard.down('Alt'); await excluded.keyboard.press('t'); await excluded.keyboard.up('Alt');
    await excluded.locator('#foreign .fluent-read-bilingual-content').waitFor({state: 'visible'});
    await wait(500);
    for (const index of source.same.keys()) {
      assert.equal(await excluded.locator(`[data-same="${index}"] .fluent-read-bilingual-content`).count(), 0);
    }
    assertNoSameTargetRequestFor(fixture, start, [...source.same, source.title]);
    await shot(excluded, 'multilingual-excluded-language');
    report.multilingual.excludedLanguage = {status: 'passed', target: exclusionTarget, excludedLanguages: [source.target]};
  } finally {
    await excluded.close();
  }
}

function assertNoSameTargetRequestFor(fixture, start, texts) {
  const leaked = fixture.requests.slice(start).filter(request => texts.some(text => request.source.includes(text)));
  assert.deepEqual(leaked.map(request => request.source), []);
}

module.exports = {runMultilingualSameTargetCases, renderMultilingualPage, multilingualFixtureTranslation, targetCases};
