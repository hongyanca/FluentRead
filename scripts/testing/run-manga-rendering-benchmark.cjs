'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
/** 漫画排版专项：隔离后台 Chrome 测量同页字形绘制与测量次数；直接执行源码束，不把受控输入当作真实 OCR 或翻译质量证据。 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function arg(name, fallback) {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];}
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const artifacts = path.resolve(arg('artifacts-dir'));
let profile;
let primaryError;
fs.mkdirSync(artifacts, {recursive: true});
const report = {cases: [], errors: [], scope: 'real Canvas text rendering with controlled regions; no OCR or translation transport'};
let launchAttempted = false;
let launched;
(async () => {
    profile = fs.mkdtempSync('/private/tmp/fluentread-manga-rendering-');
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium, profileDir: profile,
        browserPath: arg('browser-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        headless: false, background: true, browserArgs: ['--no-first-run','--no-default-browser-check'], viewport: {width:1280,height:900}});
    guardBrowserClose(launched, profile);
    Object.assign(report, {launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const page = await newPageWithoutForeground(launched.context);
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="page"></canvas>');
    await page.addScriptTag({path:path.resolve(arg('rendering-bundle'))});
    report.samples = await page.evaluate(() => {
        const canvas = document.querySelector('canvas'); canvas.width = 1200; canvas.height = 1800;
        const context = canvas.getContext('2d');
        const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255);
        const texts = ['我早就确认过了。','遗嘱已经送达……','……给了那位英雄的每一个孩子。','为什么会在这个时候来到这里？我一直在等你。','This is a complete sentence, with every word preserved.','彼は「大丈夫だ」と言っていた。'];
        const regions = Array.from({length:24}, (_, index) => ({text:texts[index%texts.length],fontSize:28,
            bbox:{x0:40+(index%4)*290,y0:40+Math.floor(index/4)*230,x1:280+(index%4)*290,y1:190+Math.floor(index/4)*230}}));
        // 复杂背景标题是独立样本，避免把对白的字体上限套在标题上。
        for(let y=1480;y<1740;y++)for(let x=300;x<1000;x++) {
            const offset=(y*canvas.width+x)*4;
            pixels[offset]=x%3?140:230;pixels[offset+1]=y%3?100:220;pixels[offset+2]=130;
        }
        regions.push({text:'英雄的遗属家族',fontSize:92,bbox:{x0:320,y0:1510,x1:980,y1:1710}});
        const measure=context.measureText.bind(context);let calls=0;
        context.measureText=text=>{calls++;return measure(text);};
        const samples=[];
        for(let round=0;round<31;round++) {
            context.putImageData(new ImageData(pixels,canvas.width,canvas.height),0,0);calls=0;
            const start=performance.now();FluentReadMangaRendering.drawMangaTranslations(context,pixels,canvas.width,canvas.height,regions,true);
            samples.push({round,ms:performance.now()-start,measureCalls:calls});
        }
        const warm=samples.slice(1).map(sample=>sample.ms).sort((a,b)=>a-b);
        return {userAgent:navigator.userAgent,samples,medianMs:warm[Math.floor(warm.length/2)],p95Ms:warm[Math.floor(warm.length*.95)],
            image:canvas.toDataURL('image/png'),regions};
    });
    const image = path.join(artifacts,'rendered-page.png');
    fs.writeFileSync(image, Buffer.from(report.samples.image.split(',')[1],'base64'));delete report.samples.image;report.screenshot=image;
    report.cases.push('same 24 dialogue blocks and complex-background title, 1 first and 30 warm draws');
    if(process.argv.includes('--inspect-site')) {
        await page.goto('https://mangaplus.shueisha.co.jp/viewer/1028732',{waitUntil:'domcontentloaded',timeout:60000});
        await page.locator('.zao-image').first().waitFor({timeout:45000});
        report.liveSite=await page.locator('.zao-image').evaluateAll(items=>items.map(image=>({width:image.naturalWidth,height:image.naturalHeight,loaded:image.complete,sourceHost:new URL(image.src).host})));
        await page.screenshot({path:path.join(artifacts,'live-chapter.png')});
        // 仅提取浏览器已加载的两张样本供同源性能验证，不访问付费页或额外章节。
        for(let index=0;index<2;index++) {
            const image=page.locator('.zao-image').nth(index);await image.evaluate(image=>image.scrollIntoView({block:'start'}));
            await image.evaluate(image=>image.complete&&image.naturalWidth?undefined:new Promise((resolve,reject)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',reject,{once:true});}));
            const encoded=await image.evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];});
            fs.writeFileSync(path.join(artifacts,`chapter-page-${index+1}.png`),Buffer.from(encoded,'base64'));
        }
        report.cases.push('read-only inspection of requested live chapter and two loaded images');
    }
    assert.deepEqual(report.errors,[]);report.status='passed';
})().catch(error=>{primaryError=error;report.status='failed';report.failure=String(error.stack);process.exitCode=1;})
.finally(async () => {
    const cleanupErrors = [];
    const cleanup = async (resource, release) => {
      try { await release(); } catch (error) {
        cleanupErrors.push(error);
        (report.cleanupErrors ||= []).push({resource, error: String(error.stack || error)});
        report.status = 'failed';
        process.exitCode = 1;
        console.error(`Cleanup failed (${resource}):`, error);
      }
    };
    let browserClosed = false;
    await cleanup('browser', async () => { if (launched) { await launched.close(); browserClosed = true; } });
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
    report.temporaryProfileRemoved = !profile || !fs.existsSync(profile);
    await cleanup('report', () => { fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
    console.log(JSON.stringify({status:report.status,medianMs:report.samples?.medianMs,measureCalls:report.samples?.samples.at(-1).measureCalls,failure:report.failure,report:path.join(artifacts,'report.json')}));
}).catch(error => {console.error(error); process.exitCode = 1;});
