'use strict';
/** 图片识别设置专项：生产扩展、独立临时 Chrome、真实选择与快速关闭；检查模型选择持久化、资源按需挂载、紧凑层级和窄屏深色布局。 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i<0?fallback:process.argv[i+1];};
const {chromium}=require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext,newPageWithoutForeground}=require(arg('focus-safe-helper'));
const extensionDir=path.resolve(arg('extension-dir','.output/chrome-mv3'));
const artifacts=path.resolve(arg('artifacts-dir','/private/tmp/fluentread-image-recognition-settings'));
const profile=fs.mkdtempSync('/private/tmp/fluentread-image-settings-profile-');fs.mkdirSync(artifacts,{recursive:true});
const report={suite:'image recognition settings',cases:[],screenshots:[],consoleErrors:[],errors:[],modelRequests:[]};
let launched,page,control,worker,browserPid;
function focusGuard(){const app=JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',"ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)});"],{encoding:'utf8'}));assert.notEqual(app.pid,browserPid);(report.focusChecks??=[]).push(app);}
async function read(){return control.evaluate(async()=>{const {value}=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});return {engine:value.imageTranslationOcrEngine,prefetch:value.imageTranslationMangaPrefetchPages,manga:value.imageTranslationMangaEnabled,language:value.uiLanguage};});}
async function patch(config){await control.evaluate(async config=>{const {value}=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const result=await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config,expected:Object.fromEntries(Object.keys(config).map(k=>[k,value[k]])),clientId:'image-recognition-settings-test',sequence:Date.now(),baseRevision:value.__fluentConfigRevision||0});if(!result.success)throw Error(result.error);},config);}
async function wait(test,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,100));}throw Error(`Timeout: ${report.currentCase}`);}
async function shot(name){focusGuard();const file=path.join(artifacts,`${name}.png`);await page.screenshot({path:file});report.screenshots.push(file);}
const current=name=>report.currentCase=name;
(async()=>{
    launched=await launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:arg('browser-path','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),background:true,headless:false,browserArgs:['--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost,false);assert.equal(report.windowPlacement.mode,'background-visible-no-focus');
    const context=launched.context,system=await context.browser().newBrowserCDPSession();
    browserPid=(await system.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
    const {id}=await system.send('Extensions.loadUnpacked',{path:extensionDir});await system.detach();focusGuard();
    worker=context.serviceWorkers().find(w=>w.url().startsWith(`chrome-extension://${id}/`))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith(`chrome-extension://${id}/`)});
    context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});});
    context.on('request',r=>{if(/^https:\/\/(huggingface.co|hf-mirror.net)\//.test(r.url()))report.modelRequests.push(r.url());});
    control=context.pages()[0];await control.goto(`chrome-extension://${id}/popup.html`);
    await patch({uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,imageTranslationOcrEngine:'tesseract',disableImageTranslator:false,imageTranslationMangaEnabled:true,imageTranslationMangaPrefetchPages:3,theme:'light'});
    const url=`chrome-extension://${id}/options.html#settings-image-translation`;
    page=await newPageWithoutForeground(context);await page.goto(url);await page.getByRole('combobox',{name:'图片识别方式',exact:true}).waitFor();
    current('essential choices are visible, cache and resource controls are collapsed');
    const section=page.locator('#settings-image-translation');
    assert.equal(await section.getByRole('combobox').count(),5);
    assert.equal(await section.locator('.manga-advanced').getAttribute('open'),null);
    assert.equal(await section.locator('[data-testid="manga-model-manager"]').count(),0);
    assert.equal(await section.locator('[data-testid="ocr-language-manager"]').count(),1);
    report.desktop=await section.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,headings:[...e.querySelectorAll('h2')].map(n=>n.textContent)}));
    report.cases.push(report.currentCase);await shot('settings-essential');
    current('choosing PaddleOCR survives immediately closing and reopening options');
    const choice=page.getByRole('combobox',{name:'图片识别方式',exact:true});await choice.locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click();await page.getByRole('option',{name:'PaddleOCR（标准模型）',exact:true}).click();await page.close();
    await wait(async()=>(await read()).engine==='paddle');
    page=await newPageWithoutForeground(context);await page.goto(url);await page.getByRole('combobox',{name:'图片识别方式',exact:true}).waitFor();
    assert.match(await page.locator('.image-recognition-settings').textContent(),/PaddleOCR/);report.quickClose=await read();report.cases.push(report.currentCase);
    current('recognition selection explains shared first-use resources without downloading them');
    assert.match(await page.locator('.image-recognition-settings .settings-item-copy small').first().textContent(),/30 MB.*共用/);assert.deepEqual(report.modelRequests,[]);report.cases.push(report.currentCase);
    current('with manga off, resources show PaddleOCR without the unrelated repair model');
    await page.getByRole('switch',{name:'漫画连续翻译',exact:true}).evaluate(element => element.click());await wait(async()=>(await read()).manga===false);
    await page.locator('[data-testid="manga-model-manager"]').waitFor();
    assert.equal(await page.locator('.manga-resource').count(),1);assert.equal(await page.locator('.image-ocr-source').count(),0);report.cases.push(report.currentCase);await shot('settings-resources');
    current('the existing upcoming-page setting still saves through its normal UI');
    await page.getByRole('switch',{name:'漫画连续翻译',exact:true}).evaluate(element => element.click());
    await page.getByRole('combobox',{name:'提前翻译后续页面',exact:true}).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click();await page.getByRole('option',{name:'只翻译当前页面',exact:true}).click();await wait(async()=>(await read()).prefetch===0);report.cases.push(report.currentCase);
    current('English labels describe recognition rather than model speed');
    await patch({uiLanguage:'en-US'});await page.getByRole('combobox',{name:'Image text recognition',exact:true}).waitFor();
    assert.match(await page.locator('.image-recognition-settings .settings-item-copy small').first().textContent(),/30 MB/);assert.doesNotMatch(await page.locator('.image-recognition-settings').textContent(),/[\u4e00-\u9fff]/);report.cases.push(report.currentCase);await shot('settings-english');
    current('narrow dark settings keep primary fields usable without horizontal scrolling');
    await patch({theme:'dark'});await page.setViewportSize({width:390,height:900});await page.waitForTimeout(400);
    report.narrow=await page.locator('#settings-image-translation').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,fields:[...e.querySelectorAll('input')].filter(i=>i.getBoundingClientRect().width>0).map(i=>({width:i.getBoundingClientRect().width,left:i.getBoundingClientRect().left,right:i.getBoundingClientRect().right}))}));
    assert.ok(report.narrow.scrollWidth<=report.narrow.width+1);assert.ok(report.narrow.fields.every(r=>r.left>=0&&r.right<=390&&r.width>70));report.cases.push(report.currentCase);await shot('settings-narrow-dark');
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';
})().catch(async error=>{report.status='failed';report.failure=error.stack;process.exitCode=1;if(page&&!page.isClosed())await shot('failure').catch(()=>{});}).finally(async()=>{
    await launched?.close().catch(()=>{});fs.rmSync(profile,{recursive:true,force:true});report.profileRemoved=!fs.existsSync(profile);
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases,failure:report.failure,report:path.join(artifacts,'report.json')},null,2));
});
