#!/usr/bin/env node
// 统一划词专项：使用生产扩展、独立 profile 与焦点安全 helper。AI/译文由本地确定性夹具返回。
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const support = require('./run-selection-trigger-test.cjs');
const arg = (key) => process.argv[process.argv.indexOf(`--${key}`) + 1];
const output = path.resolve(arg('artifacts-dir'));
const extensionDir = path.resolve(arg('extension-dir'));
const {chromium} = createRequire(path.join(arg('playwright-root'), 'package.json'))('playwright');
const helper = require(path.resolve((process.argv.includes('--focus-safe-helper') ? arg('focus-safe-helper') : path.join(__dirname, 'testing/focus-safe-browser.cjs'))));
const sentence = 'The curious reader explores new ideas.';
const grammar = '### 主干\nThe reader explores ideas. 读者探索想法。\n\n### 词性与句法\n| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| The | article | 限定 reader | 这位 |\n| curious | adjective | 修饰 reader | 好奇的 |\n| reader | noun | 主语 | 读者 |\n| explores | verb | 谓语 | 探索 |\n| new | adjective | 修饰 ideas | 新的 |\n| ideas | noun | 宾语 | 想法 |\n\n### 关键点\n形容词描述名词，词性和句中作用分开理解。';
const report = {providerEvidence:'Production extension in isolated Edge; translation and AI responses use deterministic local fixtures. Dictionary uses the real dictionary pipeline. No authenticated AI quality claim.',ok:false,cases:[],screenshots:[],consoleErrors:[],translationRequests:0,aiRequests:0,persistenceCases:[],quickClose:{},crossPageSync:{},latestWriteWins:{}};
const record = name => {report.cases.push(name); console.log('PASS',name);};
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
let session, context, worker, server, optionsPage, popup, page;
async function screenshot(target,name) {const file=path.join(output,name+'.png'); await target.screenshot({path:file,fullPage:false}); report.screenshots.push(file);}
async function node(predicate) {const {root}=await support.getSelectionUiTree(page); return support.findCdpNode(root,predicate);}
const cls = name => n => support.hasCdpClass(n,name);
async function until(predicate,message) {for(let i=0;i<80;i++){if(await predicate()) return; await wait(100);} throw new Error(message);}
async function clickNode(predicate) {const {session:cdp,root}=await support.getSelectionUiTree(page); const n=support.findCdpNode(root,predicate); assert(n,'Missing UI node'); const {model}=await cdp.send('DOM.getBoxModel',{nodeId:n.nodeId}); const q=model.content; await page.mouse.click((q[0]+q[2]+q[4]+q[6])/4,(q[1]+q[3]+q[5]+q[7])/4);}
async function assertCompactLayout() {
 const state=await support.getSelectionUiTree(page);const popup=support.findCdpNode(state.root,cls('fr-translation-tooltip'));assert(popup,'compact popup missing');
 const resolved=await state.session.send('DOM.resolveNode',{nodeId:popup.nodeId});
 const measured=await state.session.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,returnByValue:true,functionDeclaration:`function(){
  const card=this.getBoundingClientRect();const overlaps=[];
  for(const block of this.querySelectorAll('.fr-text-block')){
   const range=document.createRange();range.selectNodeContents(block.querySelector('pre'));
   for(const rect of range.getClientRects())for(const button of block.querySelectorAll('button')){const b=button.getBoundingClientRect();if(rect.left<b.right&&rect.right>b.left&&rect.top<b.bottom&&rect.bottom>b.top)overlaps.push(button.getAttribute('aria-label'));}
  }
  const title=this.querySelector('.fr-tooltip-title').getBoundingClientRect(),actions=this.querySelector('.fr-tooltip-actions').getBoundingClientRect();if(title.right>actions.left)overlaps.push('header controls');
  return {left:card.left,right:card.right,viewport:innerWidth,height:card.height,overlaps,headerHeight:this.querySelector('header').getBoundingClientRect().height};
 }`});
 const data=measured.result.value;assert.deepEqual(data.overlaps,[],'text overlaps compact controls');assert(data.left>=0&&data.right<=data.viewport+1,'card outside viewport');assert(data.headerHeight<=45,'header occupies too much space');return data;
}
const button = text => n=> n.nodeName==='BUTTON' && support.cdpText(n).trim()===text;
async function choose(selector) {
 await helper.activateExtensionTabWithoutForeground(context,page);
 const points=await page.evaluate(selector=>{
  const target=document.querySelector(selector),text=target.firstChild,range=document.createRange();
  range.setStart(text,0);range.setEnd(text,1);const first=range.getBoundingClientRect();
  range.setStart(text,text.length-1);range.setEnd(text,text.length);const last=range.getBoundingClientRect();
  return {start:{x:first.left,y:first.top+first.height/2},end:{x:last.right+2,y:last.top+last.height/2}};
 },selector);
 await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();await page.mouse.move(points.end.x,points.end.y,{steps:12});await page.mouse.up();
}
async function select(selector) {await helper.activateExtensionTabWithoutForeground(context,page); await page.mouse.click(20,20); await choose(selector); await until(()=>node(cls('fr-selection-indicator')),'selection indicator missing');
 const state=await support.getSelectionUiTree(page);const indicator=support.findCdpNode(state.root,cls('fr-selection-indicator'));const {model}=await state.session.send('DOM.getBoxModel',{nodeId:indicator.nodeId});
 const anchor=await page.evaluate(()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();return {right:r.right,bottom:r.bottom};});
 assert(Math.abs(model.border[0]+model.width/2-anchor.right)<24 && Math.abs(model.border[1]+model.height/2-anchor.bottom)<24,'selection icon is not anchored beside the selected text');
 await clickNode(cls('fr-selection-indicator')); await until(()=>node(cls('fr-translation-tooltip')),'selection popup missing');}
async function patch(value) {await support.patchStoredConfig(popup,value); await wait(350);}
async function main(){
 fs.mkdirSync(output,{recursive:true});
 const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-selection-unified-'));
 let primaryError;
 let launchAttempted = false;
 try {
 server=http.createServer(async(req,res)=>{
   if(req.url==='/translate') {report.translationRequests++; let data='';for await(const chunk of req)data+=chunk; let texts;try{texts=JSON.parse(data);}catch{texts=[sentence];} res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(texts.map(text=>({translations:[{text:text===sentence?'这位好奇的读者探索新的想法。':text==='curious'?'好奇的；求知欲强的':/beyond|unusual/i.test(text)?'异乎寻常的；古怪的':'渴望了解或学习的；好奇的',to:'zh-Hans'}]}))));return;}
   report.aiRequests++;let body='';for await(const c of req)body+=c;assert(body.includes('Text | POS | Role | Meaning'),'grammar contract not sent');
   res.writeHead(200,{'content-type':'text/event-stream','access-control-allow-origin':'*'});
   for(const part of grammar.match(/[\s\S]{1,40}/g)){res.write('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{content:part},finish_reason:null}]})+'\n\n');await wait(20);}
   res.write('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');res.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;
   launchAttempted = true;
   session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1440,height:960}});
   guardBrowserClose(session, profileDir);
   context=session.context;Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement,extensionDir});
   const ready=await support.waitForWorker(context);worker=ready.worker;const id=ready.extensionId;
   const newPage=async()=>{const p=await helper.newPageWithoutForeground(context);p.on('pageerror',error=>report.consoleErrors.push(error.message));return p;};
   popup=await newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
   const saved=await support.readStoredConfig(popup);
   await patch({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,service:'microsoft',from:'auto',to:'zh-Hans',selectionTranslatorMode:'bilingual',selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon',selectionTranslatorDelay:0,hotkey:'none',floatingBallHotkey:'none',useCache:false,harness:{...saved.harness,enabled:true,service:'custom:fixture',model:'learning-fixture',trigger:'click'},customOpenAIProviders:[{id:'custom:fixture',name:'Local fixture',endpoint:`http://127.0.0.1:${port}/v1/chat/completions`,models:['learning-fixture']}],token:{'custom:fixture':'fixture-token'},model:{...saved.model,'custom:fixture':'learning-fixture'}});
   await worker.evaluate(url=>{const native=fetch.bind(globalThis);globalThis.__selectionTestNativeFetch=native;globalThis.fetch=(input,init)=>String(input).startsWith('https://edge.microsoft.com/translate/translatetext')?native(url,init):native(input,init);},`http://127.0.0.1:${port}/translate`);
   optionsPage=await newPage();await optionsPage.goto(`chrome-extension://${id}/options.html#settings-harness`);await optionsPage.locator('#settings-selection').waitFor({state:'visible'});
   assert.equal(await optionsPage.locator('#settings-harness').count(),0);record('legacy route resolves to unified selection settings');
   assert.equal(await optionsPage.getByRole('group',{name:'划词默认呈现'}).count(),0);
   await optionsPage.getByRole('button',{name:'句子',exact:true}).click();await optionsPage.locator('.fr-sentence-tokens button').first().waitFor();
   await optionsPage.locator('.fr-sentence-tokens button').nth(2).click();assert((await optionsPage.locator('.fr-sentence-detail').innerText()).includes('主语'));record('interactive preview distinguishes articles nouns and sentence roles');
   await screenshot(optionsPage,'settings-card-desktop');
   await optionsPage.close();optionsPage=await newPage();await optionsPage.goto(`chrome-extension://${id}/options.html#settings-selection`);await optionsPage.locator('#settings-selection').waitFor();
   assert.equal((await support.readStoredConfig(popup)).selectionTranslatorPresentation,'card');report.quickClose={passed:true};report.persistenceCases.push('unified card survives closing settings');
   await popup.reload();await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
   await popup.locator('[data-popup-quick-feature="selection"]').click();
   assert.equal(await popup.getByRole('group',{name:'划词默认呈现'}).count(),0);await screenshot(popup,'popup-selection');record('settings and popup use one card presentation');
   for(const width of [820,390]){await optionsPage.setViewportSize({width,height:900});await wait(300);assert(await optionsPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await screenshot(optionsPage,`settings-${width}`);}record('settings persistent across pages and fit 1440 820 390 viewports');
   await optionsPage.setViewportSize({width:1440,height:960});await patch({theme:'dark'});await screenshot(optionsPage,'settings-dark');await patch({theme:'light',selectionTranslatorPresentation:'card'});
   await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><title>Selection learning</title><style>body{margin:80px;color:#253248;font:20px/1.8 system-ui}p{max-width:750px}button{font-size:18px!important}h1{font-size:28px}</style></head><body><h1>Read, understand, keep going</h1><p id="sentence">${sentence}</p><p id="word">curious</p><p id="neighbor">Learning grows with every question.</p><button id="host-action">Continue reading</button><div style="height:2400px" aria-hidden="true"></div></body></html>`}));
   page=await newPage();await page.goto('https://example.com/');await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});
   await select('#sentence');await until(async()=>support.cdpText(await node(cls('fr-translation-tooltip'))).includes('这位好奇'),'translation missing');assert.equal(report.aiRequests,0);assert(await node(cls('fr-study-toolbar')));await screenshot(page,'plain-translation');
   const plainTree=await support.getSelectionUiTree(page);const plainNode=support.findCdpNode(plainTree.root,cls('fr-translation-tooltip'));const {model:plainBox}=await plainTree.session.send('DOM.getBoxModel',{nodeId:plainNode.nodeId});
   report.plainCardBounds={width:plainBox.width,height:plainBox.height};assert(plainBox.height<280,'translation card wastes vertical space');
   await page.screenshot({path:path.join(output,'plain-translation-card.png'),clip:{x:plainBox.border[0],y:plainBox.border[1],width:plainBox.width,height:plainBox.height}});report.screenshots.push(path.join(output,'plain-translation-card.png'));
   report.compactLayouts=[await assertCompactLayout()];
   await page.setViewportSize({width:390,height:800});await wait(200);report.compactLayouts.push(await assertCompactLayout());await screenshot(page,'plain-translation-390');
   await page.setViewportSize({width:1440,height:960});await patch({theme:'dark'});report.compactLayouts.push(await assertCompactLayout());await screenshot(page,'plain-translation-dark');await patch({theme:'light'});
   const translationCountBeforeModeSwitch=report.translationRequests;
   record('translation tab shows the translation without study request');
   await clickNode(cls('fr-share-card-entry'));await until(()=>node(cls('fr-card-primary')),'share studio did not open');await screenshot(page,'selection-share-studio');await clickNode(cls('fr-card-close'));await until(async()=>!(await node(cls('fr-card-primary'))),'share studio did not close');assert(await node(cls('fr-translation-tooltip')),'share studio close lost the translation');assert.equal(report.translationRequests,translationCountBeforeModeSwitch);record('compact share action opens studio and preserves the selection result on close');
   assert.equal(report.aiRequests,0);record('translation card opens without AI requests');
   await clickNode(button('词性与句法'));await until(()=>node(cls('fr-sentence-tokens')),'grounded grammar tokens missing');const hostScroll=await page.evaluate(()=>scrollY);await clickNode(n=>support.cdpAttribute(n,'data-pos')==='noun');await wait(150);
   const tree=await support.getSelectionUiTree(page);const details=support.findCdpNode(tree.root,cls('fr-sentence-detail'));const scrollArea=support.findCdpNode(tree.root,cls('fr-reading-result'));
   const detailBox=await tree.session.send('DOM.getBoxModel',{nodeId:details.nodeId});const areaBox=await tree.session.send('DOM.getBoxModel',{nodeId:scrollArea.nodeId});
   assert(detailBox.model.border[5]<=areaBox.model.border[5]+1,'clicked explanation remains below the card viewport');assert.equal(await page.evaluate(()=>scrollY),hostScroll);
   await screenshot(page,'sentence-grammar');assert.equal(report.aiRequests,1);record('sentence grammar streams through real extension and supports token clicks');
   await clickNode(button('翻译'));await until(()=>node(cls('fr-translation-result')),'return to translation missing');await clickNode(button('词性与句法'));await wait(500);assert.equal(report.aiRequests,1);record('completed explanation reused when returning to grammar');
   await page.keyboard.press('Escape');assert.equal(await node(cls('fr-translation-tooltip')),null);await page.locator('#host-action').click();await wait(300);assert.equal(await node(cls('fr-selection-indicator')),null);record('dismissed selection stays closed after unrelated click');
   await patch({selectionTranslatorPresentation:'card'});await select('#word');await until(()=>node(cls('fr-word-meaning')),'word dictionary missing');assert(support.cdpText(await node(cls('fr-word-meaning'))).includes('形容词'));await screenshot(page,'word-card');await page.setViewportSize({width:390,height:800});await wait(200);report.compactLayouts.push(await assertCompactLayout());await screenshot(page,'word-card-390');await page.setViewportSize({width:1440,height:960});await wait(200);record('word card loads dictionary with normalized part-of-speech labels');
   await page.keyboard.press('Escape');await patch({selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon',selectionTranslatorAutoDismiss:true});
   const beforeQuiet=report.translationRequests;
   await page.mouse.click(20,20);await choose('#sentence');await until(()=>node(cls('fr-selection-indicator')),'quiet entry missing');
   await screenshot(page,'quiet-selection-entry');
   await page.mouse.move(20,20);await wait(800);assert.equal(await node(cls('fr-selection-indicator')),null);assert.equal(report.translationRequests,beforeQuiet);assert.equal(await page.evaluate(()=>getSelection().toString()),sentence);
   record('moving away dismisses unopened entry without changing selection or requesting translation');
   await select('#sentence');await until(()=>node(cls('fr-translation-result')),'copy source translation missing');
   await page.evaluate(()=>{globalThis.__nativeCopy=null;document.addEventListener('copy',event=>{globalThis.__nativeCopy={trusted:event.isTrusted,prevented:event.defaultPrevented,text:getSelection().toString()};},{once:true});});
   await page.keyboard.press('Meta+c');await until(async()=>!(await node(cls('fr-translation-tooltip'))),'native copy left popup open');
   report.nativeCopy=await page.evaluate(()=>globalThis.__nativeCopy);assert.deepEqual(report.nativeCopy,{trusted:true,prevented:false,text:sentence});assert.equal(await page.evaluate(()=>getSelection().toString()),sentence);
   record('native copy closes popup without preventing copy or clearing selected text');
   await select('#sentence');await page.mouse.move(30,500);await page.mouse.wheel(0,350);await until(async()=>!(await node(cls('fr-translation-tooltip'))),'reading scroll left popup open');assert((await page.evaluate(()=>scrollY))>0);
   await page.evaluate(()=>scrollTo(0,0));await wait(200);record('continuing to scroll the page closes translation');
   await patch({selectionTranslatorAutoDismiss:false});await select('#sentence');await page.mouse.move(30,500);await page.mouse.wheel(0,120);await wait(250);assert(await node(cls('fr-translation-tooltip')),'explicit opt out ignored');assert((await page.evaluate(()=>scrollY))>0);
   await page.keyboard.press('Escape');await page.evaluate(()=>scrollTo(0,0));await wait(200);
   assert.equal((await support.readStoredConfig(popup)).selectionTranslatorAutoDismiss,false);await optionsPage.reload();await optionsPage.locator('#settings-selection').waitFor();assert.equal(await optionsPage.getByRole('switch',{name:'继续阅读时自动收起'}).getAttribute('aria-checked'),'false');
   await helper.activateExtensionTabWithoutForeground(context,optionsPage);await optionsPage.getByRole('switch',{name:'继续阅读时自动收起'}).locator('..').click();await until(async()=>(await support.readStoredConfig(popup)).selectionTranslatorAutoDismiss===true,'dismiss setting not saved');record('automatic dismissal opt-out persists and settings can restore it');
   await select('#sentence');await until(()=>node(cls('fr-translation-result')),'card copy translation missing');
   await clickNode(n=>support.cdpAttribute(n,'data-copy-kind')==='translation');await wait(150);assert(await node(cls('fr-translation-tooltip')),'card copy closed the result');
   const innerState=await support.getSelectionUiTree(page);const content=support.findCdpNode(innerState.root,cls('fr-tooltip-content'));const innerBox=await innerState.session.send('DOM.getBoxModel',{nodeId:content.nodeId});
   await page.mouse.move(innerBox.model.content[0]+40,innerBox.model.content[1]+35);await page.mouse.wheel(0,300);await wait(250);assert(await node(cls('fr-translation-tooltip')),'card wheel closed the result');assert.equal(await page.evaluate(()=>scrollY),0);
   record('copy and scroll inside the card keep the result and host page stationary');
   await page.keyboard.press('Escape');await page.evaluate(text=>{document.querySelector('#sentence').textContent=(text+' ').repeat(30).trim();},sentence);
   await choose('#sentence');await until(()=>node(cls('fr-selection-indicator')),'long selection entry missing');await clickNode(cls('fr-selection-indicator'));await until(()=>node(cls('fr-translation-result')),'long selection translation missing');
   const longState=await support.getSelectionUiTree(page);const longContent=support.findCdpNode(longState.root,cls('fr-tooltip-content'));const longBox=await longState.session.send('DOM.getBoxModel',{nodeId:longContent.nodeId});const longResolved=await longState.session.send('DOM.resolveNode',{nodeId:longContent.nodeId});
   await page.mouse.move(longBox.model.content[0]+40,longBox.model.content[1]+35);await page.mouse.wheel(0,200);await wait(250);
   const scroll=await longState.session.send('Runtime.callFunctionOn',{objectId:longResolved.object.objectId,returnByValue:true,functionDeclaration:'function(){return {top:this.scrollTop,height:this.scrollHeight,client:this.clientHeight}}'});
   report.internalScroll=scroll.result.value;assert(report.internalScroll.top>0,'long result cannot scroll');assert.equal(await page.evaluate(()=>scrollY),0);assert(await node(cls('fr-translation-tooltip')));
   await page.mouse.wheel(0,5000);await wait(250);await page.mouse.wheel(0,300);await wait(250);assert.equal(await page.evaluate(()=>scrollY),0);assert(await node(cls('fr-translation-tooltip')),'end of result scroll leaked into the page');
   await page.keyboard.press('Escape');await page.evaluate(text=>{document.querySelector('#sentence').textContent=text;},sentence);record('long results scroll internally and contain wheel movement at the boundary');

   await page.keyboard.press('Escape');await patch({selectionTranslatorTrigger:'direct',selectionTranslatorDelay:1000});
   const beforeCancelled=report.translationRequests;await page.mouse.click(20,20);await choose('#sentence');await wait(100);await page.keyboard.press('Meta+c');await wait(1100);assert.equal(await node(cls('fr-translation-tooltip')),null);assert.equal(report.translationRequests,beforeCancelled);
   record('copy cancels a pending automatic popup before any request');
   await patch({selectionTranslatorDelay:0});
   await page.keyboard.press('Escape');await patch({selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'hover',harness:{...(await support.readStoredConfig(popup)).harness,hoverDelay:1000}});
   await page.mouse.click(20,20);await choose('#sentence');await until(()=>node(cls('fr-selection-indicator')),'hover indicator missing');
   const hoverTree=await support.getSelectionUiTree(page);const indicator=support.findCdpNode(hoverTree.root,cls('fr-selection-indicator'));const indicatorBox=await hoverTree.session.send('DOM.getBoxModel',{nodeId:indicator.nodeId});const [hx,hy]=indicatorBox.model.content;assert.equal(support.findCdpNode(hoverTree.root,cls('fr-translation-tooltip')),null,'hover popup opened before pointer entered');
   const resolvedHover=await hoverTree.session.send('DOM.resolveNode',{nodeId:indicator.nodeId});
   await hoverTree.session.send('Runtime.callFunctionOn',{objectId:resolvedHover.object.objectId,functionDeclaration:`function(){globalThis.__hoverTrace=[];for(const type of ['pointerenter','pointerleave','mouseenter','mouseleave'])this.addEventListener(type,event=>globalThis.__hoverTrace.push({type,time:performance.now(),x:event.clientX,y:event.clientY,trusted:event.isTrusted}));}`});
   await page.mouse.move(hx+5,hy+5);await page.mouse.move(20,20);await wait(1200);
   report.hoverTrace=await page.evaluate(()=>globalThis.__hoverTrace);report.hoverConfig=(await support.readStoredConfig(popup)).harness.hoverDelay;
   console.log('HOVER',JSON.stringify({trace:report.hoverTrace,delay:report.hoverConfig}));
   assert.equal(await node(cls('fr-translation-tooltip')),null);
   await page.mouse.click(20,20);await choose('#sentence');await until(()=>node(cls('fr-selection-indicator')),'hover entry did not return for a new selection');await page.mouse.move(hx+5,hy+5);await until(()=>node(cls('fr-translation-tooltip')),'hover did not open');record('hover waits and cancels on pointer leave');
   await page.keyboard.press('Escape');await patch({selectionTranslatorTrigger:'custom',customSelectionTranslatorHotkey:'Alt+R'});
   await page.mouse.click(20,20);await choose('#sentence');await wait(350);assert.equal(await node(cls('fr-selection-indicator')),null);
   await page.keyboard.press('Alt+r');await until(()=>node(cls('fr-translation-tooltip')),'unified shortcut did not open');record('unified custom shortcut opens selected text without an extra icon');
   await page.keyboard.press('Escape');await patch({uiLanguage:'en-US',selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon'});
   await until(async()=>(await optionsPage.locator('h1').innerText()).includes('Selection'),'English settings did not update');
   await optionsPage.getByRole('button',{name:'Sentence',exact:true}).click();await optionsPage.locator('.fr-sentence-tokens button[data-pos=noun]').first().click();assert((await optionsPage.locator('.fr-sentence-detail').innerText()).includes('noun'));await screenshot(optionsPage,'settings-english');
   await patch({uiLanguage:'zh-CN'});
   await optionsPage.getByRole('switch',{name:'启用划词翻译'}).click();await until(async()=>!(await page.locator('#fluent-read-selection-translator-container').count()),'master off left UI mounted');await choose('#sentence');await wait(400);assert.equal(await node(cls('fr-selection-indicator')),null);record('master off unmounts even when AI preference remains enabled');
   assert.equal(await page.locator('#neighbor').innerText(),'Learning grows with every question.');assert.equal(report.consoleErrors.length,0);report.ok=true;
 }catch(error){primaryError=error;report.error=error.stack; if(optionsPage&&!optionsPage.isClosed())await screenshot(optionsPage,'failure-settings').catch(()=>{});if(page&&!page.isClosed())await screenshot(page,'failure-page').catch(()=>{});throw error;}
 finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {
      if (session) {await session.close(); browserClosed = true;}
    });
    await cleanup(async () => {if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
    await cleanup(() => {
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
    await cleanup(() => {fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
 }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
