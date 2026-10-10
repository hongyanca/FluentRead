/**
 * 相同译文生产浏览器专项：本地确定性网页、悬浮/全文真实手势、标点回显恢复、短中文名称提示、动态段落、划词卡片、翻译中心、文档校订及 legacy DeepL string 槽协议。
 * 使用临时 Edge profile 和 focus-safe helper；页面/供应商均为夹具，不代表在线供应商质量或 Firefox 实机行为。
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const support = require('../run-selection-trigger-test.cjs');
const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
for (const name of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert(process.argv.includes(`--${name}`), name);
const extensionDir = path.resolve(arg('extension-dir')), artifacts = path.resolve(arg('artifacts-dir'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(path.resolve(arg('focus-safe-helper')));
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-identical-'));
const identity = fs.lstatSync(profileDir);
const report = {scope: 'same-text suppression, Unicode/whitespace equivalence, mixed-page restore and repeat, selection source fallback, comparison results', cases: [], errors: [], screenshots: [], profileMode: 'automatically-created-temporary-profile'};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Amber Meadow</title></head><body style="font:20px/1.8 system-ui;padding:50px;max-width:900px">
<main><p id="same">Amber Meadow</p><p id="unicode">Café</p><p id="zero-width">North Pier</p>
<p id="rich">Amber <code>protected_code()</code> Meadow</p><p id="changed">This paragraph has changes in translation.</p>
<p id="wrapped-echo">The software reads the document and translates the language on this page.</p>
<p id="chinese-apple">继续使用 Apple</p><p id="chinese-google">继续使用 Google</p><p id="chinese-through">通过 Google 继续操作</p></main></body></html>`;
const deepLSlots = {
 firstEnglish: 'The software reads the document and translates the language on this page.',
 secondEnglish: 'The second paragraph explains the settings for the computer network.',
 firstChinese: '软件读取文档并翻译页面上的语言。',
 secondChinese: '第二段说明计算机网络设置。',
};
const deepLFixtureKey = '00000000-0000-4000-8000-000000000000:fx';
const deepLTitle = '富文本片段测试';
const deepLHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${deepLTitle}</title></head><body style="font:20px/1.8 system-ui;padding:50px;max-width:900px"><main><p id="deepl-slots">${deepLSlots.firstEnglish} <code>protected_code()</code> ${deepLSlots.secondEnglish}</p></main></body></html>`;
const server = http.createServer((req, res) => {res.writeHead(200, {'content-type':'text/html; charset=utf-8'});res.end(req.url === '/deepl-slots' ? deepLHtml : html);});
let launched, page, popup, worker, launchAttempted = false;
const wait = async (check, label) => {const until = Date.now()+15000; while(Date.now()<until){if(await check())return;await page.waitForTimeout(70);}throw new Error(label);};
const count = selector => page.locator(selector+' .fluent-read-bilingual-content').count();
async function gesture(selector){const box=await page.locator(selector).boundingBox();await page.mouse.move(box.x+20,box.y+12);await page.mouse.click(box.x+20,box.y+12);await page.keyboard.down('Control');await page.keyboard.up('Control');}
async function shot(name){const file=path.join(artifacts,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function selectionUi(fn){const tree=await support.getSelectionUiTree(page);const card=support.findCdpNode(tree.root,node=>(support.cdpAttribute(node,'class')||'').split(' ').includes('fr-translation-tooltip'));if(!card)return null;const {object}=await tree.session.send('DOM.resolveNode',{nodeId:card.nodeId});try{const result=await tree.session.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}finally{await tree.session.send('Runtime.releaseObject',{objectId:object.objectId});}}
(async()=>{
 report.buildFreshness=assertFreshProductionExtension(extensionDir);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 launchAttempted=true;
 launched=await launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,viewport:{width:1280,height:900},browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
 Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
 assert.equal(report.launchMode,'macos-background-cdp');assert.equal(report.focusPolicy,'launchservices-no-foreground');assert.equal(report.windowPlacement.browserFrontmost,false);
 const context=launched.context;
 worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker');
 const origin=`chrome-extension://${new URL(worker.url()).host}`;
 popup=await newPageWithoutForeground(context);await popup.goto(origin+'/popup.html');
 await support.patchStoredConfig(popup,{on:true,service:'google',from:'en',to:'zh-Hans',display:1,hotkey:'Control',disableFloatingBall:true,disableSelectionTranslator:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,useCache:true});
  await worker.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.__identicalFixture = {origins: [], requests: [], wrappedEchoAttempts: 0};
    globalThis.fetch = async (input, options) => {
      const url = String(typeof input === 'string' ? input : input.url || input);
      const translateFixture = (origin, source, target) => {
        globalThis.__identicalFixture.origins.push(origin);
        globalThis.__identicalFixture.requests.push({origin, source, target});
        return origin.split(/(___FLUENTREAD_[A-Za-z0-9]+_\d+_(?:BEGIN|END)___)/)
          .map(part => {
            if (part.startsWith('___FLUENTREAD_') || !part.trim()) return part;
            if (part.includes('North Pier')) return part + '\u200b';
            if (part.includes('The software reads the document')) {
              globalThis.__identicalFixture.wrappedEchoAttempts++;
              return globalThis.__identicalFixture.wrappedEchoAttempts === 1 ? part + '!' : '软件读取文档并翻译页面上的语言。';
            }
            // 故意返回不同中文；不能靠相同输出被隐藏来掩盖同目标预检漏发请求。
            if (['继续使用 Apple', '继续使用 Google', '通过 Google 继续操作'].some(text => part.includes(text))) return '此处不应被再次翻译。';
            return part.includes('changes in translation') ? '这是一段有变化的译文。' : part.normalize('NFD');
          }).join('');
      };
      if (url.includes('/v1/translateHtml')) {
        const [texts, source, target] = JSON.parse(options.body)[0];
        const translated = texts.map(text => `<pre>${translateFixture(text.replace(/^<pre>|<\/pre>$/g, ''), source, target)}</pre>`);
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Response(JSON.stringify([translated]), {status: 200});
      }
      if (url.includes('/translate_a/t')) {
        const parsed = new URL(url), body = new URLSearchParams(options.body);
        const translated = body.getAll('q').map(text => translateFixture(text, parsed.searchParams.get('sl'), parsed.searchParams.get('tl')));
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Response(JSON.stringify(translated), {status: 200});
      }
      if (url.includes('/_/TranslateWebserverUi/data/batchexecute')) {
        const records = JSON.parse(new URLSearchParams(options.body).get('f.req'))[0].map(rpc => {
          const [origin, source, target] = JSON.parse(rpc[1])[0];
          const entry = [null, null, null, null, null, [[translateFixture(origin, source, target)]]];
          return ['wrb.fr', 'MkEWBc', JSON.stringify([null, [[entry]]]), null, null, null, rpc[3]];
        });
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Response(JSON.stringify(records), {status: 200});
      }
      return original(input, options);
    };
  });
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page);
 const original=await page.locator('main').innerHTML();
 for(const selector of ['#same','#unicode','#zero-width','#rich']){await gesture(selector);await page.waitForTimeout(900);assert.equal(await count(selector),0);assert.equal(await page.locator(selector+' .fluent-read-loading, '+selector+' .fluent-read-retry-wrapper').count(),0);}
 assert.equal(await page.locator('main').innerHTML(),original);assert.equal(await page.title(),'Amber Meadow');report.cases.push('hover identical, NFC-equivalent and protected-inline results create no translation or placeholder');
 const chineseSelectors=['#chinese-apple','#chinese-google','#chinese-through'];
 for(const selector of chineseSelectors){await gesture(selector);await page.waitForTimeout(350);assert.equal(await count(selector),0);}
 await gesture('#wrapped-echo');await wait(async()=>await count('#wrapped-echo')===1,'wrapped echo recovery');
 assert.equal(await page.locator('#wrapped-echo .fluent-read-bilingual-content').innerText(),'软件读取文档并翻译页面上的语言。');
 assert.equal(await worker.evaluate(()=>globalThis.__identicalFixture.wrappedEchoAttempts),2);
 await gesture('#wrapped-echo');await wait(async()=>await count('#wrapped-echo')===0,'wrapped echo restore');
 report.cases.push('punctuation-only English echo retries once and commits the corrected result');
 const toggles=[];for(let i=0;i<3;i++){await gesture('#changed');await wait(async()=>await count('#changed')===(i===1?0:1),'normal hover toggle');toggles.push(await count('#changed'));}assert.deepEqual(toggles,[1,0,1]);report.cases.push('changed hover [1,0,1]');
 await gesture('#changed');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===1,'full-page changed result');await page.waitForTimeout(900);
 for(const selector of ['#same','#unicode','#zero-width','#rich'])assert.equal(await count(selector),0);
 for(const selector of chineseSelectors)assert.equal(await count(selector),0);
 const sameTargetRequests=await worker.evaluate(()=>globalThis.__identicalFixture.requests.filter(request=>
   ['继续使用 Apple','继续使用 Google','通过 Google 继续操作'].some(text=>request.origin.includes(text))));
 assert.deepEqual(sameTargetRequests,[]);report.cases.push('short Chinese service-name labels make zero provider fetches in hover and full-page translation');
 assert.equal(await page.locator('.fluent-read-loading').count(),0);await shot('01-mixed-page');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===0,'full-page restore');assert.equal(await page.locator('main').innerHTML(),original);
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===1,'full-page repeat');for(const selector of ['#same','#unicode','#zero-width','#rich'])assert.equal(await count(selector),0);
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===0,'second restore');report.cases.push('mixed full-page translate/restore/repeat keeps identical paragraphs untouched');
 assert.deepEqual(await worker.evaluate(()=>globalThis.__identicalFixture.requests.filter(request=>
   ['继续使用 Apple','继续使用 Google','通过 Google 继续操作'].some(text=>request.origin.includes(text)))),[]);
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===1,'dynamic session start');
 await page.evaluate(()=>document.querySelector('#same').textContent='This paragraph has changes in translation.');await wait(async()=>await count('#same')===1,'dynamic changed paragraph');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#same')===0,'dynamic restore');await page.evaluate(()=>document.querySelector('#same').textContent='Amber Meadow');report.cases.push('previously unchanged paragraph translates after a live source edit and restores correctly');
 for(const mode of ['bilingual','translation-only']){
  await support.patchStoredConfig(popup,{disableSelectionTranslator:false,selectionTranslatorTrigger:'direct',selectionTranslatorMode:mode,selectionTranslatorDelay:0,selectionTranslatorAutoDismiss:false});
  await page.reload();await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page);
  const points=await page.evaluate(()=>{const text=document.querySelector('#same').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,1);const first=range.getBoundingClientRect();range.setStart(text,text.length-1);range.setEnd(text,text.length);const last=range.getBoundingClientRect();return {x:first.left,y:first.top+first.height/2,x2:last.right+2,y2:last.top+last.height/2};});
  await page.mouse.move(points.x,points.y);await page.mouse.down();await page.mouse.move(points.x2,points.y2,{steps:12});await page.mouse.up();
  await wait(async()=>await selectionUi(function(){return !this.querySelector('.fr-loading-state')&&this.querySelector('.fr-original-text pre')?.textContent.includes('Amber Meadow');}),'same selection source fallback');
  const result=await selectionUi(function(){return {source:this.querySelectorAll('.fr-original-text').length,translated:this.querySelectorAll('.fr-translation-result,.fr-word-translation').length,errors:this.querySelectorAll('.fr-error-state').length};});
  assert.deepEqual(result,{source:1,translated:0,errors:0});await shot('02-selection-'+mode);report.cases.push('selection '+mode+' keeps source once and hides equal result');
 }
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));await page.goto(origin+'/options.html#settings-translation-center');await page.locator('.translation-center').waitFor();
 await support.patchStoredConfig(page,{translationCenterServices:['google'],translationCenterSourceLanguage:'en',translationCenterTargetLanguage:'zh-Hans'});await page.reload();await page.locator('.translation-center textarea').fill('Amber Meadow');
 await page.getByRole('button',{name:'开始翻译',exact:false}).click();await page.locator('.translation-result-card[data-status="success"]').waitFor();
 assert.equal(await page.locator('.translation-result-content p').count(),1);assert.equal(await page.locator('.translation-result-content p').innerText(),'Amber Meadow');assert.equal(await page.locator('.copy-all-button').isDisabled(),false);assert.equal(await page.locator('.translation-result-content footer button').filter({hasText:'复制'}).count(),1);await shot('03-center-same');report.cases.push('comparison exception displays equal service output and keeps single/all copy actions available');
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));await page.goto(origin+'/document.html');
 await page.locator('input[type="file"]').setInputFiles({name:'same.txt',mimeType:'text/plain',buffer:Buffer.from('Amber Meadow')});
 await page.getByRole('button',{name:'开始翻译',exact:true}).click();await page.locator('.task-progress.complete').waitFor({state:'attached'});
 await page.getByRole('group',{name:'阅读方式'}).getByRole('button',{name:'双语',exact:true}).click();
 const frame=page.frameLocator('.rich-preview-frame');await frame.locator('.reader-source').waitFor();assert.equal(await frame.locator('.reader-translation').count(),0);assert.equal((await frame.locator('body').innerText()).trim(),'Amber Meadow');
 await page.getByRole('group',{name:'文档工作区'}).getByRole('button',{name:'校订译文',exact:true}).click();
 const editor=page.locator('.segment-editor');assert.equal(await editor.locator('textarea').count(),0);await editor.locator('.segment-edit-row button').click();await editor.locator('textarea').fill('中文已修改');
 await page.getByRole('group',{name:'文档工作区'}).getByRole('button',{name:'阅读',exact:true}).click();await frame.locator('.reader-translation').waitFor();assert.equal(await frame.locator('.reader-translation').innerText(),'中文已修改');
 await shot('04-document-review');report.cases.push('same document preview shows source once; folded review can reopen and edit normally');
 // 原 Google 10 cases 全部结束后才启用 DeepL；复用本脚本自行创建的隔离 profile。
 assert.equal(report.cases.length,10,'preserve the original ten Google cases');
 // 结束先前页面的翻译会话，避免切换服务时其配置观察者向新夹具发请求。
 // 此 context 完全属于本脚本的临时 profile；仅保留配置所用 popup。
 for(const previousPage of context.pages())if(previousPage!==popup)await previousPage.close();
 await worker.evaluate(slots => {
   const previousFetch = globalThis.fetch.bind(globalThis);
   const fixture = globalThis.__deepLSlotFixture = {fetches: 0, requests: [], packet: null, partial: null, repaired: null, start: null};
   globalThis.fetch = async (input, options) => {
     const url = String(typeof input === 'string' ? input : input.url || input);
     if (!url.includes('/v2/translate')) return previousFetch(input, options);
     const body = JSON.parse(options.body);
     if (!Array.isArray(body.text) || body.text.length !== 1 || !body.text.every(text => typeof text === 'string')) {
       throw new Error('DeepL fixture requires text to contain exactly one string; nested batch origins are forbidden');
     }
     // 只记录 adapter 的正文/语言，不读取或保存 headers、鉴权、完整 options。
     fixture.requests.push({text: [...body.text], source: body.source_lang ?? null, target: body.target_lang ?? null});
     if (body.source_lang !== 'EN' || body.target_lang !== 'ZH-HANS') throw new Error('DeepL fixture language mapping mismatch');
     fixture.fetches++;
     let translation;
     if (fixture.fetches === 1) {
       const packet = body.text[0];
       const match = /^(___FLUENTREAD_([a-z0-9_-]+)_0_BEGIN___)([\s\S]*?)(___FLUENTREAD_\2_0_END___)\n(___FLUENTREAD_\2_1_BEGIN___)([\s\S]*?)(___FLUENTREAD_\2_1_END___)$/iu.exec(packet);
       if (!match || match[3] !== slots.firstEnglish || match[6] !== slots.secondEnglish || packet.includes('protected_code()')) {
         throw new Error('DeepL fixture expected two ordered prose slots with protected code omitted');
       }
       fixture.packet = packet;
       fixture.start = match[1];
       fixture.partial = `${match[1]}${slots.firstEnglish}!${match[4]}\n${match[5]}${slots.secondChinese}${match[7]}`;
       fixture.repaired = `${match[1]}${slots.firstChinese}${match[4]}\n${match[5]}${slots.secondChinese}${match[7]}`;
       translation = fixture.partial;
     } else if (fixture.fetches === 2 && body.text[0] === slots.firstEnglish) {
       translation = slots.firstChinese;
     } else {
       throw new Error('DeepL fixture rejects extra requests or retransmission of the good second slot');
     }
     await new Promise(resolve => setTimeout(resolve,60));
     return new Response(JSON.stringify({translations: [{text: translation, detected_source_language: 'EN'}]}),
       {status: 200, headers: {'content-type':'application/json'}});
   };
 },deepLSlots);
 const beforeDeepLConfig=await support.readStoredConfig(popup);
 await support.patchStoredConfig(popup,{on:true,service:'deepL',from:'en',to:'zh-Hans',display:1,hotkey:'Control',useCache:true,
   enableAIContext:false,enableAIMultiSegment:false,glossaryEnabled:false,deeplApiPlan:'free',
   token:{...beforeDeepLConfig.token,deepL:deepLFixtureKey},apiKeys:{...beforeDeepLConfig.apiKeys,deepL:[deepLFixtureKey]},
   apiKeyRotationEnabled:{...beforeDeepLConfig.apiKeyRotationEnabled,deepL:false},proxy:{...beforeDeepLConfig.proxy,deepL:''}});
 const deepLUrl=`http://127.0.0.1:${server.address().port}/deepl-slots`;
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(deepLUrl);await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page);
 const deepLOriginal=await page.locator('main').innerHTML();
 await page.evaluate(()=>{globalThis.__deepLOriginalCode=document.querySelector('#deepl-slots > code');});
 const assertDeepLRendered=async()=>{
   await wait(async()=>await count('#deepl-slots')===1,'DeepL repaired slot wrapper');
   const rendered=await page.evaluate(()=>{
     const paragraph=document.querySelector('#deepl-slots'),wrapper=paragraph.querySelector('.fluent-read-bilingual-content');
     return {text:wrapper.textContent,wrappers:document.querySelectorAll('main .fluent-read-bilingual-content').length,
       nested:wrapper.querySelectorAll('.fluent-read-bilingual-content').length,
       codeUnchanged:paragraph.querySelector(':scope > code')===globalThis.__deepLOriginalCode,
       originalCode:globalThis.__deepLOriginalCode.outerHTML,
       pending:paragraph.querySelectorAll('.fluent-read-loading,.fluent-read-retry-wrapper').length};
   });
   assert.equal(rendered.text.replace(/\s+/gu,' ').trim(),`${deepLSlots.firstChinese} protected_code() ${deepLSlots.secondChinese}`);
   assert.equal(rendered.wrappers,1);assert.equal(rendered.nested,0);assert.equal(rendered.pending,0);
   assert.equal(rendered.codeUnchanged,true);assert.equal(rendered.originalCode,'<code>protected_code()</code>');
   assert.equal(await page.title(),deepLTitle);
   return rendered;
 };
 const deepLCounts=[];
 await page.keyboard.press('Alt+T');await assertDeepLRendered();deepLCounts.push(await count('#deepl-slots'));
 const firstDeepLRequests=await worker.evaluate(()=>globalThis.__deepLSlotFixture.requests);
 assert.equal(firstDeepLRequests.length,2);
 assert.deepEqual(firstDeepLRequests[1],{text:[deepLSlots.firstEnglish],source:'EN',target:'ZH-HANS'});
 await shot('05-deepl-slot-recovery');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#deepl-slots')===0,'DeepL exact restore');deepLCounts.push(await count('#deepl-slots'));
 assert.equal(await page.locator('main').innerHTML(),deepLOriginal);
 await page.keyboard.press('Alt+T');await assertDeepLRendered();deepLCounts.push(await count('#deepl-slots'));
 assert.deepEqual(await worker.evaluate(()=>globalThis.__deepLSlotFixture.requests),firstDeepLRequests,'repeat must not resend the protocol or good slot');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#deepl-slots')===0,'DeepL repeat restore');deepLCounts.push(await count('#deepl-slots'));
 assert.deepEqual(deepLCounts,[1,0,1,0]);assert.equal(await page.locator('main').innerHTML(),deepLOriginal);
 // 核对真正的持久记录：初始部分回显不能以成功结果写库。只返回该 fixture 的译文，不导出配置/凭据。
 const readDeepLCache=()=>worker.evaluate(async()=>{
   const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('FluentReadTranslationCache');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('DeepL fixture cache open failed'));});
   try{
     const records=await new Promise((resolve,reject)=>{const request=database.transaction('entries','readonly').objectStore('entries').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('DeepL fixture cache read failed'));});
     const fixture=globalThis.__deepLSlotFixture;
     return records.filter(record=>typeof record.translation==='string'&&record.translation.includes(fixture.start)).map(record=>record.translation);
   }finally{database.close();}
 });
 const repairedPacket=await worker.evaluate(()=>globalThis.__deepLSlotFixture.repaired);
 await wait(async()=>{const cached=await readDeepLCache();return cached.length===1&&cached[0]===repairedPacket;},'DeepL stores only the repaired packet');
 const persistedPackets=await readDeepLCache();assert.deepEqual(persistedPackets,[repairedPacket]);
 // 重载销毁 frontend 会话缓存；依然只复用已修复整包，不复用首包部分回显。
 await page.reload();await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page);
 assert.equal(await page.locator('main').innerHTML(),deepLOriginal);
 await page.evaluate(()=>{globalThis.__deepLOriginalCode=document.querySelector('#deepl-slots > code');});
 await page.keyboard.press('Alt+T');const freshRendered=await assertDeepLRendered();
 assert.deepEqual(await worker.evaluate(()=>globalThis.__deepLSlotFixture.requests),firstDeepLRequests,'fresh frontend session must not reuse a partially echoed packet');
 await shot('06-deepl-slot-cache-repeat');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#deepl-slots')===0,'DeepL fresh-session exact restore');
 assert.equal(await page.locator('main').innerHTML(),deepLOriginal);
 report.deepLSlotFixture={evidenceBoundary:'Production browser/legacy DeepL adapter with synthetic /v2/translate responses in this temporary profile; no live DeepL claim.',
   requests:firstDeepLRequests,providerFetches:await worker.evaluate(()=>globalThis.__deepLSlotFixture.fetches),toggleCounts:deepLCounts,
   repairedCacheRecords:persistedPackets.length,freshSessionWrappers:freshRendered.wrappers,originalCodePreserved:freshRendered.codeUnchanged};
 assert.equal(report.deepLSlotFixture.providerFetches,2);
 report.cases.push('production legacy DeepL string-slot fixture repairs only first echo, preserves code/order, restores exact [1,0,1,0], and reuses repaired cache across fresh frontend sessions');
 assert.deepEqual(report.errors,[]);report.requests=await worker.evaluate(()=>globalThis.__identicalFixture.requests.length);report.success=true;
})().catch(async error=>{
 report.success=false;report.failure=String(error.stack||error).replaceAll(deepLFixtureKey,'[fixture credential]');process.exitCode=1;
 if(worker)report.deepLFixtureDiagnostics=await worker.evaluate(()=>{
   const fixture=globalThis.__deepLSlotFixture;
   return fixture ? {fetches:fixture.fetches,requests:fixture.requests} : null;
 }).catch(()=>null);
 if(page){report.failedFixtureOwner=await page.locator('#deepl-slots').evaluate(owner=>owner.outerHTML).catch(()=>null);await shot('failure').catch(()=>{});}
}).finally(async()=>{
 let closed=!launchAttempted;try{if(launched){await launched.close();closed=true;}}catch(error){report.cleanupError=error.message;process.exitCode=1;}
 if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 if(closed){const stat=fs.lstatSync(profileDir);assert(!stat.isSymbolicLink()&&stat.ino===identity.ino&&stat.dev===identity.dev);fs.rmSync(profileDir,{recursive:true});report.profileRemoved=true;}else report.retainedProfile=profileDir;
 fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
