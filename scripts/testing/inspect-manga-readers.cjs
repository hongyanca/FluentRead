/** 公开章节 DOM 核对：显式 URL 子集、隔离后台 Edge，只记录页面已呈现的图片/画布与阅读结构。 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
for (const name of ['urls-file', 'artifacts-dir', 'playwright-root', 'focus-safe-helper']) {
  if (!process.argv.includes(`--${name}`)) throw new Error(`Provide --${name}; no implicit full-site scan`);
}
const urls = JSON.parse(fs.readFileSync(arg('urls-file'), 'utf8'));
assert.ok(Array.isArray(urls) && urls.length > 0, 'Explicit public URL subset is required');
for (const sample of urls) {
  const href=typeof sample==='string'?sample:sample?.url;
  const url=new URL(href);
  assert.ok(['http:','https:'].includes(url.protocol) && !url.username && !url.password, 'Public research requires HTTP(S) URLs without credentials');
  if (typeof sample!=='string' && sample.openSelector!==undefined) assert.ok(typeof sample.openSelector==='string' && sample.openSelector.trim() && sample.openSelector.length<=1024, 'Per-page native opener must be an explicit selector of 1–1024 characters');
}
const settleMs = Number(process.argv.includes('--settle-ms') ? arg('settle-ms') : 3500);
assert.ok(Number.isInteger(settleMs) && settleMs >= 0 && settleMs <= 30000, 'Settle time must be 0–30000 ms');
const artifacts = path.resolve(arg('artifacts-dir'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(arg('focus-safe-helper'));
const headlessResearch = process.argv.includes('--headless-research');
const resetZoom = process.argv.includes('--reset-zoom');
const activationExtension=process.argv.includes('--activation-extension-dir')?path.resolve(arg('activation-extension-dir')):null;
assert.ok(!activationExtension||(!headlessResearch&&fs.existsSync(path.join(activationExtension,'manifest.json'))),'Visible tab activation requires an explicit built extension and normal browser');
assert.ok(!resetZoom || !headlessResearch, 'Zoom reset requires a normal visible browser');
const profile = fs.mkdtempSync('/private/tmp/fluentread-reader-inspection-');
fs.mkdirSync(artifacts, {recursive:true});
const report = {scope: urls, pages: [], errors: []};
let launched, browserPid, activationWorker;
async function tabState(page) {
  const native=await activationWorker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);if(!tab)throw new Error('Owned public tab missing');return {active:tab.active,windowState:(await chrome.windows.get(tab.windowId)).state};},page.url());
  const selector=process.argv.includes('--ready-selector')?arg('ready-selector'):'img';
  return {...native,...await page.evaluate(selector=>({documentVisibility:document.visibilityState,loadedImages:Array.from(document.querySelectorAll(selector)).filter(image=>image.tagName==='IMG'&&image.complete&&image.naturalWidth>=80&&image.naturalHeight>=40).length}),selector)};
}
async function boundedPageRead(operation) {
  let timeout;
  try {return await Promise.race([operation,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Public DOM inspection timed out after 30 seconds')),30000);})]);}
  finally {clearTimeout(timeout);}
}
class FocusSafetyError extends Error {}
function focusGuard(stage = 'public-dom-inspection') {
  if (headlessResearch) return;
  try {
    const current = JSON.parse(execFileSync('/usr/bin/osascript', ['-l','JavaScript','-e', "ObjC.import('AppKit');const a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier),name:ObjC.unwrap(a.localizedName)});"], {encoding:'utf8'}));
    assert.ok(browserPid, 'Own isolated browser process is known');
    assert.ok(Number.isInteger(current.pid) && current.pid > 0, 'Current foreground process is known');
    (report.focusChecks ??= []).push({...current, stage, browserFrontmost: current.pid === browserPid});
    assert.notEqual(current.pid, browserPid, 'Isolated Edge must stay behind the user application');
  } catch (error) {
    throw new FocusSafetyError(`${stage}: ${error.message}`);
  }
}
async function activateForInspection(page) {
  try {
    focusGuard('before-page-activation');
    await activateExtensionTabWithoutForeground(launched.context, page);
    focusGuard('after-page-activation');
  } catch (error) {
    if (error instanceof FocusSafetyError) throw error;
    throw new FocusSafetyError(`public-page-activation: ${error.message}`);
  }
}
(async () => {
  try {
    launched = await launchFocusSafePersistentContext({chromium,profileDir:profile,
      browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:headlessResearch,background:true,
      browserArgs:[...(activationExtension?[`--disable-extensions-except=${activationExtension}`,`--load-extension=${activationExtension}`]:[]),'--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
    report.launchMode = launched.launchMode; report.focusPolicy = launched.focusPolicy; report.windowPlacement = launched.windowPlacement;
    if (!headlessResearch) assert.equal(report.windowPlacement.browserFrontmost, false);
    report.purpose = headlessResearch ? 'read-only DOM research without extension; not extension runtime validation' : activationExtension?'read-only active-tab DOM research with FluentRead disabled; not extension runtime validation':'read-only background-tab DOM research without extension; not onscreen validation';
    const system = await launched.context.browser().newBrowserCDPSession();
    browserPid = (await system.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
    report.browserPid=browserPid;report.profileDir=profile;
    fs.writeFileSync(path.join(artifacts,'reader-inspection.json'),JSON.stringify(report,null,2));
    await system.detach();focusGuard();
    if(activationExtension){
      activationWorker=launched.context.serviceWorkers().find(worker=>worker.url().startsWith('chrome-extension://'))||await launched.context.waitForEvent('serviceworker',{timeout:20000});
      const control=launched.context.pages()[0];await control.goto(`chrome-extension://${new URL(activationWorker.url()).host}/popup.html`);
      const disabled=await control.evaluate(async()=>{
        const patch={on:false,disableFloatingBall:true,disableImageTranslator:true,imageTranslationMangaEnabled:false};
        const current=(await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'})).value;
        const response=await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:patch,expected:Object.fromEntries(Object.keys(patch).map(key=>[key,current[key]])),clientId:'reader-inspection-visible-tab',sequence:Date.now(),baseRevision:current.__fluentConfigRevision||0});
        if(!response?.success)throw new Error(response?.error||'Cannot disable extension before public inspection');
        return (await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'})).value.on===false;
      });
      assert.equal(disabled,true);report.activationControl={productionExtensionDisabled:true,method:'existing helper chrome.tabs.update; no host property override'};
    }
    for (const sample of urls) {
      const href=typeof sample==='string'?sample:sample.url;
      focusGuard('before-page-create');
      let page = await newPageWithoutForeground(launched.context);
      const parentPage = page, navigationResponses=[];
      const recordResponse=response=>{if(response.request().isNavigationRequest())navigationResponses.push({url:response.url(),status:response.status()});};
      launched.context.on('response',recordResponse);
      const result = {requestedUrl:href,pageErrors:[],consoleErrors:[],networkFailures:[]};
      const observedPages=new WeakSet();
      const observePage=target=>{
        if(observedPages.has(target))return;
        observedPages.add(target);
        target.on('dialog',async dialog=>{
          (result.publicDialogs??=[]).push({type:dialog.type(),message:dialog.message().slice(0,200)});
          await dialog.dismiss();
        });
        target.on('pageerror',error=>result.pageErrors.push({message:error.message,stack:error.stack||''}));
        target.on('console',message=>{
          if (message.type()==='error' && result.consoleErrors.length<30) {
            result.consoleErrors.push({message:message.text().slice(0,1000),source:message.location().url.split(/[?#]/)[0]});
          }
        });
        const publicRequest=request=>{const url=new URL(request.url());url.username='';url.password='';url.search='';url.hash='';return {url:['http:','https:'].includes(url.protocol)?url.href:`${url.protocol}[non-network source omitted]`,type:request.resourceType()};};
        target.on('requestfailed',request=>{if(result.networkFailures.length<100)result.networkFailures.push({...publicRequest(request),error:request.failure()?.errorText});});
        target.on('response',response=>{if(response.status()>=400&&['image','xhr','fetch'].includes(response.request().resourceType())&&result.networkFailures.length<100)result.networkFailures.push({...publicRequest(response.request()),status:response.status()});});
      };
      observePage(page);
      try {
        const response = await page.goto(href,{waitUntil:'domcontentloaded',timeout:25000});
        result.url=page.url();result.status=response?.status();result.navigationResponses=navigationResponses;
        await page.waitForTimeout(settleMs);result.settleMs=settleMs;
        if(activationExtension){
          try {
            result.beforeActivation=await tabState(page);
            await activateForInspection(page);await page.waitForTimeout(settleMs);
            result.afterActivation=await tabState(page);assert.equal(result.afterActivation.active,true);assert.equal(result.afterActivation.windowState,'normal');assert.equal(result.afterActivation.documentVisibility,'visible');
          } catch (error) {
            if (error instanceof FocusSafetyError) throw error;
            throw new FocusSafetyError(`public-tab-state: ${error.message}`);
          }
        }
        if(resetZoom){await page.keyboard.press('Meta+0');await page.reload({waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(settleMs);result.zoomReset={key:'Meta+0',reload:true};}
        const fillSelector=process.argv.includes('--before-inspect-fill-selector')?arg('before-inspect-fill-selector'):null;
        if(fillSelector){
          const fillValue=process.argv.includes('--before-inspect-fill-value')?arg('before-inspect-fill-value'):null;
          assert.ok(typeof fillValue==='string'&&fillValue.length>0&&fillValue.length<=100,'Public search requires an explicit value of 1–100 characters');
          await page.locator(fillSelector).fill(fillValue,{timeout:10000});result.readerSearch={selector:fillSelector,value:fillValue};
        }
        const clickSelector=typeof sample!=='string' && sample.openSelector!==undefined?sample.openSelector:process.argv.includes('--before-inspect-click')?arg('before-inspect-click'):null;
        if(clickSelector){
          const popup=process.argv.includes('--inspect-popup')?launched.context.waitForEvent('page',{timeout:15000}).then(value=>{observePage(value);return {page:value};},error=>({error})):null;
          await page.locator(clickSelector).click({timeout:10000});result.readerAction={selector:clickSelector};
          if(popup){const opened=await popup;if(opened.error)throw opened.error;page=opened.page;await page.waitForLoadState('domcontentloaded',{timeout:20000}).catch(error=>{result.popupNavigationError=error.message;});if(activationExtension){await activateForInspection(page);}}
          await page.waitForTimeout(settleMs);
        }
        const secondaryClick=process.argv.includes('--after-reader-click')?arg('after-reader-click'):null;
        if(secondaryClick){
          const coordinates=process.argv.includes('--after-reader-click-position')?arg('after-reader-click-position').split(',').map(Number):null;
          assert.ok(!coordinates||(coordinates.length===2&&coordinates.every(value=>Number.isInteger(value)&&value>=0&&value<=4096)),'Public click position requires two bounded integer coordinates');
          const position=coordinates?{x:coordinates[0],y:coordinates[1]}:undefined;
          await page.locator(secondaryClick).click({timeout:10000,position});result.secondaryReaderAction={selector:secondaryClick,position};
          await page.waitForTimeout(settleMs);
        }
        const scrollSelector=process.argv.includes('--before-inspect-scroll')?arg('before-inspect-scroll'):null;
        if(scrollSelector){await page.locator(scrollSelector).scrollIntoViewIfNeeded({timeout:15000});result.readerScroll=scrollSelector;await page.waitForTimeout(settleMs);}
        const pageKey=process.argv.includes('--before-inspect-key')?arg('before-inspect-key'):null;
        if(pageKey){
          const count=Math.min(4,Math.max(1,Number(process.argv.includes('--reader-key-count')?arg('reader-key-count'):1)));
          for(let n=0;n<count;n++)await page.keyboard.press(pageKey);
          result.readerKey=pageKey;result.readerKeyCount=count;
        }
        const readySelector=process.argv.includes('--ready-selector')?arg('ready-selector'):null;
        if(readySelector){
          result.readySelector=readySelector;
          result.readerReady=await page.waitForSelector(readySelector,{state:'visible',timeout:20000}).then(()=>true).catch(()=>false);
        }
        if(pageKey)await page.waitForTimeout(900);
        focusGuard();
        result.url=page.url();
        Object.assign(result, await boundedPageRead(page.evaluate(async () => {
          const publicSource = value => {
            if(value.startsWith('data:'))return `[inline image: ${value.length} characters]`;
            try {const url=new URL(value);if(url.protocol==='https:' || url.protocol==='http:'){url.search='';url.hash='';return url.href;}}catch{}
            return value;
          };
          const ancestors = element => {
            const values = [];
            for (let parent=element;parent && values.length<5;parent=parent.parentElement) values.push({tag:parent.tagName,id:parent.id,className:typeof parent.className==='string'?parent.className:'',dataPage:parent.getAttribute('data-page')});
            return values;
          };
          const images = Array.from(document.images).filter(img=>img.width>=200 || img.naturalWidth>=300).map(img=>({
            source:publicSource(img.currentSrc || img.src), width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
            rect: {x:img.getBoundingClientRect().x,y:img.getBoundingClientRect().y,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}, ancestors:ancestors(img)}));
          const backgrounds=[];
          const readerLinks=Array.from(document.querySelectorAll('a[href], [role="link"][data-href]')).flatMap(element=>{
            try {
              const url=new URL(element.getAttribute('href')||element.getAttribute('data-href'),location.href);
              if(!['http:','https:'].includes(url.protocol)||url.origin!==location.origin||url.username||url.password)return [];
              const text=element.textContent.trim().slice(0,120);
              if(!/chapter|episode|viewer|\/read\/|\/title\/|\/work|\/manga|\/comic|\/series|\/product|\/de[a-f\d]/i.test(url.href)&&!/試し?読み|試読|無料|読む|Read/i.test(text))return [];
              return [{url:url.href,text}];
            } catch{return [];}
          }).sort((a,b)=>Number(/chapter|episode|viewer|\/read\//i.test(b.url))-Number(/chapter|episode|viewer|\/read\//i.test(a.url))).slice(0,50);
          for(const element of Array.from(document.querySelectorAll('div[id^="page-"]')).slice(0,12)) {
            const style=getComputedStyle(element),rect=element.getBoundingClientRect();
            const source=/^url\(["']?(blob:[^"')]+)["']?\)$/.exec(style.backgroundImage)?.[1];
            if(!source)continue;
            const details={id:element.id,source,backgroundSize:style.backgroundSize,backgroundPosition:style.backgroundPosition,
              backgroundRepeat:style.backgroundRepeat,backgroundOrigin:style.backgroundOrigin,rect:rect.toJSON(),ancestors:ancestors(element)};
            const image=new Image(),canvas=document.createElement('canvas');
            try {
              await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('displayed blob image timeout')),5000);
                image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(new Error('displayed blob image failed'));};image.src=source;});
              details.naturalWidth=image.naturalWidth;details.naturalHeight=image.naturalHeight;
              canvas.width=canvas.height=8;const context=canvas.getContext('2d');context.drawImage(image,0,0,8,8);
              details.readable=true;details.nonblank=context.getImageData(0,0,8,8).data.some(v=>v!==0);
            } catch(error) {details.readable=false;details.pixelError=error.name;}
            finally {image.onload=image.onerror=null;image.src='';canvas.width=canvas.height=0;}
            backgrounds.push(details);
          }
          return {url:location.href,title:document.title,documentVisibility:document.visibilityState,documentHasFocus:document.hasFocus(),images:images.slice(0,30),imageCount:images.length,backgrounds,
            canvases:Array.from(document.querySelectorAll('canvas')).map(c=>{
              const rect=c.getBoundingClientRect(),hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2)),Math.max(0,Math.min(innerHeight-1,rect.top+rect.height/2)));
              let readable=false, nonblank=false, gridNonblank=false, pixelError='';
              try {const ctx=c.getContext('2d');if(ctx && c.width && c.height){
                const pixels=ctx.getImageData(0,0,Math.min(32,c.width),Math.min(32,c.height)).data;readable=true;nonblank=pixels.some(v=>v>0);
                // 透明页角不能证明整页为空；用与正文控制器一致的整数网格补充公开像素观察。
                for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
                  const point=ctx.getImageData(Math.floor((x+.5)*c.width/8),Math.floor((y+.5)*c.height/8),1,1).data;
                  if(point.some(v=>v>0))gridNonblank=true;
                }
              }}
              catch(error){pixelError=error.name;}
              return {width:c.width,height:c.height,readable,nonblank,gridNonblank,pixelError,ancestors:ancestors(c),
                rect:rect.toJSON(),centerHit:hit?{tag:hit.tagName,id:hit.id,className:hit.className,containsCanvas:hit.contains(c)}:null,
                parentPosition:c.parentElement?getComputedStyle(c.parentElement).position:null};
            }),
            frames:Array.from(document.querySelectorAll('iframe')).map(f=>({src:publicSource(f.src),id:f.id})),
            controls:Array.from(document.querySelectorAll('button,a')).filter(e=>/読む|読ん|続きを読む|read|viewer/i.test(e.textContent)).slice(0,8).map(e=>({tag:e.tagName,text:e.textContent.trim().slice(0,100),href:e.getAttribute('href')})),
            readerLinks,
            detectedRestriction:/Just a moment|Access Denied|Verify you are human/i.test(document.title)};
        })));
        result.status=page===parentPage?response?.status():navigationResponses.findLast(record=>record.url===page.url())?.status;
        result.navigationResponses=navigationResponses.filter(record=>[href,page.url()].includes(record.url));
        const publicHtml=await boundedPageRead(page.evaluate(()=>{
          const copy=document.documentElement.cloneNode(true);
          copy.querySelectorAll('script').forEach(script=>script.remove());
          copy.querySelectorAll('*').forEach(element=>{
            for(const attribute of [...element.attributes]) {
              if(attribute.name.startsWith('on'))element.removeAttribute(attribute.name);
              if(['src','href','srcset','data-src','data-srcset'].includes(attribute.name)) {
                if(attribute.value.startsWith('data:'))element.setAttribute(attribute.name,'[inline image omitted]');
                else element.setAttribute(attribute.name,attribute.value.replace(/\?[^\s"']*/g,''));
              }
            }
          });
          return '<!doctype html>'+copy.outerHTML;
        }));
        fs.writeFileSync(path.join(artifacts,`${report.pages.length}.html`),publicHtml);
        if(process.argv.includes('--capture-page')) {
          result.screenshot=path.join(artifacts,`${report.pages.length}.png`);
          focusGuard();await page.screenshot({path:result.screenshot});
          // 实际截图可能驱动一次正常绘制；复核同一公开 API，区分尚未绘制和像素确实不可读。
          result.afterScreenshotCanvases=await boundedPageRead(page.evaluate(()=>Array.from(document.querySelectorAll('canvas')).map(c=>{
            const rect=c.getBoundingClientRect(),sample={width:c.width,height:c.height,visible:rect.width>80&&rect.height>40,readable:false,gridNonblank:false};
            try {
              const context=c.getContext('2d');sample.nativePixelRead=!!context&&/\[native code\]/.test(context.getImageData.toString());
              if(context&&c.width&&c.height){sample.readable=true;for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(context.getImageData(Math.floor((x+.5)*c.width/8),Math.floor((y+.5)*c.height/8),1,1).data.some(value=>value>0))sample.gridNonblank=true;}
            } catch(error){sample.readable=false;sample.pixelError=error.name;}
            return sample;
          })));
        }
        if(process.argv.includes('--capture-element') && scrollSelector) {
          result.elementScreenshot=path.join(artifacts,`${report.pages.length}-element.png`);
          focusGuard();await page.locator(scrollSelector).screenshot({path:result.elementScreenshot,timeout:15000});
        }
      } catch(error) {
        result.error=error.message;
        if (error instanceof FocusSafetyError) {
          report.pages.push(result);
          throw error;
        }
      }
      report.pages.push(result);
      fs.writeFileSync(path.join(artifacts,'reader-inspection.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({url:href,status:result.status,images:result.imageCount,canvases:result.canvases?.length,error:result.error}));
      launched.context.off('response',recordResponse);
      focusGuard('before-page-close');
      await page.close();if(page!==parentPage)await parentPage.close();
      focusGuard('after-page-close');
    }
  } catch(error) {report.errors.push(error.stack);process.exitCode=1;}
  finally {
    await launched?.close();fs.rmSync(profile,{recursive:true,force:true});
    report.profileRemoved=!fs.existsSync(profile);
    fs.writeFileSync(path.join(artifacts,'reader-inspection.json'),JSON.stringify(report,null,2));
  }
})();
