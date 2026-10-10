#!/usr/bin/env node
'use strict';
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
// 句子操作生产专项：后台临时 Edge；普通悬停仅高亮，主动选中复用已有划词入口。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {readStoredConfig, patchStoredConfig, getSelectionUiTree, findCdpNode, cdpAttribute, hasCdpClass, cdpText, clickSelectionIndicator} = require('../run-selection-trigger-test.cjs');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = 'Good ideas deserve attention.';
const translated = '好想法值得关注。';
const explanation = '这句话强调好想法值得关注。deserve attention 表示“值得关注”。';
async function fixture(own = () => {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    if (request.method === 'POST') {
      const chunks = []; for await (const part of request) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = JSON.stringify(body.messages); const teaching = prompt.includes('最多三句');
      const selectedSentence = prompt.includes(`SOURCE_BEGIN${source}SOURCE_END`);
      const content = teaching ? explanation : selectedSentence ? translated : translated + '练习带来进步。';
      requests.push({kind:teaching ? 'explanation' : 'translation'});
      if (body.stream) {
        response.setHeader('Content-Type', 'text/event-stream');
        for (const text of [content.slice(0, 15), content.slice(15)]) response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`);
        response.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
      } else {response.setHeader('Content-Type','application/json'); response.end(JSON.stringify({id:'fixture',object:'chat.completion',model:'fixture',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}));}
      return;
    }
    response.setHeader('Content-Type','text/html');
    response.end(`<html lang="en"><head><title>Sentence listening fixture</title><style>body{margin:40px;font:21px/1.8 system-ui}p{max-width:720px}button{letter-spacing:7px!important}aside{height:1200px}</style></head><body><h1>Read and listen</h1><p id="primary">${source} Practice makes progress.</p><aside></aside></body></html>`);
  });
  const local = {requests, close: () => new Promise((resolve, reject) => server.close(error => {
    if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve();
  }))};
  own(local);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {...local, url: `http://127.0.0.1:${server.address().port}`};
}
async function main() {
  const extensionDir = path.resolve(arg('extension-dir','.output/chrome-mv3'));
  const artifactsDir = path.resolve(arg('artifacts-dir','/private/tmp/fluentread-sentence-listening'));
  const packages = arg('playwright-root'); const helper = arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'));
  assert(packages && helper); assert(fs.existsSync(path.join(extensionDir,'manifest.json')));
  const {chromium} = require(path.join(packages,'playwright'));
  const {launchFocusSafePersistentContext,newPageWithoutForeground,activateExtensionTabWithoutForeground} = require(helper);
  fs.mkdirSync(artifactsDir,{recursive:true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-sentence-listening-edge-'));
  const report = {ok:false,extensionDir,artifactsDir,checks:[],consoleErrors:[],screenshots:[],evidenceBoundary:'Real production extension and storage; local deterministic translation/explanation; collection voice mock validates text and stop lifecycle when the full suite is used; this does not establish audible voice quality or Firefox runtime.'};
  let launched, local, primaryError; let page; let options;
  let launchAttempted = false;
  try {
    local = await fixture(owned => { local = owned; });
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium,profileDir,background:true,headless:false,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',viewport:{width:1440,height:960},timeout:30000,
      browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost,false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async url => {const p = await newPageWithoutForeground(context,30000);p.on('pageerror',e=>report.consoleErrors.push(e.message));await p.goto(url,{waitUntil:'domcontentloaded'});return p;};
    options = await createPage(`${origin}/options.html#settings-vocabulary`);
    const readConfig = () => readStoredConfig(options);
    let config; for(let i=0;i<150;i++){config=await readConfig();if(config?.to)break;await wait(100);} assert(config?.to);
    const service = 'custom:sentence-listening-fixture';
    const selectionPatch = {selectionTranslatorMode:'bilingual',disableSelectionTranslator:false,selectionTranslatorTrigger:'icon',selectionTranslatorDelay:0,selectionTranslatorAutoDismiss:true};
    const patch = {on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,from:'en',to:'zh-Hans',service,display:1,style:1,autoTranslate:false,
      bilingualSentenceHighlightEnabled:true,vocabularyBookEnabled:true,...selectionPatch,animations:false,
      customOpenAIProviders:[{id:service,name:'句子听读夹具',endpoint:`${local.url}/v1/chat/completions`,models:['fixture']}],
      token:{[service]:'synthetic-fixture'},model:{[service]:'fixture'},user_role:{[service]:'SOURCE_BEGIN{{origin}}SOURCE_END'},glossaryEnabled:false,enableAIContext:false,enableAIMultiSegment:false,
      hotkey:'Control',mouseHoverTranslationDelay:0,selectionTtsMode:'local-only',harness:{...config.harness,enabled:true,service,model:'fixture'}};
    const saved = await options.evaluate(({config,patch})=>chrome.runtime.sendMessage({type:'persistConfig',mode:'replace',config:{...config,...patch},baseRevision:config.__fluentConfigRevision,clientId:`sentence-${crypto.randomUUID()}`,sequence:1}),{config,patch});
    assert.equal(saved.success,true,saved.error);
    await wait(350);
    const persisted=await readConfig();assert.equal(persisted.service,service);assert.equal(persisted.selectionTranslatorMode,'bilingual');assert.equal(persisted.vocabularyBookEnabled,true);
    page = await createPage(local.url);
    await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});
    await activateExtensionTabWithoutForeground(context,page,30000);
    await page.locator('#primary').hover(); await page.keyboard.press('Control');
    await page.locator('#primary > .fluent-read-bilingual-content').waitFor();
    const before = await page.locator('#primary').evaluate(el=>({html:el.innerHTML,rect:JSON.stringify(el.getBoundingClientRect())}));
    const hover = async (translatedSide, offset=0) => {
      const point = await page.evaluate(({source,translated,translatedSide})=>{
        const root=document.querySelector(translatedSide?'#primary .fluent-read-bilingual-content':'#primary');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const node=walker.currentNode;const index=node.textContent.indexOf(translatedSide?translated:source);if(index<0)continue;const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+2);const rect=range.getClientRects()[0];return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};}throw new Error('sentence missing');
      },{source,translated,translatedSide});await page.mouse.move(point.x+offset,point.y);await wait(100);
    };
    const shot = async (p,name,options={})=>{const file=path.join(artifactsDir,`${name}.png`);await p.screenshot({path:file,...options});report.screenshots.push(file);};
    const byClass = name => node => hasCdpClass(node,name);
    const uiNode = async predicate => findCdpNode((await getSelectionUiTree(page)).root,predicate);
    const waitNode = async predicate => {
      for(let i=0;i<200;i++){const node=await uiNode(predicate);if(node)return node;await wait(50);}
      throw new Error('Selection UI did not appear');
    };
    const clickNode = async predicate => {
      const {session,root}=await getSelectionUiTree(page);const node=findCdpNode(root,predicate);assert(node,'selection control exists');
      const {model}=await session.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=model.border;
      const x=(q[0]+q[4])/2,y=(q[1]+q[5])/2;
      await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      await session.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    };
    const box = async predicate => {
      const {session,root}=await getSelectionUiTree(page);const node=findCdpNode(root,predicate);assert(node);
      const {model}=await session.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=model.border;
      return {x:Math.min(q[0],q[2],q[4],q[6]),y:Math.min(q[1],q[3],q[5],q[7]),width:model.width,height:model.height};
    };
    const noControls = async () => {
      assert.equal(await page.locator('#fluent-read-sentence-actions').count(),0);
      assert.equal(await uiNode(byClass('fr-selection-indicator')),null);
      assert.equal(await uiNode(byClass('fr-translation-tooltip')),null);
    };
    const dismiss = async () => {await page.keyboard.press('Escape');await page.mouse.click(1250,500);await wait(180);await noControls();};
    const selectSource = async () => {
      await page.keyboard.press('Escape');
      const points=await page.evaluate(source=>{
        const walker=document.createTreeWalker(document.querySelector('#primary'),NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
          const node=walker.currentNode;const start=node.textContent.indexOf(source);if(start<0)continue;
          const first=document.createRange();first.setStart(node,start);first.setEnd(node,start+1);
          const last=document.createRange();last.setStart(node,start+source.length-1);last.setEnd(node,start+source.length);
          const a=first.getClientRects()[0],b=last.getClientRects()[0];return {start:{x:a.left+.1,y:a.top+a.height/2},end:{x:b.right-.1,y:b.top+b.height/2}};
        }throw new Error('source sentence missing');
      },source);
      await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();await page.mouse.move(points.end.x,points.end.y,{steps:20});await page.mouse.up();
      assert.equal(await page.evaluate(()=>window.getSelection().toString().trim()),source);
    };
    const requestsBeforeHover=local.requests.length;
    for(const side of [false,true]) {
      await hover(side);await wait(1200);await noControls();
      assert(await page.evaluate(()=>[...CSS.highlights.values()].some(highlight=>highlight.size>0)),'paired sentence highlights still paint');
    }
    assert.equal(local.requests.length,requestsBeforeHover);
    assert.deepEqual(await page.locator('#primary').evaluate(el=>({html:el.innerHTML,rect:JSON.stringify(el.getBoundingClientRect())})),before);
    await shot(page,'reading-without-controls');
    report.checks.push('source and translation hover paint highlights only; no sentence host, button, dialog, extra model request or host layout change');
    await selectSource();await waitNode(byClass('fr-selection-indicator'));
    assert.equal(await uiNode(byClass('fr-translation-tooltip')),null);assert.equal(local.requests.length,requestsBeforeHover);
    const indicator=await box(byClass('fr-selection-indicator'));assert(indicator.width<=28 && indicator.height<=28);
    const selectionRects=await page.evaluate(()=>Array.from(window.getSelection().getRangeAt(0).getClientRects()).map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom})));
    assert(!selectionRects.some(rect=>indicator.x<rect.right && indicator.x+indicator.width>rect.left && indicator.y<rect.bottom && indicator.y+indicator.height>rect.top),'entry does not overlap selected text');
    await shot(page,'selected-text-entry');
    const prose=await page.locator('#primary').boundingBox();await shot(page,'selected-text-entry-detail',{clip:{x:prose.x-8,y:prose.y-8,width:prose.width+16,height:prose.height+16}});
    await clickSelectionIndicator(page);await waitNode(byClass('fr-translation-tooltip'));
    for(let i=0;i<200;i++){const n=await uiNode(byClass('fr-translation-result'));if(cdpText(findCdpNode(n,node=>node.nodeName==='PRE'))===translated)break;await wait(50);}
    assert.equal(cdpText(findCdpNode(await uiNode(byClass('fr-translation-result')),node=>node.nodeName==='PRE')),translated);
    await clickNode(byClass('fr-vocabulary-btn'));
    for(let i=0;i<100;i++){if(cdpAttribute(await uiNode(byClass('fr-vocabulary-btn')),'aria-pressed')==='true')break;await wait(50);}
    assert.equal(cdpAttribute(await uiNode(byClass('fr-vocabulary-btn')),'aria-pressed'),'true');
    const request = async message => options.evaluate(message=>chrome.runtime.sendMessage(message),message);
    const list = async()=>{const result=await request({type:'fluentReadVocabularyBook',action:'list'});assert(result.success);return result.data;};
    let entries=await list();assert.equal(entries.length,1);assert.equal(entries[0].term,source);assert.equal(entries[0].translations['zh-hans'].text,translated);assert(entries[0].kind===undefined || entries[0].kind==='sentence');
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    for(const [kind,text] of [['source',source],['translation',translated]]) {
      await clickNode(node=>cdpAttribute(node,'data-copy-kind')===kind);assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),text);
    }
    await shot(page,'selection-card');
    report.checks.push('one existing small icon appears only after a trusted drag selection; click opens the card, copy preserves source/translation and explicit star saves the selected sentence');
    await dismiss();await hover(true);await wait(1200);await noControls();
    await page.setViewportSize({width:390,height:844});await wait(100);await selectSource();await waitNode(byClass('fr-selection-indicator'));
    const mobile=await box(byClass('fr-selection-indicator'));assert(mobile.width<=28 && mobile.x>=0 && mobile.x+mobile.width<=390);
    await shot(page,'selected-text-entry-mobile');await clickSelectionIndicator(page);await waitNode(byClass('fr-translation-tooltip'));
    const mobileCard=await box(byClass('fr-translation-tooltip'));assert(mobileCard.x>=0 && mobileCard.x+mobileCard.width<=390);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await shot(page,'selection-card-mobile');
    await page.setViewportSize({width:1440,height:960});await dismiss();
    const toggles=[1];
    for(const target of [0,1]) {
      await page.locator('#primary').hover();await page.keyboard.press('Control');
      await page.locator('#primary > .fluent-read-bilingual-content').waitFor({state:target?'attached':'detached'});
      toggles.push(await page.locator('#primary > .fluent-read-bilingual-content').count());
    }
    assert.deepEqual(toggles,[1,0,1]);await hover(true);await wait(1200);await noControls();
    report.checks.push('Escape/continued reading remove controls; 390px selection icon and card fit viewport; translate/restore/translate remains 1/0/1 without hover UI');
    await patchStoredConfig(options,{selectionTranslatorMode:'disabled',disableSelectionTranslator:true});
    await page.reload();await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page,30000);
    const disabledRequests=local.requests.length;await selectSource();await wait(1200);await noControls();assert.equal(local.requests.length,disabledRequests);
    report.checks.push('disabled selection preference is respected; selecting and hovering never resurrect sentence actions or request translation');
    await options.reload();await options.locator('.word-row').waitFor();await options.locator('.collection-type .el-select__wrapper').click();await options.getByRole('option',{name:'句子',exact:true}).click();assert.equal(await options.locator('.word-row').count(),1);
    report.checks.push('saved selection is classified and displayed by the existing sentence collection filter');
    if(process.argv.includes('--selection-entry-only') || process.argv.includes('--toolbar-only')) {
      assert.equal(report.consoleErrors.length,0);report.requests=local.requests;report.ok=true;
      return;
    }
    await options.reload();await options.locator('.word-row').waitFor();
    await options.locator('.collection-type .el-select__wrapper').click();await options.getByRole('option',{name:'句子',exact:true}).click();assert.equal(await options.locator('.word-row').count(),1);
    await options.getByLabel('更多收藏操作',{exact:true}).click();
    await options.getByRole('button',{name:'添加简短解释',exact:true}).click();
    await options.getByRole('textbox',{name:'收藏的简短解释',exact:true}).fill('deserve attention：值得关注。');
    await options.getByRole('button',{name:'保存解释',exact:true}).click();
    await options.locator('.entry-note').waitFor();
    await options.reload();await options.locator('.entry-note').waitFor();assert.equal(await options.locator('.entry-note').innerText(),'deserve attention：值得关注。');
    report.checks.push('sentence list, manual explanation and reopening persistence');
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await options.getByLabel('更多收藏操作',{exact:true}).click();
    await options.getByRole('button',{name:'复制原文',exact:true}).click();assert.equal(await options.evaluate(()=>navigator.clipboard.readText()),source);
    await options.getByRole('button',{name:'复制双语',exact:true}).click();assert.equal(await options.evaluate(()=>navigator.clipboard.readText()),`${source}\n${translated}`);
    report.checks.push('quick copy original and bilingual');
    await options.evaluate(()=>{
      window.__sentenceSpeech=[];
      class Utterance{constructor(text){this.text=text;}}
      window.SpeechSynthesisUtterance=Utterance;
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:u=>window.__sentenceSpeech.push({text:u.text,language:u.lang}),cancel:()=>window.__sentenceSpeech.push({stopped:true})}});
    });
    await options.getByRole('button',{name:'朗读原文',exact:true}).click();
    await options.waitForFunction(()=>window.__sentenceSpeech.some(item=>item.text));
    assert.equal((await options.evaluate(()=>window.__sentenceSpeech.find(item=>item.text))).text,source);
    await options.getByRole('button',{name:'停止朗读',exact:true}).click();
    assert((await options.evaluate(()=>window.__sentenceSpeech)).some(item=>item.stopped));
    report.checks.push('existing TTS backend failure routes to browser speech with exact original; stop releases ownership');
    await options.locator('.entry-open').click();
    await options.getByRole('button',{name:'生成简短解释',exact:true}).click();
    await options.getByRole('button',{name:'保存这段解释',exact:true}).waitFor();
    await options.getByRole('button',{name:'保存这段解释',exact:true}).click();
    await options.waitForFunction(text=>document.querySelector('.saved-note')?.textContent===text,explanation);
    assert((await options.locator('.study-workspace').innerText()).includes(explanation),'saving a note preserves the current explanation');
    await shot(options,'sentence-listening-study');
    await options.getByRole('button',{name:'‹ 返回收藏',exact:true}).click();
    report.checks.push('on-demand short explanation uses grounded sentence prompt and saves separately from translation');
    const downloadPromise=options.waitForEvent('download');await options.getByLabel('更多收藏管理',{exact:true}).click();await options.getByRole('button',{name:'导出当前列表',exact:true}).click();const download=await downloadPromise;
    const file=path.join(artifactsDir,'exported-collection.json');await download.saveAs(file);const data=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(data.entries[0].note,explanation);assert.equal(data.entries[0].translations['zh-hans'].text,translated);assert.equal(data.includesPrivateContext,false);assert(!data.entries[0].contexts.some(item=>item.sourceUrl));
    await request({type:'fluentReadVocabularyBook',action:'clear'});await options.reload();await options.getByRole('heading',{name:'还没有学习收藏',exact:true}).waitFor();
    await options.locator('input[type=file][aria-label="导入收藏文件"]').setInputFiles(file);await options.locator('.word-row').waitFor();
    entries=await list();assert.equal(entries.length,1);assert.equal(entries[0].note,explanation);assert(entries[0].kind===undefined || entries[0].kind==='sentence');
    report.checks.push('actual downloaded JSON round trips original, translation, explanation, sentence identity and review records');
    await options.locator('input[type=file][aria-label="导入收藏文件"]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{oops')});
    await options.getByRole('status').filter({hasText:'无法读取文件'}).waitFor();assert.equal((await list()).length,1);
    report.checks.push('malformed import preserves existing collection and gives retryable feedback');
    await options.locator('.book-toast').waitFor({state:'hidden'});
    await options.locator('.collection-type .el-select__wrapper').click();await options.getByRole('option',{name:'句子',exact:true}).click();
    await shot(options,'saved-sentences');
    await options.setViewportSize({width:390,height:844});await options.locator('.word-row').scrollIntoViewIfNeeded();await wait(120);assert(await options.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await shot(options,'saved-sentences-mobile');
    await options.setViewportSize({width:1440,height:960});
    report.checks.push('narrow collection layout stays within viewport');
    if (process.argv.includes('--collection-layout')) {
      for (const input of [
        {term:'Instead of trying to remember every word you encounter, make room for the ideas that stay with you after reading, listen to the original sentence, connect its meaning with your own experience, notice how one expression works in context, and return another day to explain the whole idea in your own words without relying on a word-for-word translation.',translation:'与其试图记住阅读时遇到的每一个单词，不如把空间留给那些在读完之后依然留在心中的想法：听一遍原句，把句意与你自己的经历联系起来，留意一个有用表达在上下文中的实际用法，然后隔一天再回来，试试看能否用自己的话讲清这个想法，同时把重点放在整个句子真正表达的意思上，而不是机械地逐词对应。',kind:'sentence',note:'make room for：为……留出空间。这里强调把注意力留给值得记住的内容。'},
        {term:'make room for',translation:'为……留出空间；给……腾出位置。',kind:'expression',note:'We should make room for new ideas. 我们应该为新想法留出空间。'},
      ]) {const result=await request({type:'fluentReadVocabularyBook',action:'upsert',input:{sourceLanguage:'en',targetLanguage:'zh-hans',...input,context:{text:'Make room for useful ideas and keep the original context.',sourceUrl:local.url,pageTitle:'Reading notes'}}});assert(result.success);}
      await options.reload();await options.locator('.word-row').nth(2).waitFor();
      const rows=options.locator('.word-row');const first=rows.first();
      assert.equal(await first.locator('.entry-actions > button').count(),2);
      assert.equal(await first.getByRole('button',{name:'删除收藏',exact:true}).isVisible(),false);
      assert.equal(await first.getByRole('button',{name:'编辑解释',exact:true}).isVisible(),false);
      const more=first.getByLabel('更多收藏操作',{exact:true});await more.focus();await more.press('Enter');
      assert.equal(await first.getByRole('button',{name:'编辑解释',exact:true}).isVisible(),true);
      await more.press('Escape');assert.equal(await first.locator('.entry-more').evaluate(el=>el.open),false);
      await more.click();await first.getByRole('button',{name:'编辑解释',exact:true}).click();
      await first.getByRole('textbox',{name:'收藏的简短解释',exact:true}).waitFor();
      assert(await first.getByRole('textbox',{name:'收藏的简短解释',exact:true}).evaluate(el=>el===document.activeElement));
      await first.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await first.locator('textarea').count(),0);
      report.checks.push('rows show only content, play, copy and more; keyboard Escape closes menu and note editor mounts only on demand');
      await more.click();await first.getByRole('button',{name:'标记掌握',exact:true}).click();await first.getByText('已掌握',{exact:true}).waitFor();
      await more.click();await first.getByRole('button',{name:'重新学习',exact:true}).click();await first.getByText('学习中',{exact:true}).waitFor();
      await options.locator('.book-filter > summary').click();await options.locator('.filter-panel .el-select__wrapper').first().click();
      await options.getByRole('option',{name:'已掌握',exact:true}).click();assert.equal(await rows.count(),0);
      await options.locator('.filter-panel .el-select__wrapper').first().click();await options.getByRole('option',{name:'全部状态',exact:true}).click();await rows.nth(2).waitFor();
      await options.locator('.book-filter > summary').press('Escape');
      report.checks.push('mastery and relearn remain available in row menu; status filter changes actual list and resets');
      await more.click();await first.getByRole('button',{name:'删除收藏',exact:true}).click();await options.locator('.el-message-box').getByRole('button',{name:'删除',exact:true}).click();await options.waitForFunction(()=>document.querySelectorAll('.word-row').length===2);
      await options.getByRole('button',{name:'撤销',exact:true}).click();await rows.nth(2).waitFor();
      report.checks.push('delete from compact row menu and toast undo preserve the saved content');
      await options.getByRole('switch',{name:'学习收藏',exact:true}).click();
      await waitForAsyncCondition(() => options.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.vocabularyBookEnabled===false;}), {timeoutMs: 30000, message: "收藏词书开关未持久化为关闭"});
      await options.reload();await rows.nth(2).waitFor();assert.equal(await options.getByRole('switch',{name:'学习收藏',exact:true}).getAttribute('aria-checked'),'false');
      await options.getByRole('switch',{name:'学习收藏',exact:true}).click();
      await waitForAsyncCondition(() => options.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.vocabularyBookEnabled===true;}), {timeoutMs: 30000, message: "收藏词书开关未持久化为开启"});
      await options.locator('.book-toast').waitFor({state:'hidden'});
      report.checks.push('compact saving switch persists on reload and disabling preserves existing collection');
      report.layout=[];
      for (const width of [1440,820,390]) {
        await options.setViewportSize({width,height:960});await options.evaluate(()=>window.scrollTo(0,0));await wait(150);
        assert(await options.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
        const geometry=await options.evaluate(()=>{const row=document.querySelector('.word-row');const translation=row.querySelector('.entry-translation');const book=document.querySelector('.vocabulary-book');const sentence=[...document.querySelectorAll('.word-row')].find(el=>el.querySelector('.entry-open').textContent.startsWith('Instead'));return{rowWidth:row.getBoundingClientRect().width,sourceWidth:row.querySelector('.entry-open').getBoundingClientRect().width,translationWidth:translation.getBoundingClientRect().width,firstContentOffset:row.getBoundingClientRect().top-book.getBoundingClientRect().top,longTranslationCharacters:sentence.querySelector('.entry-translation').textContent.length};});
        assert(geometry.translationWidth/geometry.rowWidth>.88);assert(geometry.firstContentOffset<250);assert(geometry.longTranslationCharacters>120);
        if(width===390)assert(geometry.sourceWidth/geometry.rowWidth>.88);
        report.layout.push({width,...geometry});await shot(options,`collection-layout-${width}`);
      }
      const live=await readConfig();await options.evaluate(config=>chrome.runtime.sendMessage({type:'persistConfig',mode:'replace',config:{...config,theme:'dark'},baseRevision:config.__fluentConfigRevision,clientId:`layout-${crypto.randomUUID()}`,sequence:1}),live);
      await wait(180);await shot(options,'collection-layout-dark');
      report.checks.push('1440, 820 and 390px layouts retain full sentence translation, allocate full width to content and avoid overflow; dark layout captured');
    }
    assert.equal(report.consoleErrors.length,0);report.requests=local.requests;report.ok=true;
  } catch(error){primaryError=error;report.error=error.stack||String(error);if(options||page)try{await (options||page).screenshot({path:path.join(artifactsDir,'failure.png')});}catch{}throw error;}
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
    await cleanup('HTTP fixture', async () => { if (local) await local.close(); });
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
    report.profileRemoved = !fs.existsSync(profileDir);
    await cleanup('report', () => { fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
    if(report.ok)process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }
}

main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
