#!/usr/bin/env node
// 双语分享卡片生产产物专项：临时 profile、真实可信手势、封闭 Shadow DOM 只读 CDP 检查。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
for (const key of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert(args[key], `Missing --${key}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'package.json'))('playwright');
const focus = require(path.resolve(args['focus-safe-helper']));
const output = path.resolve(args['artifacts-dir']); fs.mkdirSync(output, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-share-card-'));
const original = 'Somewhere, something incredible is waiting to be known.';
const translation = '在某个地方，正有不可思议的事物，等待我们去发现。';
const report = {checks: [], errors: [], service: 'microsoft protocol with controlled local response', profile: 'temporary'};
let session, page, browser, popup, sequence = 0;
const executionContexts = [];
const attr = (n, key) => { const a = n?.attributes || []; const i = a.indexOf(key); return i < 0 ? '' : a[i + 1]; };
function find(n, predicate) {if (!n) return null; if (predicate(n)) return n; for (const child of [...n.children || [], ...n.shadowRoots || []]) {const match = find(child, predicate); if (match) return match;} return null;}
function all(n, predicate, out = []) {if (!n) return out; if (predicate(n)) out.push(n); for (const child of [...n.children || [], ...n.shadowRoots || []]) all(child, predicate, out); return out;}
const cls = (n, value) => attr(n, 'class').split(/\s+/).includes(value);
async function tree() {return (await session.send('DOM.getDocument', {depth: -1, pierce: true})).root;}
async function wait(fn, label, ms = 20000) {const start = Date.now(); while (Date.now()-start < ms) {const v = await fn(); if (v) return v; await new Promise(r=>setTimeout(r, 100));} throw Error(`Timeout: ${label}`);}
async function nodeBy(predicate) {return wait(async()=>find(await tree(), predicate), 'node');}
async function call(node, fn, values = []) {const {object} = await session.send('DOM.resolveNode', {nodeId: node.nodeId}); try {const r = await session.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: fn, arguments: values.map(value=>({value})), returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;} finally {await session.send('Runtime.releaseObject', {objectId: object.objectId});}}
async function clickNode(predicate) {let n = await nodeBy(predicate); await call(n, 'function(){this.scrollIntoView({block:"nearest"})}'); n = await nodeBy(predicate); const {model} = await session.send('DOM.getBoxModel', {nodeId: n.nodeId}); const box = model.content; await page.mouse.click((box[0]+box[2])/2, (box[1]+box[5])/2);}
async function fillNode(n, value) {await call(n, 'function(){this.focus(); this.select()}'); await page.keyboard.insertText(value);}
async function message(request) {return popup.evaluate(r => chrome.runtime.sendMessage(r), request);}
async function config() {const r = await message({type:'configStorageRead', key:'local:config'}); assert.equal(r.success,true); return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;}
async function patch(patch) {const c = await config(); const r = await message({type:'persistConfig',config:{...c,...patch},clientId:'share-card-fixture',sequence:++sequence,baseRevision:c.__fluentConfigRevision}); assert.equal(r.success,true, JSON.stringify(r));}
async function ready() {return wait(async()=>{const n=find(await tree(),x=>cls(x,'fr-card-primary')); return n && !(await call(n,'function(){return this.disabled}'));},'ready image');}
async function imageData() {const root=await tree(); const host=find(root,n=>attr(n,'id')==='fluent-read-share-card-container'); const canvas=find(host,n=>n.nodeName==='CANVAS'); assert(canvas); return call(canvas, 'function(){return {data:this.toDataURL(),width:this.width,height:this.height}}');}
async function savePreview(name) {await ready(); const data=await imageData(); fs.writeFileSync(path.join(output, name+'.png'),Buffer.from(data.data.split(',')[1],'base64')); return data;}
async function noPageEntry(label, translated = false) {
 await page.locator(translated ? '#target .fluent-read-bilingual-content' : '#target').hover();
 await page.locator('#target').focus();
 await page.waitForTimeout(350);
 assert(!find(await tree(),n=>cls(n,'fr-card-launcher')), label+' has no page launcher');
 assert.equal(await page.locator('#fluent-read-share-card-container').count(),0,label+' does not mount studio');
 report.checks.push(label+': no page launcher or studio after trusted hover and focus');
}
async function selectText() {
 const positions=await page.locator('#target').evaluate(el=>{const node=el.firstChild;const first=document.createRange();first.setStart(node,0);first.setEnd(node,1);const last=document.createRange();last.setStart(node,node.length-1);last.setEnd(node,node.length);const a=first.getBoundingClientRect(),b=last.getBoundingClientRect();return {x1:a.left,y1:a.top+a.height/2,x2:b.right,y2:b.top+b.height/2};});
 await page.mouse.move(positions.x1,positions.y1); await page.mouse.down(); await page.mouse.move(positions.x2,positions.y2,{steps:20}); await page.mouse.up();
 await nodeBy(n=>cls(n,'fr-selection-indicator'));
 assert(!find(await tree(),n=>cls(n,'fr-share-card-entry')),'selection before translation has no card entry');
 await clickNode(n=>cls(n,'fr-selection-indicator')); await nodeBy(n=>cls(n,'fr-share-card-entry'));
 assert(!find(await tree(),n=>cls(n,'fr-card-launcher')),'selection result has no page launcher');
}
async function openCard() {
 if (!find(await tree(),n=>cls(n,'fr-share-card-entry'))) await selectText();
 await clickNode(n=>cls(n,'fr-share-card-entry')); await ready();
}
async function fullToggle() {await page.keyboard.press('Alt+t');}
async function closeCard() {await clickNode(n=>cls(n,'fr-card-close')); await wait(async()=>!find(await tree(),n=>cls(n,'fr-card-primary')), 'closed');}
async function toggle() {const box=await page.locator('#target').boundingBox(); await page.mouse.click(box.x+20,box.y+12); await page.keyboard.down('Control'); await page.keyboard.up('Control');}
(async()=>{
 try {
  browser=await focus.launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,browserArgs:[`--disable-extensions-except=${path.resolve(args['extension-dir'])}`,`--load-extension=${path.resolve(args['extension-dir'])}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
  Object.assign(report,{launchMode:browser.launchMode,focusPolicy:browser.focusPolicy,windowPlacement:browser.windowPlacement});
  const context=browser.context;
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const install=target=>target.evaluate(({translation})=>{const original=globalThis.fetch.bind(globalThis); globalThis.fetch=(input,init)=>{const url=typeof input==='string'||input instanceof URL?String(input):input.url; if(String(url).startsWith('https://edge.microsoft.com/translate/translatetext')){const body=JSON.parse(init.body);return Promise.resolve(new Response(JSON.stringify(body.map(()=>({translations:[{text:translation}]}))),{status:200,headers:{'content-type':'application/json'}}));} return original(input,init);};},{translation});
  await install(worker); context.on('serviceworker',w=>void install(w));
  const extensionId=worker.url().split('/')[2];
  popup=await focus.newPageWithoutForeground(context); await popup.goto(`chrome-extension://${extensionId}/popup.html`); await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
  await patch({uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,on:true,service:'microsoft',useCache:false,display:1,from:'auto',to:'zh-Hans',hotkey:'Control',floatingBallHotkey:'Alt+T',disableSelectionTranslator:false,selectionTranslatorMode:'bilingual',selectionTranslatorTrigger:'icon',selectionTranslatorDelay:0});
  await context.route('https://example.com/**',r=>r.fulfill({status:200,contentType:'text/html',headers:{'content-security-policy':"img-src 'none'; object-src 'none'"},body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reading notes</title><style>body{margin:0;background:#f5f5f0;font:22px/1.9 Georgia;color:#26352c} main{max-width:700px;margin:100px auto}h1{font-size:30px}button{font-size:90px!important;background:red!important}dialog{color:red!important}#neighbor{margin-top:100px}</style></head><body><main><h1>A small reading moment</h1><p id="target" tabindex="0">${original}</p><p id="neighbor">This neighboring paragraph must remain unchanged.</p></main></body></html>`}));
  page=await focus.newPageWithoutForeground(context); page.on('pageerror',e=>report.errors.push(e.message)); await page.goto('https://example.com/private/article?token=secret#note'); await page.locator('#fluent-read-page-styles').waitFor({state:'attached'}); session=await context.newCDPSession(page);
  session.on('Runtime.executionContextCreated', ({context}) => executionContexts.push(context)); await session.send('Runtime.enable');
  await noPageEntry('ordinary browsing');
  await fullToggle(); await page.locator('#target .fluent-read-bilingual-content').waitFor(); await page.locator('#neighbor .fluent-read-bilingual-content').waitFor();
  await noPageEntry('full-page translation',true);
  await fullToggle(); await wait(()=>page.locator('.fluent-read-bilingual-content').count().then(n=>n===0),'full-page restore');
  await toggle(); await page.locator('#target .fluent-read-bilingual-content').waitFor(); assert.equal(await page.locator('#target .fluent-read-bilingual-content').innerText(),translation); assert.equal(await page.locator('#neighbor .fluent-read-bilingual-content').count(),0);
  await noPageEntry('hover paragraph translation',true); await page.screenshot({path:path.join(output,'page-without-card-entry.png')});
  await selectText(); await page.screenshot({path:path.join(output,'selection-with-card-entry.png')});
  await openCard(); assert.equal(await page.evaluate(()=>document.querySelector('#fluent-read-share-card-container').shadowRoot),null);
  assert(!find(await tree(),n=>attr(n,'data-action')==='share'), 'card has no share image button');
  if (process.argv.includes('--multilingual-only')) {
    await clickNode(n=>n.nodeName==='SUMMARY' && all(n,x=>x.nodeName==='#text').some(x=>x.nodeValue.includes('更多设置')));
    const locales = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'];
    for (const language of locales) {
      const source = fs.readFileSync(path.resolve('src/core/i18n/messages', language + '.ts'), 'utf8');
      const title = JSON.parse(source.match(/"shareCard.create": (".*")/)[1].replace(/,$/, ''));
      await patch({uiLanguage: language});
      await wait(async () => call(await nodeBy(n => cls(n, 'fr-card-header')), 'function(){return this.querySelector("h2").textContent}') .then(text => text === title), 'localized share title');
      for (const width of [1280, 390]) {
        await page.setViewportSize({width, height: 900});
        const dialog = await nodeBy(n => cls(n, 'fr-card-dialog'));
        const layout = await call(dialog, `function(){
          return {overflow:this.scrollWidth>this.clientWidth+1, clipped:[...this.querySelectorAll('h2,button')].filter(el=>el.checkVisibility({visibilityProperty:true})&&el.scrollWidth>el.clientWidth+1).map(el=>el.textContent.trim())};
        }`);
        assert.equal(layout.overflow, false, `${language} ${width}px dialog overflow`);
        assert.deepEqual(layout.clipped, [], `${language} ${width}px share labels`);
        await page.screenshot({path:path.join(output, `share-${language}-${width}.png`)});
      }
      assert.equal(await page.locator('#neighbor').innerText(), 'This neighboring paragraph must remain unchanged.');
      report.checks.push(`${language}: complete share dialog labels at 1280/390px, host content unchanged`);
    }
    assert.deepEqual(report.errors, []); report.status = 'passed'; return;
  }
  await savePreview('coral'); await page.screenshot({path:path.join(output,'studio-desktop.png')}); report.checks.push('selection entry, closed Shadow DOM, hostile CSS + image CSP, default coral preview');
  await clickNode(n=>n.nodeName==='SUMMARY' && all(n,x=>x.nodeName==='#text').some(x=>x.nodeValue.includes('编辑摘录')));
  let fields=all(await tree(),n=>n.nodeName==='TEXTAREA'); assert.equal(await call(fields[0],'function(){return this.value}'),original); assert.equal(await call(fields[1],'function(){return this.value}'),translation);
  await clickNode(n=>n.nodeName==='SUMMARY' && all(n,x=>x.nodeName==='#text').some(x=>x.nodeValue.includes('更多设置')));
  const source=await nodeBy(n=>n.nodeName==='INPUT'&&attr(n,'maxlength')==='160'); assert.equal(await call(source,'function(){return this.value}'),'example.com');
  const themes = ['coral','sky','prism','pearl','moss','linen','sunset','blueprint'];
  assert.equal(all(await tree(), n => themes.includes(attr(n,'data-theme'))).length, 8);
  for(const theme of themes.slice(1)){await clickNode(n=>attr(n,'data-theme')===theme); await savePreview(theme); await wait(async()=>(await config()).shareCard.theme===theme, 'persisted '+theme);}
  const previews = themes.map(name => ({name, data: fs.readFileSync(path.join(output,name+'.png')).toString('base64')}));
  assert.equal(new Set(previews.map(p=>p.data)).size, 8, 'eight distinct exported designs');
  const gallery = await popup.evaluate(async previews => {
    const canvas = document.createElement('canvas'); canvas.width=1320; canvas.height=1570; const ctx=canvas.getContext('2d');
    ctx.fillStyle='#f3f4f8'; ctx.fillRect(0,0,1320,1570);
    const labels=['01  珊瑚 · Coral  /  默认','02  晴空 · Sky','03  流光 · Prism','04  月白 · Pearl','05  抹茶 · Matcha','06  书页 · Linen','07  落日 · Sunset','08  蓝图 · Blueprint'];
    for(let i=0;i<previews.length;i++) {const img=new Image(); img.src='data:image/png;base64,'+previews[i].data; await img.decode(); const x=36+(i%2)*642,y=48+Math.floor(i/2)*380; ctx.fillStyle='#323847';ctx.font='500 18px system-ui';ctx.fillText(labels[i],x,y-15);ctx.drawImage(img,x,y,606,606*img.height/img.width);}
    return canvas.toDataURL();
  },previews);
  fs.writeFileSync(path.join(output,'styles-comparison.png'),Buffer.from(gallery.split(',')[1],'base64'));
  report.images = Object.fromEntries(previews.map(({name})=>[name,(()=>{const png=fs.readFileSync(path.join(output,name+'.png'));return {bytes:png.length,width:png.readUInt32BE(16),height:png.readUInt32BE(20)};})()]));
  report.savedPreferences = (await config()).shareCard;
  await clickNode(n=>attr(n,'data-theme')==='pearl'); await ready();
  await wait(async()=>(await config()).shareCard.theme==='pearl','saved theme');
  await clickNode(n=>attr(n,'data-format')==='square');
  await ready(); const square = await imageData(); assert.equal(square.width,square.height);
  await fillNode(all(await tree(),n=>n.nodeName==='TEXTAREA')[0],'A thought to remember. '.repeat(22));
  await wait(async()=>{const n=find(await tree(),x=>cls(x,'fr-card-primary')); return n && call(n,'function(){return this.disabled}');}, 'square overflow blocked');
  await clickNode(n=>attr(n,'data-format')==='auto');
  await ready(); await fillNode(all(await tree(),n=>n.nodeName==='TEXTAREA')[0],original); await ready();
  report.checks.push('square export, overflow rejected, auto layout recovery');
  const preview=await imageData(); const downloadEvent=page.waitForEvent('download'); await clickNode(n=>cls(n,'fr-card-primary')); const downloaded=await downloadEvent; const file=path.join(output,'downloaded-card.png'); await downloaded.saveAs(file); assert.equal(fs.readFileSync(file).toString('base64'),preview.data.split(',')[1]);
  await nodeBy(n=>cls(n,'fr-card-feedback')&&cls(n,'is-success')); await page.screenshot({path:path.join(output,'save-success.png')});
  report.checks.push('eight styles, each preference persisted, actual PNG download identical to preview, prominent save feedback');
  // 仅在隔离扩展执行上下文替换导出 API，验证可见反馈，不覆盖用户剪贴板、不调用系统分享。
  const isolated = executionContexts.find(c=>c.origin===`chrome-extension://${extensionId}` && !c.auxData?.isDefault);
  assert(isolated, 'extension execution context');
  const mockExport = async expression => {
    const result = await session.send('Runtime.evaluate', {contextId:isolated.id, expression});
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  };
  await mockExport(`Object.defineProperty(navigator.clipboard, 'write', {configurable:true,value:()=>Promise.resolve()})`);
  await clickNode(n=>attr(n,'data-action')==='copy'); await nodeBy(n=>cls(n,'fr-card-feedback')&&cls(n,'is-success'));
  let feedback=await nodeBy(n=>cls(n,'fr-card-feedback')); assert((await call(feedback,'function(){return this.textContent}')).includes('图片已复制'));
  await page.screenshot({path:path.join(output,'copy-success.png')});
  await mockExport(`Object.defineProperty(navigator.clipboard, 'write', {configurable:true,value:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))})`);
  await clickNode(n=>attr(n,'data-action')==='copy'); feedback=await nodeBy(n=>cls(n,'fr-card-feedback')&&cls(n,'is-error')); assert((await call(feedback,'function(){return this.textContent}')).includes('未能复制'));
  await page.screenshot({path:path.join(output,'copy-error.png')});
  report.checks.push('trusted clicks with isolated clipboard success/rejection stubs show semantic banners; system clipboard untouched');
  await mockExport(`Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.resolve()}); Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true})`);
  assert(!find(await tree(),n=>attr(n,'data-action')==='share'), 'no share image button even when system sharing is supported');
  report.checks.push('share image button absent, including with file-sharing support; copy and save remain available');
  for (const key of ['translationFirst','showSource','showBrand']) {
    await clickNode(n=>attr(n,'data-setting')===key); await ready(); const field=await nodeBy(n=>attr(n,'data-setting')===key);
    const checked=await call(field,'function(){return this.checked}'); await wait(async()=>(await config()).shareCard[key]===checked, 'switch persisted '+key);
    await clickNode(n=>attr(n,'data-setting')===key); await ready();
  }
  for (const size of ['small','large','medium']) {await clickNode(n=>attr(n,'data-font-size')===size); await ready();}
  await page.screenshot({path:path.join(output,'studio-settings.png')}); report.checks.push('brand segmented settings and keyboard-native switches update previews and persist');
  fields=all(await tree(),n=>n.nodeName==='TEXTAREA'); await fillNode(fields[0],'a'.repeat(3001)); await wait(async()=>{const n=find(await tree(),x=>cls(x,'fr-card-primary')); return n && call(n,'function(){return this.disabled}');},'long disabled'); await wait(async()=>!find(await tree(),n=>n.nodeName==='CANVAS'),'invalid preview cleared'); await fillNode((all(await tree(),n=>n.nodeName==='TEXTAREA'))[0],original); await ready();
  await clickNode(n=>n.nodeName==='SUMMARY' && all(n,x=>x.nodeName==='#text').some(x=>x.nodeValue.includes('编辑摘录')));
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:path.join(output,'studio-mobile.png')}); const bounds=await call(await nodeBy(n=>cls(n,'fr-card-dialog')),'function(){const r=this.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:this.scrollWidth,clientWidth:this.clientWidth}}'); assert(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height); assert(bounds.scrollWidth<=bounds.clientWidth); report.checks.push('long text blocked without stale export, 390px responsive dialog with expanded settings');
  await closeCard(); await page.setViewportSize({width:1280,height:900}); await openCard(); const active=await nodeBy(n=>attr(n,'data-theme')==='pearl'); assert.equal(attr(active,'aria-pressed'),'true'); await closeCard();
  await toggle(); await wait(()=>page.locator('#target .fluent-read-bilingual-content').count().then(n=>n===0),'restore'); await toggle(); await page.locator('#target .fluent-read-bilingual-content').waitFor(); assert.equal(await page.locator('#target .fluent-read-bilingual-content').count(),1); report.checks.push('translate / restore / retranslate [1,0,1], no adjacent paragraph change');
  // 通过真实拖选打开划词结果，再验证它复用同一个工作台。
  await toggle(); await wait(()=>page.locator('#target .fluent-read-bilingual-content').count().then(n=>n===0),'restore before selection');
  await selectText(); await openCard(); await closeCard(); assert(find(await tree(),n=>cls(n,'fr-translation-tooltip'))); report.checks.push('selection result entry, close preserves translation result');
  await patch({selectionTranslatorMode:'translation-only'}); assert.equal((await config()).selectionTranslatorMode,'translation-only');
  await page.reload(); await page.locator('#fluent-read-page-styles').waitFor({state:'attached'}); await noPageEntry('translation-only mode ordinary browsing'); await selectText(); await openCard(); await closeCard();
  assert(find(await tree(),n=>cls(n,'fr-translation-tooltip'))); report.checks.push('translation-only selection result also opens studio');
  await patch({on:false}); await page.locator('#fluent-read-share-card-container').waitFor({state:'detached'}); report.checks.push('disable removes UI');
  assert.deepEqual(report.errors,[]); report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.stack||error);if(session){const n=find(await tree(),n=>attr(n,'id')==='fluent-read-share-card-container'); if(n)report.uiText=await call(n,'function(){return this.textContent}').catch(()=>null);const feedback=find(await tree(),n=>cls(n,'fr-card-feedback')); if(feedback)report.feedback=await call(feedback,'function(){return this.textContent}');}if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
 finally {fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)); await browser?.close(); fs.rmSync(profileDir,{recursive:true,force:true});}
})();
