/** 漫画入口专项：真实隔离浏览器、关闭普通图片/悬浮球的基线与新入口、可信手势和持久化验证。 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`);return i < 0 ? fallback : process.argv[i + 1];};
const baseline = process.argv.includes('--baseline');
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-manga-entry'));
const extension = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(arg('focus-safe-helper'));
const startupExtensionId=arg('extension-id',null);
if(startupExtensionId)assert.match(startupExtensionId,/^[a-p]{32}$/,'Use a verified unpacked extension ID');
const profile = fs.mkdtempSync('/private/tmp/fluentread-manga-entry-');
fs.mkdirSync(artifacts, {recursive: true});
const report = {suite: baseline ? 'baseline live discovery' : 'manga entry UI', profileDir:profile, cases: [], screenshots: [], consoleErrors: [], errors: [], hostErrors: []};
const hostBaselineFile=arg('host-baseline',null);
const hostBaseline=hostBaselineFile?JSON.parse(fs.readFileSync(hostBaselineFile,'utf8')):null;
if(hostBaseline)assert.ok(['read-only DOM research without extension; not extension runtime validation','read-only visible DOM research without extension','read-only background-tab DOM research without extension; not onscreen validation'].includes(hostBaseline.purpose)||(hostBaseline.purpose==='read-only active-tab DOM research with FluentRead disabled; not extension runtime validation'&&hostBaseline.activationControl?.productionExtensionDisabled===true),'Host baseline must be extension-free or explicitly disabled public DOM research');
report.hostBaselineFile=hostBaselineFile;
let launched, popup, page, worker, cdp, browserPid;
function focusGuard() {
    const app = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit');const a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier),name:ObjC.unwrap(a.localizedName)});"], {encoding: 'utf8'}));
    assert.notEqual(app.pid, browserPid);(report.focusChecks ??= []).push(app);
}
async function shadow(hostId, code) {
    const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});let host;
    function visit(node) {const attrs = node.attributes || [];for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'id' && attrs[i + 1] === hostId) host = node;for (const n of [...(node.children || []), ...(node.shadowRoots || [])]) visit(n);}
    visit(tree.root);if (!host?.shadowRoots?.[0]) return null;
    let object;
    try {({object} = await cdp.send('DOM.resolveNode', {nodeId: host.shadowRoots[0].nodeId}));}
    catch (error) {if (error.message.includes('No node with given id')) return null;throw error;}
    try {const result = await cdp.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: `function(){${code}}`, returnByValue: true});if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);return result.result.value;}
    finally {await cdp.send('Runtime.releaseObject', {objectId: object.objectId});}
}
const ball = code => shadow('fluent-read-floating-ball-container', code);
const entry = code => shadow('fluent-read-manga-entry-container', code);
async function wait(test, timeout = 20000) {const until = Date.now() + timeout;while (Date.now() < until) {if (await test()) return;await page.waitForTimeout(100);}throw new Error(`Timeout: ${report.currentCase}`);}
async function patch(config) {await popup.evaluate(async config => {
    const {value: current} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config, expected: Object.fromEntries(Object.keys(config).map(key => [key, current[key]])), clientId: 'manga-entry-test', sequence: Date.now(), baseRevision: current.__fluentConfigRevision || 0});
    if (!response.success) throw new Error(response.error);
}, config);}
async function activateVisible(target) {
    await activateExtensionTabWithoutForeground(launched.context,target);focusGuard();
    const tabId=target.url().startsWith('chrome-extension://')?await target.evaluate(async()=>{const tab=await chrome.tabs.getCurrent();if(!tab?.id)throw new Error('Owned extension tab missing');return tab.id;}):null;
    let state, matchedUrl;const deadline=Date.now()+10000;
    do {
        matchedUrl=target.url();
        state=await worker.evaluate(async ({url,tabId})=>{const tab=tabId?await chrome.tabs.get(tabId):(await chrome.tabs.query({})).find(tab=>tab.url===url);if(!tab)return null;const window=await chrome.windows.get(tab.windowId);return {active:tab.active,windowState:window.state,windowFocused:window.focused};},{url:matchedUrl,tabId});
        if(state)break;
        await target.waitForTimeout(100);
    } while(Date.now()<deadline);
    assert.ok(state,'Owned test tab must match the current exact URL within10seconds');
    state.documentVisibility=await target.evaluate(()=>document.visibilityState);
    assert.equal(state.active,true,'Actual owned browser tab must be selected');assert.equal(state.windowState,'normal');assert.equal(state.documentVisibility,'visible');
    (report.tabVisibility??=[]).push({url:matchedUrl,...state});
}
async function gotoVisible(target,url,options) {const response=await target.goto(url,options);await activateVisible(target);return response;}
async function shot(name) {await activateVisible(page);const file = path.join(artifacts, `${name}.png`);await page.screenshot({path: file});report.screenshots.push(file);}
async function clickEntry(selector) {await activateVisible(page);let point = await entry(`const b=this.querySelector(${JSON.stringify(selector)});if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width*(getComputedStyle(b).clipPath!=='none'?.25:.5),y:r.y+r.height/2}`);assert.ok(point);await page.mouse.move(point.x,point.y);await page.waitForTimeout(550);point=await entry(`const r=this.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`);await page.mouse.click(point.x, point.y);}
(async () => {
    launched = await launchFocusSafePersistentContext({chromium, profileDir: profile, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
        browserArgs: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'], viewport: {width: 1280, height: 900}, displayTarget: 'secondary', timeout: 30000});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context, system = await context.browser().newBrowserCDPSession();
    browserPid = (await system.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser').id;report.browserPid=browserPid;await system.detach();focusGuard();
    if(startupExtensionId)await context.pages()[0].goto(`chrome-extension://${startupExtensionId}/popup.html`);
    worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    popup = context.pages()[0];popup.on('pageerror',e=>report.errors.push(e.message));popup.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});await gotoVisible(popup,`chrome-extension://${id}/popup.html`);
    await patch({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, disableImageTranslator: true, disableFloatingBall: false,
        imageTranslationMangaEnabled: true, imageTranslationMangaPromptEnabled: true, imageTranslationMangaDownloadConfirmed: false, animations: false, service: 'google', from: 'en', to: 'zh-Hans'});
    page = await newPageWithoutForeground(context);page.on('pageerror', e => {
        const stack=e.stack||'';
        const reproducedWithoutExtension=hostBaseline?.pages.some(sample=>sample.requestedUrl===page.url()
            && sample.pageErrors?.some(error=>error.message===e.message));
        if(!stack.includes('chrome-extension://') && (/https?:\/\//.test(stack) || reproducedWithoutExtension))report.hostErrors.push({url:page.url(),message:e.message,stack,reproducedWithoutExtension:!!reproducedWithoutExtension});
        else report.errors.push(e.message);
    });page.on('console', m => {if(m.type()==='error' && m.location().url.startsWith('chrome-extension://'))report.consoleErrors.push(m.text());});
    cdp = await context.newCDPSession(page);
    const executionContexts=new Map();
    cdp.on('Runtime.executionContextCreated',event=>executionContexts.set(event.context.id,event.context));
    cdp.on('Runtime.exceptionThrown',event=>{
        (report.scriptExceptions??=[]).push({url:page.url(),details:event.exceptionDetails,context:executionContexts.get(event.exceptionDetails.executionContextId)});
    });
    await cdp.send('Runtime.enable');
    await gotoVisible(page,arg('site-url', 'https://mangaplus.shueisha.co.jp/viewer/1028732'), {waitUntil: 'domcontentloaded', timeout: 60000});
    await page.waitForSelector('.zao-image-container img.zao-image', {timeout: 45000});
    const reject=page.locator('#onetrust-reject-all-handler');await reject.waitFor({timeout:7000}).then(()=>reject.click()).catch(()=>undefined);
    report.readerImages = await page.locator('.zao-image-container img.zao-image').count();
    if (baseline) {
        report.currentCase = 'ordinary images disabled hides the manga entry';
        await page.waitForTimeout(1500);assert.equal(await ball("return !!this.querySelector('.floating-ball-manga')"), false);
        assert.equal(await entry('return true'), null);await shot('baseline-default-hidden');report.cases.push(report.currentCase);
        report.currentCase = 'ordinary images enabled reveals the manga button';await patch({disableImageTranslator: false});
        await wait(async () => await ball("return !!this.querySelector('.floating-ball-manga')"));await shot('baseline-image-enabled');report.cases.push(report.currentCase);
        report.currentCase = 'closing floating ball removes every manga entry';await patch({disableFloatingBall: true});
        await wait(async () => !await ball('return true'));assert.equal(await entry('return true'), null);report.cases.push(report.currentCase);
    } else {
        report.currentCase = 'manga discovered with ordinary image translation disabled';await wait(async () => await ball('return !!this.querySelector(".floating-ball-manga")'));
        assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);
        assert.equal(await ball('return this.querySelector(".manga-icon")?.tagName.toLowerCase()'), 'svg');
        assert.equal(await ball('return this.querySelector(".manga-icon")?.textContent.trim()'), '');
        const mangaButtons = await ball('return [".floating-ball-main", ".floating-ball-manga"].map(s => {const r=this.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})');
        assert.equal(mangaButtons[0].width, 32);assert.equal(mangaButtons[1].width, 32);
        assert.ok(mangaButtons.every(r => r.left >= 0 && r.left < 1280 && r.right <= 1280), 'Resident manga controls stay inside the viewport');
        report.mangaButtons = mangaButtons;
        const order=await ball('return [...this.querySelectorAll(".floating-ball-item")].map(e=>e.className)');
        assert.ok(order[0].includes('floating-ball-translate') && order[1].includes('floating-ball-main') && order[2].includes('floating-ball-manga'));
        assert.equal(await ball('return this.querySelector(".floating-ball-main").textContent.trim()'), '');
        assert.ok(await ball('return !!this.querySelector(".floating-ball-mascot image")?.getAttribute("href")'));
        const brandShape = await ball('const b=this.querySelector(".floating-ball-main"),r=b.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(b).borderRadius}');
        assert.equal(brandShape.width,brandShape.height);assert.equal(brandShape.radius,'50%');report.brandShape=brandShape;
        await page.mouse.move(30,30);await page.waitForTimeout(2800);await page.keyboard.press('Escape');
        assert.equal(await ball('return this.querySelector(".fr-floating-ball").classList.contains("floating-ball-expanded")'),true);
        const brandShot=path.join(artifacts,'brand-resident.png');focusGuard();await page.screenshot({path:brandShot,clip:{x:1120,y:250,width:160,height:350}});report.screenshots.push(brandShot);
        await shot('entry-initial');report.cases.push(report.currentCase);
        report.currentCase = 'manga entry remains after closing floating ball';await patch({disableFloatingBall: true});
        await wait(async () => !await ball('return true'));await wait(async()=>await entry('return !!this.querySelector(".fr-manga-launcher")'));
        assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);report.cases.push(report.currentCase);
        report.currentCase = 'first use explains downloads before any model download';await clickEntry('.fr-manga-launcher');
        await wait(async () => await entry('return this.textContent.includes("首次使用，先准备阅读资源")'));
        assert.ok(await entry('return this.textContent.includes("30 MB") && this.textContent.includes("197 MB")'));
        report.modelStatusBeforeConsent=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));
        assert.equal(report.modelStatusBeforeConsent.bytes,0);assert.equal(report.modelStatusBeforeConsent.ready,false);
        assert.ok(!report.modelStatusBeforeConsent.download);
        await shot('entry-first-use');report.cases.push(report.currentCase);
        report.currentCase = 'dismiss first-use confirmation never opens it again automatically';await clickEntry('.fr-manga-close');
        assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'), false);await page.reload({waitUntil: 'domcontentloaded'});
        await wait(async () => await entry('return !!this.querySelector(".fr-manga-launcher")'));
        assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);report.cases.push(report.currentCase);
        report.currentCase = 'disable standalone button persists across visit and ordinary config changes';await patch({imageTranslationMangaPromptEnabled:false});
        await wait(async () => await entry('return !this.querySelector(".fr-manga-launcher")'));await page.reload({waitUntil: 'domcontentloaded'});
        await page.waitForTimeout(1200);assert.equal(await entry('return !!this.querySelector(".fr-manga-launcher")'), false);
        await patch({from: 'auto'});await page.waitForTimeout(300);assert.equal(await entry('return !!this.querySelector(".fr-manga-launcher")'), false);report.cases.push(report.currentCase);
        report.currentCase = 'settings restore prompt through the actual switch';
        await gotoVisible(popup,`chrome-extension://${id}/options.html#settings-image-translation`);
        const switchPrompt=popup.getByRole('switch',{name:'独立漫画按钮',exact:true});await switchPrompt.waitFor({state:'attached'});
        await popup.locator('.el-switch').filter({has:switchPrompt}).waitFor();
        assert.equal(await switchPrompt.getAttribute('aria-checked'),'false');
        await popup.locator('.el-switch').filter({has:switchPrompt}).click();
        await wait(async () => await entry('return !!this.querySelector(".fr-manga-launcher")'));assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);report.cases.push(report.currentCase);
        report.currentCase = 'unified settings show switches, resources and searchable reader list directly';
        assert.ok(await popup.getByRole('heading',{name:'图片/漫画翻译',exact:true}).count());
        assert.ok(await popup.locator('[data-testid=manga-settings]').isVisible());
        assert.equal(await popup.locator('#settings-image-translation .settings-page-panel').count(),0);
        assert.equal(await popup.locator('[role=tab]').count(),0);
        assert.equal(await popup.locator('.manga-model-settings').count(),1);
        assert.equal(await popup.locator('[data-testid=ocr-language-manager]:visible').count(),1);
        const settingsShot=path.join(artifacts,'settings-manga.png');focusGuard();await popup.screenshot({path:settingsShot});report.screenshots.push(settingsShot);report.cases.push(report.currentCase);
        report.currentCase='custom site rule validates selector and persists on reopen';
        const search=popup.getByRole('searchbox',{name:'搜索网站名称或域名',exact:true});
        assert.equal(await popup.locator('.manga-site-list .manga-site').count(),235);
        await search.fill('Uzaki');assert.equal(await popup.locator('.manga-site-list .manga-site').count(),1);
        assert.ok((await popup.locator('.manga-site-list').innerText()).includes('uzakichanmanga.com'));
        await search.fill('comic-days');assert.ok((await popup.locator('.manga-site-list').innerText()).includes('圈选翻译'));
        await search.fill('');await popup.getByText('添加其他漫画网站',{exact:true}).click();
        await popup.getByLabel('阅读页或阅读路径',{exact:true}).fill('https://comic.example.test/reader/');
        await popup.getByLabel('漫画图片选择器',{exact:true}).fill('[');await popup.getByRole('button',{name:'添加网站',exact:true}).click();
        await popup.getByRole('alert').filter({hasText:'图片选择器无效'}).waitFor();
        await popup.getByLabel('漫画图片选择器',{exact:true}).fill('main img');await popup.getByRole('button',{name:'添加网站',exact:true}).click();
        await popup.locator('.manga-custom-site').filter({hasText:'comic.example.test'}).waitFor();await popup.reload();
        await popup.getByText('添加其他漫画网站',{exact:true}).click();assert.equal(await popup.locator('.manga-custom-site').count(),1);report.cases.push(report.currentCase);
        report.currentCase='custom reader is discovered with both ordinary image and floating button off';
        await context.route('https://comic.example.test/reader/1',route=>route.fulfill({contentType:'text/html',body:'<html><body><main><img width="400" height="800"></main></body></html>'}));
        await gotoVisible(page,'https://comic.example.test/reader/1');await wait(async()=>await entry('return !!this.querySelector(".fr-manga-launcher")'));assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);
        await shot('custom-reader-entry');report.cases.push(report.currentCase);
        report.currentCase='first download prompt fits narrow viewport and dark theme';
        await page.setViewportSize({width:320,height:550});await page.emulateMedia({colorScheme:'dark'});await clickEntry('.fr-manga-launcher');
        await wait(async()=>await entry('return this.textContent.includes("首次使用，先准备阅读资源")'));
        const bounds=await entry('const r=this.querySelector(".fr-manga-entry").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}');
        assert.ok(bounds.left>=0 && bounds.right<=320 && bounds.top>=0 && bounds.bottom<=550);await shot('entry-first-use-dark-narrow');report.cases.push(report.currentCase);
        await gotoVisible(popup,`chrome-extension://${id}/popup.html`);
        report.currentCase='icon and first-use actions work in English and all UI locales';
        await patch({uiLanguage:'en-US',disableFloatingBall:false});
        await wait(async()=>await entry('return this.querySelector(".fr-manga-primary")?.textContent.trim() === "Prepare resources and start"'));
        await wait(async()=>await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-label") === "Manga translation"'));
        assert.equal(await ball('return this.querySelector(".manga-icon")?.textContent.trim()'), '');
        const unobstructed=await entry('const r=this.querySelector(".fr-manga-entry").getBoundingClientRect();return document.elementFromPoint(r.right-22,r.top+r.height/2)?.id === "fluent-read-manga-entry-container"');
        assert.equal(unobstructed,true);
        await shot('entry-first-use-english');
        for(const [locale,title] of [['ja-JP','リソースを準備して開始'],['ko-KR','리소스 준비 후 시작'],['fr-FR','Préparer et commencer'],['ru-RU','Подготовить и начать'],['es-ES','Preparar y comenzar']]){
            await patch({uiLanguage:locale});
            await wait(async()=>await entry(`return this.querySelector(".fr-manga-primary")?.textContent.trim() === ${JSON.stringify(title)}`));
        }
        report.cases.push(report.currentCase);
        report.currentCase = 'ordinary pages keep resident brand and translation controls; explicit hover remains available';
        for (const [sourceLanguage, label, size] of [['ru', 'Russian and English', '16 MB'], ['ko', 'Korean and English', '13 MB']]) {
            report.currentCase = `${sourceLanguage} first-use consent follows the source language and does not download on inspection`;
            await patch({from: sourceLanguage, uiLanguage: 'en-US'});
            await wait(async () => await entry('return !this.querySelector(".fr-manga-entry")'));
            const point = await ball('const r=this.querySelector(".floating-ball-manga").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}');
            await page.mouse.click(point.x, point.y);
            await wait(async () => await entry(`return this.querySelector(".fr-manga-entry p")?.textContent.includes(${JSON.stringify(label)})`));
            assert.equal(await entry(`return this.querySelector(".fr-manga-entry p").textContent.includes(${JSON.stringify(size)})`), true);
            const status = await popup.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadImageOcrStatus'}));
            assert.deepEqual(status.languages, []);
            assert.equal(await popup.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value.imageTranslationMangaDownloadConfirmed), false);
            await shot(`entry-first-use-${sourceLanguage}`);report.cases.push(report.currentCase);
        }
        const blankImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="white"/></svg>');
        for(const [site,url,label,size,reader] of [
            ['MangaLib','https://mangalib.me/ru/1--fluentread-fixture/read/v1/c1','Russian and English','16 MB','<div data-reader-mode="vertical"><main data-reader-info-visible="true"><div><div data-page="1">IMAGE</div></div></main></div>'],
            ['Mangahub','https://mangahub.ru/read/123','Russian and English','16 MB','<reader-viewer><reader-scan class="reader-viewer-scan">IMAGE</reader-scan></reader-viewer>'],
            ['ComicNaver','https://comic.naver.com/webtoon/detail?titleId=855297&no=1','Korean and English','13 MB','<div id="sectionContWide">IMAGE</div>'],
        ]){
            report.currentCase=`auto source consent: ${site} local reader fixture`;
            await context.route(url,route=>route.fulfill({contentType:'text/html',body:`<html><body>${reader.replace('IMAGE',`<img id="content_image_0" class="reader-viewer-img" src="${blankImage}">`)}</body></html>`}));
            await patch({from:'auto',uiLanguage:'en-US',disableFloatingBall:true});await gotoVisible(page,url);
            await wait(async()=>await entry('return !!this.querySelector(".fr-manga-launcher")'));await clickEntry('.fr-manga-launcher');
            await wait(async()=>await entry(`return this.querySelector(".fr-manga-entry p")?.textContent.includes(${JSON.stringify(label)})`));
            assert.equal(await entry(`return this.querySelector(".fr-manga-entry p").textContent.includes(${JSON.stringify(size)})`),true);
            const status=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadImageOcrStatus'}));assert.deepEqual(status.languages,[]);
            const current=await popup.evaluate(async()=>(await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'})).value);
            assert.equal(current.from,'auto');assert.equal(current.imageTranslationMangaDownloadConfirmed,false);
            await shot(`entry-auto-${site.toLowerCase()}`);report.cases.push(report.currentCase);
        }
        await patch({from: 'en',disableFloatingBall:false});
        report.currentCase = 'ordinary pages keep resident brand and translation controls; explicit hover remains available';
        await page.setViewportSize({width:1280,height:900});
        await context.route('https://ordinary.example.test/article', route => route.fulfill({contentType:'text/html',body:'<html><body><p>Ordinary reading page</p></body></html>'}));
        await page.mouse.move(30,30);await gotoVisible(page,'https://ordinary.example.test/article');
        await wait(async () => await ball('return !!this.querySelector(".floating-ball-main")'));
        assert.equal(await ball('return this.querySelector(".floating-ball-manga") !== null'), false);
        assert.equal(await ball('return this.querySelector(".floating-ball-main").textContent.trim()'), '');
        assert.equal(await ball('return this.querySelector(".floating-ball-main").getBoundingClientRect().width'),40);
        const docked = await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}');
        assert.ok(docked.right<=1280 && docked.left>=0, 'Default brand stays fully visible');
        await page.mouse.move(30,30);await page.waitForTimeout(2800);await page.keyboard.press('Escape');
        assert.equal(await ball('return this.querySelector(".fr-floating-ball").classList.contains("floating-ball-expanded")'),true);
        await shot('brand-resident-ordinary');
        await patch({floatingBallToolsDisplay:'hover'});
        await wait(async()=>await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return !this.querySelector(".fr-floating-ball").classList.contains("floating-ball-expanded") && r.right>1280 && r.left<1280'));
        const hidden=await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}');
        assert.ok(hidden.right>1280 && hidden.left<1280, 'Opt-in hover preserves docking');
        await page.mouse.move(1278,(hidden.top+hidden.bottom)/2);
        await wait(async () => await ball('return this.querySelector(".floating-ball-main").getBoundingClientRect().right <= 1280'));
        await patch({floatingBallToolsDisplay:'always'});report.ordinaryDocking={resident:docked,hover:hidden};report.cases.push(report.currentCase);
        report.currentCase = 'resident brand can be dragged to either edge and stays inside narrow screens';
        let mainPoint=await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}');
        await page.mouse.move(mainPoint.x,mainPoint.y);await page.mouse.down();await page.mouse.move(50,250,{steps:8});await page.mouse.up();
        await wait(async()=>await ball('return this.querySelector(".fr-floating-ball").dataset.position === "left"'));
        let dragBounds=await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top}');assert.ok(dragBounds.left>=0 && dragBounds.right<=1280);
        mainPoint=await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}');
        await page.mouse.move(mainPoint.x,mainPoint.y);await page.mouse.down();await page.mouse.move(1230,450,{steps:8});await page.mouse.up();
        await wait(async()=>await ball('return this.querySelector(".fr-floating-ball").dataset.position === "right"'));
        await page.setViewportSize({width:320,height:550});await page.waitForTimeout(400);
        dragBounds=await ball('const r=this.querySelector(".floating-ball-main").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}');
        assert.ok(dragBounds.left>=0 && dragBounds.right<=320 && dragBounds.top>=0 && dragBounds.bottom<=550);await shot('brand-narrow-dragged');
        await page.setViewportSize({width:1280,height:900});report.cases.push(report.currentCase);
        report.currentCase = 'confirm closes immediately and continuous mode can pause without a dialog';
        await patch({uiLanguage:'zh-CN'});await gotoVisible(page,'https://comic.example.test/reader/1');
        await wait(async () => await ball('return !!this.querySelector(".floating-ball-manga")'));
        const clickBall=async()=>{const p=await ball('const r=this.querySelector(".floating-ball-manga").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}');await page.mouse.click(p.x,p.y);};
        await clickBall();await wait(async()=>await entry('return !!this.querySelector(".fr-manga-primary")'));
        await clickEntry('.fr-manga-primary');
        await wait(async()=>await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-pressed") === "true"'));
        assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);
        const acknowledged=await popup.evaluate(async()=>{const c=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});return c.value.imageTranslationMangaDownloadConfirmed;});
        assert.equal(acknowledged,true);await clickBall();
        await wait(async()=>await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-pressed") === "false"'));
        assert.equal(await entry('return !!this.querySelector(".fr-manga-entry")'),false);report.cases.push(report.currentCase);
        report.currentCase = 'canvas reader offers area translation without downloading continuous manga models';
        await context.route('https://comic-days.com/episode/10834108156634732370',route=>route.fulfill({contentType:'text/html',body:'<html><body><div class="page-area"><canvas class="js-page-image" width="688" height="1024" style="width:600px;height:850px"></canvas></div><div class="link-page-content"><img width="600" height="850"></div></body></html>'}));
        await patch({selectionAreaEnabled:false});await gotoVisible(page,'https://comic-days.com/episode/10834108156634732370');
        await wait(async()=>await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-label") === "圈选漫画翻译"'));
        const areaClick=async()=>{const p=await ball('const r=this.querySelector(".floating-ball-manga").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}');await page.mouse.click(p.x,p.y);};
        await areaClick();await wait(async()=>await entry('return this.textContent.includes("请在图片/漫画设置中启用圈选翻译")'));
        assert.equal(await entry('return this.textContent.includes("首次使用，先准备阅读资源")'),false);
        await clickEntry('.fr-manga-close');await patch({selectionAreaEnabled:true});
        await page.waitForTimeout(700);await areaClick();
        await wait(async()=>await shadow('fluent-read-area-translator-container','return !!this.querySelector(".fr-area-selecting")'));
        await shot('canvas-area-selection');await page.keyboard.press('Escape');report.cases.push(report.currentCase);
        const liveReadersFile=arg('reader-sites',null);
        if(liveReadersFile){
            for(const sample of JSON.parse(fs.readFileSync(liveReadersFile,'utf8'))){
                report.currentCase=`live reader discovery: ${sample.url}`;
                if(sample.sourceConsentLabel)await patch({from:'auto',imageTranslationMangaDownloadConfirmed:false});
                const response=await gotoVisible(page,sample.url,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(3000);focusGuard();
                const result={url:sample.url,finalUrl:page.url(),status:response?.status(),mode:sample.mode};
                (report.liveReaders??=[]).push(result);
                if(response?.status()!==200 || sample.verifyNoReaderEntry && sample.expectedStatus===200){
                    result.result='access-restricted';
                    if(sample.verifyNoReaderEntry){
                        const expectedStatus=sample.expectedStatus ?? 403;
                        assert.ok([200,403].includes(expectedStatus),'No-entry proof requires an explicit observed 200 gate or 403 boundary');
                        assert.equal(response?.status(),expectedStatus,'Restricted-reader sample must retain its observed HTTP boundary');
                        if(expectedStatus===200){
                            assert.ok(typeof sample.noReaderGateSelector==='string' && sample.noReaderGateSelector.trim(),'HTTP 200 no-entry proof requires an explicit visible login or paywall marker');
                            await page.locator(sample.noReaderGateSelector).waitFor({state:'visible',timeout:10000});
                            result.noReaderGate={selector:sample.noReaderGateSelector,visible:true};
                            result.result='visible-gate-no-reader';
                        }
                        assert.equal(Boolean(await ball('return !!this.querySelector(".floating-ball-manga")')),false);
                        assert.equal(Boolean(await entry('return !!this.querySelector(".fr-manga-launcher")')),false);
                        result.readerEntryAbsent=true;report.cases.push(`${expectedStatus} page has no manga entry: ${sample.url}`);
                        continue;
                    }
                    throw new Error(`Public reader access failed: HTTP ${response?.status() ?? 'unavailable'}`);
                }
                if(sample.rejectCookies) {const reject=page.locator('#onetrust-reject-all-handler');await reject.waitFor({timeout:8000}).then(()=>reject.click()).catch(()=>undefined);}
                if(sample.openSelector) {
                    const opener=sample.openFrameSelector?page.frameLocator(sample.openFrameSelector).locator(sample.openSelector):page.locator(sample.openSelector);
                    if(!sample.openIfVisible || await opener.isVisible())await opener.click({timeout:10000});
                }
                if(sample.afterOpenSelector){
                    if(sample.afterOpenReadySelector)await page.locator(sample.afterOpenReadySelector).waitFor({state:'visible',timeout:20000});
                    const position=sample.afterOpenPosition;
                    assert.ok(!position||(Number.isInteger(position.x)&&Number.isInteger(position.y)&&position.x>=0&&position.y>=0&&position.x<=4096&&position.y<=4096),'Public control position must be bounded integer coordinates');
                    await page.locator(sample.afterOpenSelector).click({timeout:15000,position});
                }
                if(sample.pageKey)for(let turn=0;turn<(sample.pageKeyTurns||1);turn++)await page.keyboard.press(sample.pageKey);
                if(sample.readerSettleMs !== undefined){
                    assert.ok(Number.isInteger(sample.readerSettleMs)&&sample.readerSettleMs>=0&&sample.readerSettleMs<=30000,'Public reader settling time must be 0–30000ms');
                    await page.waitForTimeout(sample.readerSettleMs);
                }
                if(sample.readerScrollSelector)await page.locator(sample.readerScrollSelector).scrollIntoViewIfNeeded({timeout:15000});
                result.finalUrl=page.url();
                if(sample.readerReadySelector){
                    const minimum=sample.readerMinimumNaturalSize||{width:80,height:40};
                    assert.ok(['width','height'].every(key=>Number.isInteger(minimum[key])&&minimum[key]>=1&&minimum[key]<=16384),'Reader natural-size threshold must be bounded positive integers');
                    try {
                        await page.waitForFunction(({selector,minimum})=>[...document.querySelectorAll(selector)].some(i=>i.tagName==='IMG'&&i.complete&&i.naturalWidth>=minimum.width&&i.naturalHeight>=minimum.height),{selector:sample.readerReadySelector,minimum},{timeout:20000});
                    } catch (error) {
                        result.result='body-not-ready';
                        result.readerReadiness=await page.locator(sample.readerReadySelector).evaluateAll(elements=>elements.map(i=>({tag:i.tagName,complete:i.complete,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight})));
                        throw error;
                    }
                }
                await wait(async()=>await ball(`return this.querySelector(".floating-ball-manga")?.getAttribute("aria-label") === ${JSON.stringify(sample.mode==='area'?'圈选漫画翻译':'漫画翻译')}`));
                if(sample.mode==='canvas')assert.ok(await page.locator(sample.canvasSelector || '#comici-viewer .-cv-page-canvas canvas').count());
                if(sample.readerSelector) {
                    result.readerPages=await page.locator(sample.readerSelector).evaluateAll(elements=>elements.map(e=>{
                        const rect=e.getBoundingClientRect();return {tag:e.tagName,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,width:e.width,height:e.height,
                            visible:rect.width>0&&rect.height>0&&rect.left<innerWidth&&rect.right>0&&rect.top<innerHeight&&rect.bottom>0};
                    }));
                    assert.ok(result.readerPages.length,'Exact body container is present');
                }
                if(sample.verifyReadableCanvas){
                    assert.ok(sample.canvasSelector,'Readable canvas proof requires the exact body selector');
                    result.canvasPixels=await page.locator(sample.canvasSelector).evaluateAll(elements=>elements.filter(canvas=>canvas.width>0&&canvas.height>0).map(canvas=>{
                        const context=canvas.getContext('2d');let readable=false,gridNonblank=false,pixelError='';
                        try{if(context){for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(context.getImageData(Math.floor((x+.5)*canvas.width/8),Math.floor((y+.5)*canvas.height/8),1,1).data.some(value=>value>0))gridNonblank=true;readable=true;}}
                        catch(error){pixelError=error.name;}
                        return {width:canvas.width,height:canvas.height,readable,gridNonblank,pixelError};
                    }));
                    assert.ok(result.canvasPixels.some(canvas=>canvas.readable&&canvas.gridNonblank),'At least one exact body canvas has public readable nonblank pixels');
                }
                if(sample.mode==='area' && sample.verifyAreaEntry){
                    const before=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));
                    await areaClick();await wait(async()=>await shadow('fluent-read-area-translator-container','return !!this.querySelector(".fr-area-selecting")'));
                    const languages=(await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadImageOcrStatus'}))).languages;
                    const after=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));
                    assert.deepEqual(languages,[]);assert.equal(after.ready,before.ready);assert.equal(after.inpaintingReady,before.inpaintingReady);
                    await page.keyboard.press('Escape');await wait(async()=>!await shadow('fluent-read-area-translator-container','return !!this.querySelector(".fr-area-selecting")'));
                    result.areaEntry={selectionEntered:true,cancelledWithEscape:true,languagePacks:languages,mangaModelsReadyUnchanged:true,scope:'Selection overlay only; no rectangle capture, image export or OCR'};
                }
                if(sample.sourceConsentLabel){
                    await clickBall();await wait(async()=>await entry(`return this.querySelector(".fr-manga-entry p")?.textContent.includes(${JSON.stringify(sample.sourceConsentLabel)})`));
                    const description=await entry('return this.querySelector(".fr-manga-entry p").textContent');
                    assert.ok(description.includes(sample.sourceConsentSize));
                    const languages=(await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadImageOcrStatus'}))).languages;
                    assert.deepEqual(languages,[]);
                    const current=await popup.evaluate(async()=>(await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'})).value);
                    assert.equal(current.from,'auto');assert.equal(current.imageTranslationMangaDownloadConfirmed,false);
                    result.sourceConsent={from:current.from,description,languages,downloadConfirmed:false};
                }
                await shot(`live-reader-${report.liveReaders.length}`);
                result.result='reader-entry-confirmed';report.cases.push(report.currentCase);
            }
        }
        report.currentCase = 'master switch removes manga UI';
        await patch({on: false});await wait(async () => !await entry('return true'));assert.equal(await ball('return true'),null);report.cases.push(report.currentCase);
    }
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status = 'passed';
})().catch(async e => {report.status = 'failed';report.failure = e.stack;process.exitCode = 1;if(popup){report.popupText=await popup.locator('body').innerText().catch(()=>null);await popup.screenshot({path:path.join(artifacts,'failed-popup.png')}).catch(()=>{});}if(page)await page.screenshot({path:path.join(artifacts,'failed-reader.png')}).catch(()=>{});}).finally(async () => {
    if (launched) await launched.close().catch(() => {});
    fs.rmSync(profile, {recursive: true, force: true});report.profileRemoved = !fs.existsSync(profile);
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
});
