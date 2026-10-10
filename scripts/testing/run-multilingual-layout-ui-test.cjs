#!/usr/bin/env node
// 多语言界面布局专项：临时后台 Edge、完整标签与横向边界；不调用供应商、不操作用户浏览器。
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(path.join((()=>{const i=process.argv.indexOf('--playwright-root');assert(i>=0,'--playwright-root is required');return process.argv[i+1]})(),'playwright'));
const {launchFocusSafePersistentContext,newPageWithoutForeground}=require((()=>{const i=process.argv.indexOf('--focus-safe-helper');return i<0?path.join(__dirname, 'focus-safe-browser.cjs'):path.resolve(process.argv[i+1])})());
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1]};
const root=process.cwd(),out=path.resolve(arg('artifacts-dir','/private/tmp/fluentread-multilingual-ui'));fs.mkdirSync(out,{recursive:true});
const extensionDir=path.resolve(arg('extension-dir','.output/chrome-mv3'));
const taglines=require(path.join(root,'src/core/i18n/messages/brand-taglines.json'));
const messages={
 'zh-CN':['翻译当前网页','文件队列'], 'en-US':['Translate this page','File queue'], 'ja-JP':['このページを翻訳','ファイル一覧'], 'ko-KR':['이 페이지 번역','파일 목록'], 'fr-FR':['Traduire cette page','File de documents'], 'ru-RU':['Перевести эту страницу','Очередь файлов'], 'es-ES':['Traducir esta página','Cola de archivos']
};
const languages=['zh-CN','en-US','ja-JP','ko-KR','fr-FR','ru-RU','es-ES'];let seq=0,session;const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-layout-'));
const report={ok:false,extensionDir,views:[],errors:[],evidenceBoundary:'Production extension, seven UI languages, all settings sections at 1280/390px, popup and drawers, document landing/workspace/editing. No external translation service, logged-in page or Firefox runtime is covered.'};
async function audit(page,label){
 const data=await page.evaluate(()=>{
  const issues=[];const root=[...document.querySelectorAll('.el-drawer')].find(el=>el.checkVisibility({visibilityProperty:true}))||document.querySelector('.popup-shell,.settings-app,.document-page,.document-app')||document.body;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
   const node=walker.currentNode,el=node.parentElement,text=node.textContent.trim().replace(/\s+/g,' ');
   if(!text||text.length<2||!el.checkVisibility({visibilityProperty:true,opacityProperty:true})||el.closest('.settings-content-title,.visually-hidden,.el-select__input-calculator,textarea,pre,code,[contenteditable],.reader-content,.markdown-body,[data-reading-answer]'))continue;
   const range=document.createRange();range.selectNodeContents(node);const rects=Array.from(range.getClientRects());if(!rects.length)continue;
   let clipX=false,clipY=false,scrollX=false,scrollY=false,decorative=false;for(let anc=el;anc&&anc!==root.parentElement;anc=anc.parentElement){
    const st=getComputedStyle(anc),r=anc.getBoundingClientRect();if(st.clipPath!=='none'||st.clip!=='auto'||anc.clientWidth<=1){decorative=true;break;}
    scrollX ||= ['auto','scroll'].includes(st.overflowX); scrollY ||= ['auto','scroll'].includes(st.overflowY);
    if(!scrollX&&['hidden','clip'].includes(st.overflowX)&&rects.some(t=>t.right>r.left+anc.clientLeft+anc.clientWidth+2||t.left<r.left+anc.clientLeft-2))clipX=true;
    if(!scrollY&&anc!==root&&!['settings-app','workspace','el-drawer__body'].some(c=>anc.classList.contains(c))&&['hidden','clip'].includes(st.overflowY)&&rects.some(t=>t.bottom>r.top+anc.clientTop+anc.clientHeight+3||t.top<r.top+anc.clientTop-3))clipY=true;
   }
   if(!decorative&&(clipX||clipY))issues.push({tag:el.tagName,css:el.className,text:text.slice(0,140),clipX,clipY,width:Math.round(el.getBoundingClientRect().width)});
  }
  return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,rootOverflow:root.scrollWidth>root.clientWidth+1,issues};
 });report.views.push({label,...data});
 if(label.startsWith('en-US')||/^(zh-CN|fr-FR|ru-RU)-popup$/.test(label))await page.screenshot({path:path.join(out,label+'.png'),fullPage:true,animations:'disabled'});
}
(async()=>{let primaryError, launchAttempted = false;try{
 const ext=extensionDir;launchAttempted = true;session=await launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,displayTarget:'secondary',browserArgs:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
 guardBrowserClose(session, profile);
 const ctx=session.context,worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
 const options=await newPageWithoutForeground(ctx);options.on('pageerror',e=>report.errors.push(e.message));await options.goto(`chrome-extension://${id}/options.html`);await options.locator('.settings-app').waitFor();
 async function patch(config,expected){const r=await options.evaluate(async payload=>chrome.runtime.sendMessage(payload),{type:'persistConfig',mode:'patch',config,expected,clientId:'multilingual-layout-audit',sequence:++seq});assert.equal(r.success,true);}
 await patch({uiLanguageSetupCompleted:true},{uiLanguageSetupCompleted:false});
 const popup=await newPageWithoutForeground(ctx);popup.on('pageerror',e=>report.errors.push(e.message));await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('[data-config-ready="true"]').waitFor();
 const sections=await options.locator('button[data-section]').evaluateAll(els=>els.map(el=>el.dataset.section));
 const doc=await newPageWithoutForeground(ctx);doc.on('pageerror',e=>report.errors.push(e.message));await doc.goto(`chrome-extension://${id}/document.html`);await doc.waitForTimeout(300);
 const workspace=await newPageWithoutForeground(ctx);workspace.on('pageerror',e=>report.errors.push(e.message));await workspace.goto(`chrome-extension://${id}/document.html`);
 await workspace.locator('input[type=file]').setInputFiles({name:'layout-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('A multilingual workspace.\n\nKeep the original document readable.')});await workspace.locator('.document-reading-pane').waitFor();
 const visibility=await options.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.popupQuickFeatureVisibility;});
 let prior='zh-CN';
 for(const language of languages){if(language!==prior)await patch({uiLanguage:language},{uiLanguage:prior});prior=language;await options.waitForFunction(lang=>document.documentElement.lang===lang,language);await options.waitForFunction(text=>document.querySelector('.sidebar-tagline')?.textContent===text,taglines[language]);await popup.waitForFunction(text=>document.querySelector('.translate-label')?.textContent===text,messages[language][0]);await workspace.waitForFunction(text=>document.querySelector('.batch-toolbar > strong')?.textContent.startsWith(text),messages[language][1]);await options.waitForTimeout(150);
  await popup.setViewportSize({width:400,height:600});await popup.waitForFunction(lang=>document.documentElement.lang===lang,language);await popup.waitForTimeout(100); const popupWidth=await popup.locator('.popup-shell').evaluate(el=>Math.ceil(el.getBoundingClientRect().width));await popup.setViewportSize({width:popupWidth,height:600});assert.equal(await popup.locator('.popup-tagline').count(),0,'Popup footer has no slogan');await audit(popup,language+'-popup');assert(popupWidth<=400,'popup width remains within browser limits');
  for(const name of ['hover','selection','image','appearance','services']){const trigger=popup.locator(name==='services'?'[data-testid="popup-feature-services"]':`[data-popup-quick-feature="${name}"]`);const temporary=name==='appearance'&&!await trigger.count();if(temporary){await patch({popupQuickFeatureVisibility:{...visibility,appearance:true}},{popupQuickFeatureVisibility:visibility});await trigger.waitFor({state:'visible'});await audit(popup,`${language}-popup-custom-features`);}assert(await trigger.count(),`${name} drawer entry exists`);await trigger.click();await popup.locator('.el-drawer').waitFor();await popup.waitForTimeout(100);await audit(popup,`${language}-popup-${name}`);await popup.locator(name==='services'?'.popup-service-toolbar .service-panel-close':'.drawer-header > button').click();await popup.locator('.el-drawer').waitFor({state:'hidden'});if(temporary){await patch({popupQuickFeatureVisibility:visibility},{popupQuickFeatureVisibility:{...visibility,appearance:true}});await trigger.waitFor({state:'detached'});}}
  for(const width of [1280,390]){await options.setViewportSize({width,height:900});for(const section of sections){await options.evaluate(section=>{location.hash=section;},section);await options.waitForTimeout(130);await audit(options,`${language}-${section}-${width}`);}await doc.setViewportSize({width,height:900});await audit(doc,`${language}-document-${width}`);
      await workspace.setViewportSize({width,height:900});if(width===390&&await workspace.locator('.mobile-settings-toggle').getAttribute('aria-expanded')==='false')await workspace.locator('.mobile-settings-toggle').click();
      await audit(workspace,`${language}-document-workspace-${width}`);await workspace.locator('.reader-tabs button').last().click();await audit(workspace,`${language}-document-edit-${width}`);await workspace.locator('.reader-tabs button').first().click();}
 }
 // 对主要皮肤复核长文案的外层宽度与内部滚动，复用同一个隔离窗口。
 for(const language of ['zh-CN','en-US'])for(const skin of ['default','minimal','compact','yuebai'])for(const theme of ['light','dark']) {
  const current=await options.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});return typeof r.value==='string'?JSON.parse(r.value):r.value;});
  await patch({uiLanguage:language,interfaceSkin:skin,theme},{uiLanguage:current.uiLanguage,interfaceSkin:current.interfaceSkin,theme:current.theme});
  await popup.waitForFunction(text=>document.querySelector('.translate-label')?.textContent===text,messages[language][0]);await popup.waitForTimeout(100);
  const width=await popup.locator('.popup-shell').evaluate(el=>Math.ceil(el.getBoundingClientRect().width));assert(width<=400);await popup.setViewportSize({width,height:600});
  await audit(popup,`${language}-popup-${skin}-${theme}`);
 }
 report.ok=report.errors.length===0&&report.views.every(v=>v.documentWidth<=v.width+1&&!v.rootOverflow&&v.issues.length===0);
 } catch (error) { primaryError = error; throw error; } finally {
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
    await cleanup('browser', async () => { if (session) { await session.close(); browserClosed = true; } });
    await cleanup('profile', () => {
      if (!profile) return;
      if (browserClosed) fs.rmSync(profile, {recursive: true, force: true});
      else if (!launchAttempted) {
        try { fs.rmdirSync(profile); } catch (error) {
          // 未尝试启动浏览器时，仅移除初始空目录。
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup('report', () => { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
 }
 if(!report.ok)process.exitCode=1;
 console.log(JSON.stringify({ok:report.ok,views:report.views.length,issues:report.views.reduce((n,v)=>n+v.issues.length,0),out}));
})().catch(e=>{console.error(e);process.exitCode=1;});
