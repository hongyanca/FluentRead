#!/usr/bin/env node
/**
 * @file scripts/testing/run-codeforces-translation-test.cjs
 * 在临时后台 Edge 中验证 issue #492：默认全文、悬浮、恢复、公式动态更新与划词触发。
 * 本地夹具保留 Codeforces 实际 MathJax v2 渲染结构；--live 追加 issue 中的真实站点。
 * 翻译响应固定在后台 fetch 边界，报告不代表真实供应商质量，不触碰用户浏览器配置。
 */
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const args = {focusSafeHelper: path.join(__dirname, 'focus-safe-browser.cjs'), timeout: 30000, live: false};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--background') continue;
  if (key === '--live') { args.live = true; continue; }
  assert.ok(key.startsWith('--') && process.argv[i + 1], `Invalid argument ${key}`);
  args[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = process.argv[++i];
}
for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
  assert.ok(args[key], `Missing ${key}`); args[key] = path.resolve(args[key]);
}
args.timeout = Number(args.timeout);
const root = path.resolve(__dirname, '../..');
const helper = require(args.focusSafeHelper);
const {chromium} = createRequire(path.join(args.playwrightRoot, 'codeforces-test.cjs'))('playwright');
const owned = '.fluent-read-bilingual-content';
const report = {provider: 'microsoft-local-deterministic-response', profileMode: 'new-temporary-profile', cases: [], errors: []};
fs.mkdirSync(args.artifactsDir, {recursive:true});
const save = () => fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const children = node => [...(node.children || []), ...(node.shadowRoots || [])];
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of children(node)) {const result = find(child, predicate); if (result) return result;}
  return null;
}
function attr(node, name) {const a = node.attributes || [];const i = a.indexOf(name);return i < 0 ? '' : a[i+1];}
const hasClass = name => node => attr(node, 'class').split(/\s+/).includes(name);
const text = node => node.nodeName === '#text' ? node.nodeValue : children(node).map(text).join('');
async function main() {
  assertFreshProductionExtension(args.extensionDir, root);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-codeforces-'));
  let session, lastPage, lastWorker;
  let primaryError;
  const cdpSessions = new Set();
  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true,
      headless: false, viewport: {width:1280,height:1000}, displayTarget:'secondary', timeout:args.timeout,
      browserArgs:[`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    const context = session.context;
    context.on('page', page => page.on('pageerror',error=>report.errors.push(error.message)));
    Object.assign(report, {launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const installed = new WeakMap();
    const install = worker => {
      if (!installed.has(worker)) installed.set(worker, worker.evaluate(() => {
        globalThis.formulaRequests = [];
        globalThis.fetch = async (input, init) => {
          const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
          if (url.hostname !== 'edge.microsoft.com' || url.pathname !== '/translate/translatetext') throw new Error(`Unexpected provider URL: ${url.origin}`);
          const origins = JSON.parse(init?.body ?? await input.text());
          globalThis.formulaRequests.push(...origins);
          return new Response(JSON.stringify(origins.map(() => ({translations:[{text:'这是题面的中文译文'}]}))), {status:200,headers:{'content-type':'application/json'}});
        };
      }));
      return installed.get(worker);
    };
    context.on('serviceworker', worker => {void install(worker).catch(e=>report.errors.push(e.message));});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:args.timeout});
    await install(worker); lastWorker=worker;
    const popup = await helper.newPageWithoutForeground(context, args.timeout);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(600);
    let sequence = 0;
    const patch = async updates => {
      const result = await popup.evaluate(async ({updates,sequence}) => {
        const response = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
        if (!response.success) throw new Error(response.error);
        const current = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
        return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:updates,
          expected:Object.fromEntries(Object.keys(updates).map(key=>[key,current[key]])),
          clientId:'codeforces-regression',sequence,baseRevision:current.__fluentConfigRevision});
      }, {updates,sequence:++sequence});
      assert.equal(result.success, true, JSON.stringify(result));
    };
    report.config = {service:'microsoft',to:'zh-Hans',display:1,on:true,translationScope:'content',fullPageTranslationMode:'viewport',useCache:true,
      enableAIContext:false,enableAIMultiSegment:false,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true};
    await patch(report.config);
    const fixtureUrl = 'https://codeforces.com/fluentread-mathjax-fixture';
    const fixture = fs.readFileSync(path.join(root,'tests/fixtures/translation-pages/codeforces-mathjax.html'),'utf8');
    await context.route('**/*', route => {
      if (route.request().url() === fixtureUrl) return route.fulfill({status:200,contentType:'text/html',body:fixture});
      if (!args.live && /^https?:/.test(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });
    const toggle = async (page, mode, selector) => {
      await helper.activateExtensionTabWithoutForeground(context,page);
      if (mode === 'hover') {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const box = await page.locator(selector).boundingBox();
        await page.mouse.click(box.x+4,box.y+9);
        await page.keyboard.down('Control'); await page.keyboard.up('Control');
      } else {await page.keyboard.down('Alt');await page.keyboard.press('t');await page.keyboard.up('Alt');}
    };
    const waitCount = (page,selector,n) => page.waitForFunction(({selector,n})=>document.querySelectorAll(selector).length===n,{selector,n},{timeout:args.timeout});
    for (const live of args.live ? [false,true] : [false]) {
      await patch({selectionTranslatorMode:'disabled',selectionTranslatorTrigger:'icon'});
      console.error(`[codeforces] ${live ? 'live' : 'fixture'} formulas and selection`);
      const result = {scope:live?'live-codeforces':'local-codeforces-dom-fixture',cycles:[],selection:[]};report.cases.push(result);
      const page = await helper.newPageWithoutForeground(context,args.timeout); lastPage=page;
      const url = live ? 'https://codeforces.com/contest/2259/problem/A' : fixtureUrl;
      const selector = live ? '.input-specification p:first-of-type' : '#math-prose';
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForSelector(`${selector} .MathJax`);
      if (live) await page.evaluate(()=>new Promise(resolve=>MathJax.Hub.Queue(resolve)));
      await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.evaluate(selector => {
        const owner = document.querySelector(selector);
        window.originalFormulaNodes = [...owner.querySelectorAll('.MathJax, script')].map(node=>({node,html:node.outerHTML}));
        window.originalSamples = [...document.querySelectorAll('.problem-statement pre')].map(node=>({node,html:node.innerHTML}));
      },selector);
      const n = await page.locator(`${selector} .MathJax`).count();
      const verify = async expected => {
        await waitCount(page,`${selector} ${owned}`,expected);
        const state = await page.evaluate(({selector,owned})=>{
          const owner=document.querySelector(selector), wrapper=owner.querySelector(owned);
          return {count:owner.querySelectorAll(owned).length, formulas:wrapper?.querySelectorAll('.MathJax').length||0,
            nobr:wrapper?.querySelectorAll('.MathJax > nobr').length||0,
            extra:wrapper?.querySelectorAll('.MJX_Assistive_MathML, script').length||0,
            preserved:window.originalFormulaNodes.every(({node,html})=>node.isConnected&&node.outerHTML===html),
            samples:window.originalSamples.every(({node,html})=>node.isConnected&&node.innerHTML===html),
            nested:Boolean(document.querySelector(`${owned} ${owned}`))};
        },{selector,owned});
        assert.equal(state.formulas,expected*n);assert.equal(state.nobr,expected*n);assert.equal(state.extra,0);
        assert.equal(state.preserved,true);assert.equal(state.samples,true);assert.equal(state.nested,false);
        return state;
      };
      for (const mode of ['full','hover']) {
        console.error(`[codeforces] ${result.scope} ${mode}`);
        const cycle={mode,counts:[]};result.cycles.push(cycle);
        for (const expected of [1,0,1,0]) {
          await toggle(page,mode,selector);cycle.counts.push(await verify(expected));
          if(expected===1)await page.screenshot({path:path.join(args.artifactsDir,`${result.scope}-${mode}.png`)});
        }
      }
      // MathJax 重排只改变公式，不应再次翻译整段，也不能让迟到的原文快照覆盖新公式。
      if(!live){
        await toggle(page,'full',selector);await verify(1);
        const before=await worker.evaluate(()=>globalThis.formulaRequests.length);
        await page.evaluate(selector=>{const node=document.querySelector(`${selector} .MathJax nobr .mi`);node.textContent='q';},selector);
        await page.waitForFunction(selector=>document.querySelector(`${selector} .fluent-read-bilingual-content .MathJax nobr .mi`)?.textContent==='q',selector);
        assert.equal(await worker.evaluate(()=>globalThis.formulaRequests.length),before);
        await toggle(page,'full',selector);await waitCount(page,`${selector} ${owned}`,0);
        await page.evaluate(selector=>{document.querySelector(`${selector} .MathJax nobr .mi`).textContent='t';},selector);
        result.dynamicFormulaReplay=true;
      }
      if (!live) {
        console.error('[codeforces] ticking countdown stability');
        const card = '#countdown-card';
        await page.locator(card).scrollIntoViewIfNeeded();
        await toggle(page,'full',card);await waitCount(page,`${card} ${owned}`,3);
        await page.waitForFunction(()=>!document.querySelector('.fluent-read-loading'));
        await page.evaluate(({card,owned})=>{
          const owner=document.querySelector(card);window.clockWrapper=owner.querySelector(owned);window.clockWrappers=[...owner.querySelectorAll(owned)];
          window.clockNode=owner.querySelector('.countdown');window.clockHeight=owner.getBoundingClientRect().height;
        },{card,owned});
        const requestsBefore=await worker.evaluate(()=>globalThis.formulaRequests.length);
        for(let tick=0;tick<12;tick++){
          await page.evaluate(tick=>{const clock=window.clockNode;if(tick%2)clock.firstChild.nodeValue=`24:23:${String(11-tick).padStart(2,'0')}`;else clock.textContent=`24:23:${String(11-tick).padStart(2,'0')}`;},tick);
          await page.waitForTimeout(500);
          const state=await page.evaluate(({card,owned})=>{const owner=document.querySelector(card);return {
            same:window.clockWrappers.every((node,i)=>node.isConnected&&owner.querySelectorAll(owned)[i]===node),
            copies:owner.querySelectorAll('.countdown').length,
            height:owner.getBoundingClientRect().height-window.clockHeight,
            sourceConnected:window.clockNode.isConnected,
          };},{card,owned});
          assert.equal(state.same,true);assert.equal(state.copies,1);assert.equal(state.sourceConnected,true);assert.ok(Math.abs(state.height)<1);
        }
        assert.equal(await worker.evaluate(()=>globalThis.formulaRequests.length),requestsBefore);
        await page.screenshot({path:path.join(args.artifactsDir,'countdown-stable.png')});
        await page.evaluate(()=>{document.querySelector('.contest-state-phase').textContent='Contest has started';});
        await page.waitForFunction(()=>document.querySelector('#countdown-card .fluent-read-bilingual-content')!==window.clockWrapper);
        await waitCount(page,`${card} ${owned}`,3);
        assert.equal(await page.evaluate(()=>window.clockWrappers.slice(1).every(node=>node.isConnected)),true);
        assert.ok(await worker.evaluate(()=>globalThis.formulaRequests.length)>requestsBefore);
        await toggle(page,'full',card);await waitCount(page,`${card} ${owned}`,0);
        assert.equal(await page.locator(`${card} .countdown`).count(),1);
        result.countdown={textTargets:3,ticks:12,wrapperIdentityStable:true,extraRequests:0,heightChange:0,phaseChangeRetranslated:true,otherTextTargetsPreserved:true};
      }
      const cdp=await context.newCDPSession(page);
      cdpSessions.add(cdp);
      await cdp.send('DOM.enable',{includeWhitespace:'all'});
      const ui=async className=>{const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});return find(root,hasClass(className));};
      const waitUi=async className=>{const end=Date.now()+args.timeout;do{const node=await ui(className);if(node)return node;await page.waitForTimeout(80);}while(Date.now()<end);throw new Error(`Missing selection UI: ${className}`);};
      const clickUi=async className=>{const node=await waitUi(className);const {model}=await cdp.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=model.content;await page.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);};
      for(const trigger of ['dot','Control']){
        console.error(`[codeforces] ${result.scope} selection ${trigger}`);
        await patch({selectionTranslatorMode:'bilingual',selectionTranslatorTrigger:trigger,disableSelectionTranslator:false});
        await page.waitForTimeout(400);
        result.selectionConfig=await popup.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return {mode:c.selectionTranslatorMode,trigger:c.selectionTranslatorTrigger,disabled:c.disableSelectionTranslator,delay:c.selectionTranslatorDelay};});
        await helper.activateExtensionTabWithoutForeground(context,page);
        await page.locator(selector).scrollIntoViewIfNeeded();
        const endpoints=await page.locator(selector).evaluate(element=>{
          const range=document.createRange();range.selectNodeContents(element);
          const rects=[...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0);
          const first=rects[0],last=rects[rects.length-1];
          if(!first||!last)throw new Error('Selection paragraph has no visible text');
          return {start:{x:first.left+1,y:first.top+first.height/2},end:{x:last.right-1,y:last.top+last.height/2}};
        });
        // 原生拖选以 pointerup 结算，避免 CDP 延迟使点击后的程序化选区超过可信交互窗口。
        // 先用真实点击清除上一张卡片保留的选区，避免浏览器把再次拖动解释为拖放已选文字。
        await page.mouse.click(endpoints.start.x,endpoints.start.y);
        await page.waitForFunction(()=>!getSelection()?.toString(),null,{timeout:args.timeout});
        await page.mouse.move(endpoints.start.x,endpoints.start.y);
        await page.mouse.down();
        try {await page.mouse.move(endpoints.end.x,endpoints.end.y,{steps:8});}
        finally {await page.mouse.up();}
        if(trigger==='dot')await clickUi('fr-selection-indicator');
        else {await page.keyboard.down('Control');await page.keyboard.up('Control');}
        await waitUi('fr-translation-tooltip');
        const original=await waitUi('fr-original-text');
        const pre=find(original,node=>node.nodeName==='PRE');const source=text(pre);
        assert.match(source,/\$t\$/);assert.match(source,/\$1 \\leq t \\leq 10\^4\$/);
        await waitUi('fr-translation-result');
        result.selection.push({trigger,source});
        await page.screenshot({path:path.join(args.artifactsDir,`${result.scope}-selection-${trigger}.png`)});
        await clickUi('fr-close-btn');
      }
      await cdp.detach();cdpSessions.delete(cdp);await page.close();
    }
    if (args.live) {
      console.error('[codeforces] live homepage countdown');
      const page=await helper.newPageWithoutForeground(context,args.timeout);lastPage=page;
      await page.goto('https://codeforces.com/',{waitUntil:'domcontentloaded'});
      const card='#sidebar div:has(> .contest-state-phase)';
      await page.waitForSelector(`${card} .countdown`);
      await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});
      await page.locator(card).scrollIntoViewIfNeeded();
      await toggle(page,'full',card);await waitCount(page,`${card} ${owned}`,3);
      await page.waitForFunction(()=>!document.querySelector('.fluent-read-loading'));
      await page.evaluate(({card,owned})=>{const e=document.querySelector(card);window.clockWrapper=e.querySelector(owned);window.clockWrappers=[...e.querySelectorAll(owned)];window.clockHeight=e.getBoundingClientRect().height;window.initialClock=e.querySelector('.countdown').textContent;},{card,owned});
      const requestsBefore=await worker.evaluate(()=>globalThis.formulaRequests.length);
      const values=[];
      for(let i=0;i<12;i++){
        await page.waitForTimeout(1000);
        const state=await page.evaluate(({card,owned})=>{const e=document.querySelector(card);return {same:window.clockWrappers.every((node,i)=>node.isConnected&&e.querySelectorAll(owned)[i]===node),copies:e.querySelectorAll('.countdown').length,height:e.getBoundingClientRect().height-window.clockHeight,time:e.querySelector('.countdown').textContent};},{card,owned});
        assert.equal(state.same,true);assert.equal(state.copies,1);assert.ok(Math.abs(state.height)<1);values.push(state.time);
      }
      assert.ok(new Set(values).size>=8,'Live countdown must actually tick');
      assert.equal(await worker.evaluate(()=>globalThis.formulaRequests.length),requestsBefore);
      await page.screenshot({path:path.join(args.artifactsDir,'live-home-countdown.png')});
      await toggle(page,'full',card);await waitCount(page,`${card} ${owned}`,0);
      report.cases.push({scope:'live-codeforces-home',countdown:{textTargets:3,values,wrapperIdentityStable:true,extraRequests:0,heightChange:0}});
      await page.close();
    }
    report.requests=await worker.evaluate(()=>globalThis.formulaRequests);
    assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.passed=true;
  } catch (error) {primaryError = error; throw error;}
  finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {
        cleanupErrors.push(error);
        report.passed = false;
        report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
      }
    };
    let browserClosed = false;
    let diagnosticCdp;
    await cleanup(async () => {
    if(lastPage && !lastPage.isClosed()){
      diagnosticCdp=await lastPage.context().newCDPSession(lastPage);
      const diagnosticTree=await diagnosticCdp.send('DOM.getDocument',{depth:-1,pierce:true});
      const diagnosticHost=find(diagnosticTree.root,n=>attr(n,'id')==='fluent-read-selection-translator-container');
      report.selectionUi=diagnosticHost;
      report.lastPage=await lastPage.evaluate(()=>({url:location.href,visibility:document.visibilityState,scrollY,selection:(()=>{const s=getSelection();if(!s?.rangeCount)return null;const r=s.getRangeAt(0);return {text:s.toString(),anchor:r.commonAncestorContainer.nodeName};})(),paragraphs:[...document.querySelectorAll('.problem-statement p')].map(e=>({html:e.outerHTML,rect:e.getBoundingClientRect().toJSON()})),loading:document.querySelectorAll('.fluent-read-loading').length})).catch(()=>null);
      await lastPage.screenshot({path:path.join(args.artifactsDir,'last-page.png')}).catch(()=>{});
    }
    });
    await cleanup(async () => {if(lastWorker)report.requests=await lastWorker.evaluate(()=>globalThis.formulaRequests).catch(()=>[]);});
    await cleanup(async () => {await diagnosticCdp?.detach();});
    for (const cdp of cdpSessions) await cleanup(async () => {await cdp.detach();});

    await cleanup(async () => {
      if (session) {await session.close(); browserClosed = true;}
    });
    await cleanup(() => {
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        // No browser launch was attempted; only remove an empty initial profile.
        try {fs.rmdirSync(profileDir);} catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup(() => {save();});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
}
main().catch(error=>{
  report.passed = false;
  report.errors.push(error.stack);
  console.error(error);process.exitCode=1;
  try {save();} catch (reportError) {console.error('Report write failed:',reportError);}
});
