#!/usr/bin/env node
'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
// 阅读与样式生产专项：第二屏临时后台 Edge、本地译文、29 种多行样式、八种逐句高亮和字体首帧/切换/清理。
// 运行时传入 --extension-dir、--artifacts-dir、--playwright-root、--focus-safe-helper；--page-only true 仅跑网页矩阵。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const argument = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const subset = (actual, expected) => expected && typeof expected === 'object' && !Array.isArray(expected)
  ? actual && Object.entries(expected).every(([key, value]) => subset(actual[key], value))
  : JSON.stringify(actual) === JSON.stringify(expected);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assertScaled = (actual, base, scale, label) => assert(Math.abs(Number.parseFloat(actual) - Number.parseFloat(base) * scale) < 0.05, `${label}: ${actual} vs ${base} × ${scale}`);
const SOURCE = 'Reading should feel calm and effortless. Colors and lines should follow the page you are reading.';
const TRANSLATION = '阅读应该轻松、自然。颜色和线条应当贴合你正在阅读的网页。';
const DEFAULT_APPEARANCE = {textColor: '', backgroundColor: '', lineColor: '', fillColor: '', fontScale: 100, fontWeight: 'default', fontFamily: 'default', opacity: 100, customCss: ''};
const EXPECTED_CATEGORY_COUNTS = {文字: 8, 线条: 10, 标记: 7, 卡片: 4};

async function startFixture(own = () => {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    if (request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = body.messages.filter(item => item.role === 'user').map(item => item.content).join('\n');
      const text = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1] || '';
      requests.push({source: text});
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({id: 'translation-style-fixture', object: 'chat.completion', created: 1, model: 'fixture',
        choices: [{index: 0, message: {role: 'assistant', content: text.replaceAll(SOURCE, TRANSLATION).replaceAll('linked phrase', '链接短语').replaceAll('bold words', '加粗词语')}, finish_reason: 'stop'}]}));
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Translation style fixture</title><style>body{margin:0;padding:48px 8vw;font:18px/1.8 system-ui;color:#263044;background:#fff}main{max-width:620px}p{margin:28px 0}</style></head><body><main><h1 translate="no">Translation style fixture</h1><p id="primary">${Array(5).fill(SOURCE).join(" ")}</p><p id="rich">${SOURCE} <a href="#example">linked phrase</a>. ${SOURCE} <strong>bold words</strong>. ${SOURCE}</p></main></body></html>`);
  });
  const fixture = {requests, close: () => new Promise((resolve, reject) => server.close(error => {
    if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve();
  }))};
  own(fixture);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {...fixture, url: `http://127.0.0.1:${server.address().port}`};
}

async function main() {
  const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
  const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-translation-style'));
  const packages = argument('playwright-root'); const helperPath = argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'));
  assert(packages && helperPath, '需要 --playwright-root 与 --focus-safe-helper'); assert(fs.existsSync(path.join(extensionDir, 'manifest.json')));
  const {chromium} = require(require.resolve('playwright', {paths: [packages]}));
  const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-translation-style-edge-'));
  const report = {ok: false, extensionDir, profileDir, artifactsDir, checks: [], consoleErrors: [], screenshots: [], metrics: {},
    evidenceBoundary: 'Local deterministic HTML/provider in an isolated Edge profile; no Firefox runtime or external provider claim.'};
  let launched, fixture, primaryError;
  let launchAttempted = false;
  try {
    fixture = await startFixture(owned => { fixture = owned; });
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
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
      await result.setViewportSize({width:1440,height:960});
      await result.goto(url, {waitUntil: 'domcontentloaded'}); return result;
    };
    const shot = async (surface, name) => {
      const owner = typeof surface.page === 'function' ? surface.page() : surface;
      const viewport = owner.viewportSize();
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
      await surface.screenshot({path: file}); report.screenshots.push(file);
      if (expanded) await owner.setViewportSize(viewport);
    };
    console.log('launch verified');
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
        baseRevision: initial ? current.__fluentConfigRevision : undefined, clientId: `translation-style-${crypto.randomUUID()}`, sequence: 1,
      }), {patch, current, expected, initial});
      assert.equal(result?.success, true, result?.error);
      await untilConfig(config => Object.keys(patch).filter(key => key !== 'token').every(key => subset(config[key], patch[key])));
    };
    const service = 'custom:translation-style-fixture';
    await patchConfig({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, on: true, theme: 'light', interfaceSkin: 'default',
      display: 1, style: 1, translationAppearance: DEFAULT_APPEARANCE, service, from: 'en', to: 'zh-Hans', useCache: false,
      autoTranslate: false, bilingualSentenceHighlightEnabled: false, translationBeforeOriginal: false,
      customOpenAIProviders: [{id: service, name: '译文样式夹具', endpoint: `${fixture.url}/v1/chat/completions`, models: ['fixture']}],
      token: {[service]: 'synthetic-local-fixture-not-a-secret'}, model: {[service]: 'fixture'},
      user_role: {[service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'}, enableAIContext: false, enableAIMultiSegment: false,
      glossaryEnabled: false, hotkey: 'Control', floatingBallHotkey: 'Alt+T', mouseHoverTranslationDelay: 0,
      selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, animations: false});

    // 在界面交互前创建网页页签，避免设置页多次重排后再创建窗口导致 Edge 抢占前台。
    const page = await createPage(`${fixture.url}/article`);
    await page.setViewportSize({width: 980, height: 1300});

    if(!argument('page-only',false)) {
    const options = await createPage(`${origin}/options.html#settings-general`);
    await options.getByTestId('open-translation-style-settings').waitFor({state: 'visible'});
    assert.equal(await options.getByText('启动插件', {exact: true}).count(), 1);
    await patchConfig({on: false});
    await popup.getByText('插件已关闭', {exact: true}).waitFor({state: 'attached'});
    await shot(options.locator('#settings-general'), '01-start-extension');
    await patchConfig({on: true});
    await options.getByTestId('open-translation-style-settings').click();
    const group = options.locator('.translation-style-group');
    await group.waitFor({state: 'visible'});
    const preview = group.getByTestId('bilingual-highlight-preview-translation');
    const categoryCounts = {};
    for (const [category, expectedCount] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
      await group.locator('.translation-style-categories').getByRole('radio', {name: category, exact: true}).click();
      const cards = group.locator('.translation-style-card');
      categoryCounts[category] = await cards.count(); assert.equal(categoryCounts[category], expectedCount);
      for (let index = 0; index < expectedCount; index++) {
        const card = cards.nth(index); const value = Number(await card.getAttribute('data-style-value'));
        await card.click(); await untilConfig(config => config.style === value);
        const klass = (await card.locator('.fluent-read-bilingual-content').getAttribute('class')).split(/\s+/u).find(c => c.startsWith('fluent-display-'));
        assert((await preview.getAttribute('class')).split(/\s+/u).includes(klass));
      }
    }
    report.metrics.categoryCounts = categoryCounts;
    for (const width of [1440, 1024, 820, 390]) {
      await options.setViewportSize({width, height: 960});
      const boxes = await group.evaluate(root => {
        const a = root.querySelector('.translation-style-stage').getBoundingClientRect();
        const b = root.querySelector('.translation-style-gallery').getBoundingClientRect();
        return {preview: {x:a.x,y:a.y,right:a.right,bottom:a.bottom}, gallery:{x:b.x,y:b.y,right:b.right,bottom:b.bottom}, overflow:document.documentElement.scrollWidth > innerWidth};
      });
      assert.equal(boxes.overflow,false);
      assert(width === 1440 ? boxes.preview.right <= boxes.gallery.x + 2 : boxes.preview.x <= boxes.gallery.x + 2 && boxes.preview.y <= boxes.gallery.y, `preview order ${width}`);
      report.metrics[`layout${width}`]=boxes;
      if ([1440,390].includes(width)) await shot(group, `02-style-layout-${width}`);
    }
    await options.setViewportSize({width:1440,height:960});
    await options.goto(`${origin}/options.html#settings-translation`);
    await options.locator('#translation-sentence-highlight').waitFor({state:'visible'});
    const reading = options.locator('.reading-assistance-example');
    assert.equal((await options.locator('#settings-translation .settings-group-heading h2').first().innerText()).trim(),'阅读辅助');
    await options.locator('#translation-sentence-highlight .el-switch').click();
    await untilConfig(c=>c.bilingualSentenceHighlightEnabled);
    assert.equal(await reading.locator('.is-sentence-highlighted').count(),2);
    await shot(options.locator('#settings-translation'), '03-reading-enabled');
    await reading.locator('.reading-assistance-style-link').click();
    const highlights = options.locator('#translation-sentence-highlight-style');
    await highlights.waitFor({state:'visible'});
    assert.equal(await highlights.locator('.sentence-highlight-option').count(),8);assert.equal(await highlights.locator('.sentence-highlight-option small').count(),0);
    for (const id of ['rose','mint','sky','underline','amber','lavender','slate','dotted']) {
      await highlights.locator(`[data-highlight-style="${id}"]`).click();
      await untilConfig(c=>c.bilingualSentenceHighlightStyle===id);
      assert.equal(await highlights.getByTestId('bilingual-highlight-preview').getAttribute('data-fr-bilingual-sentence-highlight-style'),id);
      await page.waitForFunction(id=>document.documentElement.getAttribute('data-fr-bilingual-sentence-highlight-style')===id,id);
    }
    await shot(highlights,'04-highlight-styles');
    await highlights.locator('.translation-style-preview-theme').getByRole('radio',{name:'深色网页',exact:true}).click();
    await shot(highlights,'05-highlight-dark');
    report.checks.push('master copy; all 29 UI presets; preview left/first at 1440/1024/820/390; reading first item; immediate bilingual demo; eight persisted highlight styles');

    console.log('settings layouts and highlights passed');
    // 真正的已校验字体缓存，不使用替换字体或用户 profile。首帧额外延迟缓存读取来暴露闪烁。
    const manifest = JSON.parse(fs.readFileSync(path.resolve('assets/interface-fonts/manifest.json'),'utf8'));
    const fonts = manifest.fonts.filter(f=>['Inter.woff2','NotoSansSC.woff2'].includes(f.asset)).map(f=>({...f,data:fs.readFileSync(path.resolve('assets/interface-fonts',f.asset)).toString('base64')}));
    await popup.evaluate(async fonts=>{const cache=await caches.open('fluentread-interface-fonts-v1');for(const f of fonts){const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));await cache.put(`https://fluentread.app/__interface_fonts__/${f.assetSha256}`,new Response(bytes));}},fonts);
    await patchConfig({interfaceFont:'inter'});
    await options.reload();
    await options.locator('[data-font="inter"]').waitFor({state:'visible'});
    // 卡片使用 data 属性，容量与实际清除的独占文件一致。
    const interCard=options.locator('[data-font="inter"]');
    const clear=interCard.locator('.interface-font-clear');
    await clear.waitFor({state:'visible'});
    assert.equal((await clear.innerText()).trim(),`清除（${(fonts.find(f=>f.asset==='Inter.woff2').bytes/1024).toFixed(1)} KB）`);
    assert(!(await clear.innerText()).includes('{'));
    await shot(options.locator('.interface-font-group'),'06-font-cache-size');
    report.metrics.firstFrames=[];
    for(const entry of ['popup.html','options.html#settings-interface']) {
      const fresh=await newPageWithoutForeground(context,30000);
      await fresh.addInitScript(()=>{
        const match=Cache.prototype.match;Cache.prototype.match=async function(...args){await new Promise(r=>setTimeout(r,350));return match.apply(this,args)};
        window.__frames=[];const sample=()=>{const root=document.querySelector('.popup-shell,.settings-app');if(root&&getComputedStyle(root).display!=='none'){window.__frames.push({family:getComputedStyle(root).fontFamily,font:document.documentElement.dataset.interfaceFont,faces:[...document.fonts].map(f=>({family:f.family,status:f.status}))})}requestAnimationFrame(sample)};requestAnimationFrame(sample);
      });
      await fresh.goto(`${origin}/${entry}`);await fresh.locator(entry.startsWith('popup')?'.popup-shell':'.settings-app').waitFor({state:'visible'});await wait(150);
      const frames=await fresh.evaluate(()=>window.__frames);
      assert(frames.length>0);assert(frames.every(f=>f.family.includes('FluentRead Inter')&&f.faces.some(a=>a.family==='FluentRead Inter'&&a.status==='loaded')),`${entry} fallback font frame`);
      report.metrics.firstFrames.push({entry,count:frames.length,first:frames[0]});await fresh.close();
    }
    report.checks.push('clear cache shows actual exclusive Inter bytes; popup/options first rendered frame uses verified cached Inter even with delayed cache access');
    await patchConfig({bilingualSentenceHighlightEnabled:false});

    report.metrics.fontDownloadFrames=[];
    await context.route('**/*.woff2',async route=>{
      const asset=decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      const file=path.resolve('assets/interface-fonts',asset);assert(fs.existsSync(file));
      report.metrics.fontDownloadFrames.push(await options.locator('.settings-app').evaluate(e=>getComputedStyle(e).fontFamily));
      await wait(450);await route.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(file)});
    });
    await activateExtensionTabWithoutForeground(context,options,30000);
    await options.evaluate(()=>{window.__switchFrames=[getComputedStyle(document.querySelector('.settings-app')).fontFamily];window.__recordSwitch=true;const sample=()=>{if(window.__recordSwitch){window.__switchFrames.push(getComputedStyle(document.querySelector('.settings-app')).fontFamily);requestAnimationFrame(sample)}};requestAnimationFrame(sample)});
    await options.locator('[data-font="roboto"] .interface-font-action').click();await untilConfig(c=>c.interfaceFont==='roboto');
    await options.waitForFunction(()=>document.documentElement.dataset.interfaceFont==='roboto');
    assert(report.metrics.fontDownloadFrames.length>0);assert(report.metrics.fontDownloadFrames[0].includes('FluentRead Inter'));
    const switched=await options.evaluate(()=>{window.__recordSwitch=false;return window.__switchFrames});
    assert(switched.some(s=>s.includes('FluentRead Inter')));assert(switched.every(s=>s.includes('FluentRead Inter')||s.includes('FluentRead Roboto')));
    report.metrics.fontSwitch={frames:switched.length,families:[...new Set(switched)]};
    await patchConfig({interfaceFont:'inter'});await options.waitForFunction(()=>document.documentElement.dataset.interfaceFont==='inter');
    await clear.click();await options.locator('.el-message-box__btns button').last().click();await untilConfig(c=>c.interfaceFont==='system');
    const remaining=await popup.evaluate(async()=>{const c=await caches.open('fluentread-interface-fonts-v1');return(await c.keys()).map(r=>r.url)});
    assert(!remaining.some(k=>k.endsWith(fonts.find(f=>f.asset==='Inter.woff2').assetSha256)));assert(remaining.some(k=>k.endsWith(fonts.find(f=>f.asset==='NotoSansSC.woff2').assetSha256)));
    report.checks.push('font switch keeps Inter during delayed Roboto download; clearing active Inter restores system and retains shared Noto cache');
    console.log('font startup and switch passed');
    }
    const presetsSource=fs.readFileSync(path.resolve('src/core/config/translationAppearance.ts'),'utf8');
    const presets=[...presetsSource.matchAll(/\{value:\s*(\d+),\s*className:\s*'([^']*)',\s*label:\s*'([^']*)'/gu)].map(m=>({value:Number(m[1]),className:m[2],label:m[3]}));
    assert.equal(presets.length,29);
    await page.evaluate(()=>{window.__identities=[document.querySelector('#primary').firstChild,document.querySelector('#rich').firstChild,document.querySelector('#rich a'),document.querySelector('#rich strong')];window.__sourceHTML=[document.querySelector('#primary').innerHTML,document.querySelector('#rich').innerHTML];});
    const toggle=async(selector,expected)=>{
      await activateExtensionTabWithoutForeground(context,page,30000);
      await page.locator(selector).hover();await page.keyboard.down('Control');await page.keyboard.up('Control');
      await page.waitForFunction(({selector,expected})=>document.querySelectorAll(`${selector} > .fluent-read-bilingual-content`).length===expected,{selector,expected});
    };
    report.metrics.styleMatrix=[];
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.body.style.color=theme==='dark'?'#e7eaf1':'#263044';document.body.style.background=theme==='dark'?'#171b24':'#ffffff';},theme);
      for(const preset of presets) {
        await patchConfig({style:preset.value});await wait(70);
        await toggle('#primary',1);await toggle('#rich',1);
        const result=await page.evaluate(preset=>{
          return ['primary','rich'].map(id=>{
            const root=document.getElementById(id),text=root.querySelector('.fluent-read-bilingual-content');const s=getComputedStyle(text);
            const inner=text.querySelector('.fluent-read-translation-text');const range=document.createRange();range.selectNodeContents(text);
            return {id,classes:[...text.classList],display:s.display,color:s.color,parentColor:getComputedStyle(root).color,background:s.backgroundColor,decoration:s.textDecorationLine,lineStyle:s.textDecorationStyle,borderBottom:s.borderBottomWidth,textRects:range.getClientRects().length,overflow:text.scrollWidth>text.clientWidth+1,inner:inner?{display:getComputedStyle(inner).display,clone:getComputedStyle(inner).webkitBoxDecorationBreak,rects:inner.getClientRects().length,width:inner.getClientRects()[inner.getClientRects().length-1]?.width,wrapperWidth:text.getBoundingClientRect().width}:null,sourceLinks:[...root.querySelectorAll('a')].filter(e=>!e.closest('.fluent-read-bilingual-content')).length,sourceBold:[...root.querySelectorAll('strong')].filter(e=>!e.closest('.fluent-read-bilingual-content')).length};
          });
        },preset);
        report.metrics.styleMatrix.push({theme,...preset,result,html:await page.locator('#rich').innerHTML()});
        for(const r of result){assert(r.classes.includes(preset.className),`${preset.label} class`);assert.equal(r.display,'block');assert.equal(r.overflow,false,`${theme}/${preset.label} overflow`);assert(r.textRects>=2);if([10,11].includes(preset.value)){assert(r.inner);assert.equal(r.inner.clone,'clone');assert(r.inner.rects>1);assert(r.inner.width<r.inner.wrapperWidth-20,`${preset.label} trailing blank fill`)}if([4,5,6,19,24,25].includes(preset.value)){assert.equal(r.decoration,'underline');assert.equal(r.borderBottom,'0px')}if(preset.value===21)assert.equal(r.color,r.parentColor);}
        assert.equal(result[1].sourceLinks,1);assert.equal(result[1].sourceBold,1);
        console.log('page style passed',theme,preset.value);

        if([10,11,4,21].includes(preset.value)) await shot(page,`07-${theme}-${preset.value}`);
        await toggle('#primary',0);await toggle('#rich',0);
        assert.equal(await page.evaluate(()=>window.__identities.every((n,i)=>n===[document.querySelector('#primary').firstChild,document.querySelector('#rich').firstChild,document.querySelector('#rich a'),document.querySelector('#rich strong')][i])&&window.__sourceHTML.every((html,i)=>html===document.querySelector(i?'#rich':'#primary').innerHTML)),true);
        // 每个预设都验证恢复后的下一次翻译仍使用正确外观。
        await toggle('#primary',1);assert((await page.locator('#primary > .fluent-read-bilingual-content').getAttribute('class')).includes(preset.className));await toggle('#primary',0);
      }
    }
    report.checks.push('29 real-page presets × light/dark × multiline/rich text; per-line markings and underlines; no overflow; original DOM identities preserved; translate/restore/retranslate');
    await patchConfig({style:0,bilingualSentenceHighlightEnabled:true});
    await toggle('#primary',1);
    for(const id of ['rose','mint','sky','underline','amber','lavender','slate','dotted']){
      await patchConfig({bilingualSentenceHighlightStyle:id});await wait(100);
      const point=await page.evaluate(()=>{const r=document.createRange();r.setStart(document.querySelector('#primary').firstChild,0);r.setEnd(document.querySelector('#primary').firstChild,10);const b=r.getBoundingClientRect();return{x:b.x+10,y:b.y+b.height/2}});
      await page.mouse.move(point.x,point.y);await wait(120);
      const ranges=await page.evaluate(()=>[...CSS.highlights.get('fluentread-bilingual-sentence')||[]].map(r=>r.toString()));
      assert(ranges.length>=2);assert(ranges.some(s=>s.includes('Reading should feel')));assert(ranges.some(s=>s.includes('阅读应该')));
      await shot(page,`08-native-highlight-${id}`);
    }
    await patchConfig({bilingualSentenceHighlightEnabled:false});
    assert.equal(await page.evaluate(()=>CSS.highlights.has('fluentread-bilingual-sentence')),false);
    await toggle('#primary',0);
    report.checks.push('eight native CSS Highlight presets synchronize source/translation; disabling clears native ranges');
    assert.deepEqual(report.consoleErrors,[]);
    report.requests=fixture.requests.length;report.ok=true;
  } catch(error){primaryError=error;report.error=error.stack||String(error);throw error;}
  finally {
    report.fixtureRequests = fixture?.requests || [];
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
    await cleanup('HTTP fixture', async () => { if (fixture) await fixture.close(); });
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
  console.log(JSON.stringify({ok:report.ok,checks:report.checks,metrics:{styles:report.metrics.styleMatrix?.length},report:path.join(artifactsDir,'report.json')}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
