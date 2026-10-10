'use strict';
/** X 页面快照的透明 img + 同级背景图契约，复用隔离生产产物浏览器回归。 */
const assert = require('node:assert/strict');

async function verifyXSurface({page, popup, worker, ui, wait, click, shot, report, originalImage, lightboxOnly = false}) {
    let settingsSequence = 0;
    async function patchSettings(config) {
        await popup.evaluate(async ({config, sequence}) => {
            const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
            const expected=Object.fromEntries(Object.keys(config).map(key=>[key,read.value[key]]));
            const response=await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config,expected,
                baseRevision:read.value.__fluentConfigRevision||0,clientId:'x-surface-fixture',sequence});
            if (!response.success) throw new Error(response.error);
        }, {config,sequence:++settingsSequence});
    }
    const surface = page.locator('#x-surface');
    if (originalImage) {
        await page.evaluate(src => {
            const image = document.querySelector('#sample');
            image.src = src;
            document.querySelector('#x-surface').style.backgroundImage = `url("${src}")`;
            image.parentElement.style.width = '449.796px';
        }, originalImage);
    }
    await page.waitForFunction(() => {
        const image = document.querySelector('#sample');
        return image.complete && image.naturalWidth > 0;
    });
    // 从用户授权读取的 X DOM 提取：100% 高度的滚动根节点，其 rect 随整页滚动离开视口。
    await page.evaluate(() => {
        const image = document.querySelector('#sample');
        image.parentElement.style.height = `${image.parentElement.clientWidth * image.naturalHeight / image.naturalWidth}px`;
        document.documentElement.style.cssText = 'height:100%;overflow-x:auto;overflow-y:scroll';
        document.body.style.height = '100%';
        const spacer = document.createElement('div'); spacer.style.height = '2700px';
        document.querySelector('.card').before(spacer);
        window.scrollTo(0, document.querySelector('#x-surface').getBoundingClientRect().top + window.scrollY - 78);
    });
    report.rootScroll = await page.evaluate(() => ({scrollY:window.scrollY,
        rootBottom:document.documentElement.getBoundingClientRect().bottom,
        imageTop:document.querySelector('#x-surface').getBoundingClientRect().top}));
    assert.ok(report.rootScroll.scrollY > 2000); assert.ok(report.rootScroll.rootBottom < 0);
    report.fixture = {kind: 'X snapshot-derived transparent img with matching sibling background', originalImage,
        originalSize: await page.locator('#sample').evaluate(image => [image.naturalWidth, image.naturalHeight])};
    await surface.hover();
    await wait(() => ui(`const overlay=this.querySelector('.fluent-read-image-translation-overlay');
        return !!overlay && getComputedStyle(overlay).display !== 'none';`));
    const position = await ui(`
        const rect = document.querySelector('#x-surface').getBoundingClientRect();
        const button = this.querySelector('.fr-image-controls').getBoundingClientRect();
        return {source:{left:rect.left,bottom:rect.bottom},button:{left:button.left,bottom:button.bottom}};
    `);
    assert.ok(Math.abs(position.button.left-position.source.left-8)<1);
    assert.ok(Math.abs(position.source.bottom-position.button.bottom-8)<1);
    report.cases.push('visible bottom-left action after document-root scroll on X background surface');
    await shot('x-01-hover-action');
    await patchSettings({imageTranslationHoverEnabled:false});
    await page.mouse.move(10,10);
    await wait(() => ui("return !this.querySelector('.fr-image-controls')"));
    await surface.hover();
    await page.waitForTimeout(250);
    assert.equal(await ui("return !!this.querySelector('.fr-image-controls')"),false);

    async function menuAction() {
        // 可信右键建立目标；通过生产消息执行原生菜单动作，OS 菜单项点击未自动化。
        await surface.click({button:'right'});
        await page.keyboard.press('Escape');
        const response=await worker.evaluate(async url => {
            const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);
            return chrome.tabs.sendMessage(tab.id,{type:'contextMenuTranslateImage'}, {frameId:0});
        },page.url());
        assert.equal(response?.status,'success');
    }
    await menuAction();
    if (lightboxOnly) {
        await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='translated'"), 300000);
        report.cases.push('default PaddleOCR translates X thumbnail before opening viewer');
    } else {
        await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='error'"));
        assert.match(await ui("return this.querySelector('.fr-image-status').textContent"),/首次使用/);
        await page.mouse.move(10,10);
        await page.waitForTimeout(500);
        assert.equal(await ui("return this.querySelector('.fr-image-controls')?.dataset.phase"),'error');
        await shot('x-02-first-use-prompt');
        for (const [language, title] of [['en-US','Image translation'],['ja-JP','画像翻訳'],['ko-KR','이미지 번역'],['fr-FR','Traduction d’images'],['ru-RU','Перевод изображений'],['es-ES','Traducción de imágenes']]) {
            await patchSettings({uiLanguage:language});
            await wait(() => ui(`return this.querySelector('.fr-image-feedback-title').textContent === ${JSON.stringify(`FluentRead · ${title}`)}`));
            const copy=await ui("return this.querySelector('.fr-image-status').textContent");
            const firstUse={'en-US':'first use','ja-JP':'初回','ko-KR':'처음','fr-FR':'première','ru-RU':'первого','es-ES':'primer uso'};
            assert.ok(copy.includes(firstUse[language]));
            const bounds = await ui(`const card=this.querySelector('.fr-image-feedback');
                const r=card.getBoundingClientRect();return {width:r.width,scroll:card.scrollWidth,client:card.clientWidth};`);
            assert.ok(bounds.scroll <= bounds.client + 1);
            await shot(`x-02-first-use-${language}`);
        }
        await patchSettings({uiLanguage:'zh-CN'});
        await wait(() => ui("return this.querySelector('.fr-image-feedback-title').textContent==='FluentRead · 图片翻译'"));
        report.cases.push('FluentRead branding and all seven supported UI languages and prompt changes fit without horizontal overflow');
        await click('关闭');
        await wait(() => ui("return !this.querySelector('.fr-image-controls')"));
        await menuAction();
        await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='error'"));
        report.cases.push('right-click target routing works with hover disabled; missing models prompt persists and closes');
        await ui(`this.__progress=[];const root=this;
            this.__progressObserver=new MutationObserver(()=>{const text=root.querySelector('.fr-image-status')?.textContent;
            if(text&&!root.__progress.includes(text))root.__progress.push(text)});
            this.__progressObserver.observe(this,{subtree:true,childList:true,characterData:true});return true;`);
        const began=Date.now();
        await click('下载语言包并翻译');
        await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='loading'"));
        const loading=await ui(`
            const feedback=this.querySelector('.fr-image-feedback');
            const spinner=this.querySelector('.fr-image-spinner');
            const r=feedback.getBoundingClientRect(),s=document.querySelector('#x-surface').getBoundingClientRect();
            return {hidden:feedback.hidden,spinner:!!spinner&&!spinner.hidden,
                center:[r.x+r.width/2,r.y+r.height/2],expected:[s.x+s.width/2,s.y+s.height/2]};`);
        assert.equal(loading.hidden,false);assert.equal(loading.spinner,true);
        loading.center.forEach((v,i)=>assert.ok(Math.abs(v-loading.expected[i])<1));
        report.loading=loading;
        await shot('x-03-downloading-models');
        await wait(() => ui("return /识别.*\\d+%/.test(this.querySelector('.fr-image-status')?.textContent) || this.querySelector('.fr-image-controls')?.dataset.phase!=='loading'"),300000);
        const recognitionStatus=await ui("return this.querySelector('.fr-image-status').textContent");
        if (/识别.*\d+%/.test(recognitionStatus)) {
            assert.equal(await surface.evaluate(el=>getComputedStyle(el).opacity),'1');
            report.recognitionStatus=recognitionStatus;
            await shot('x-03-recognizing-progress');
        }
        await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='translated'"),300000);
        report.coldPreparationAndTranslationMs=Date.now()-began;
        report.progress=await ui('return this.__progress');
        assert.ok(report.progress.some(text=>/识别.*\d+%/.test(text)), 'OCR must expose real engine percentages');
        report.downloadedLanguages=await popup.evaluate(async()=>{const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:fluentReadImageOcrLanguages'});return read.value;});
        assert.ok(report.downloadedLanguages.includes('jpn'), 'one-click automatic preparation must include Japanese');
    }
    const result=await ui(`
        const bitmap=this.querySelector('.fluent-read-image-translation-overlay img');
        return {surfaceOpacity:getComputedStyle(document.querySelector('#x-surface')).opacity,
            imgOpacity:getComputedStyle(document.querySelector('#sample')).opacity,
            bitmapOpacity:getComputedStyle(bitmap).opacity,fit:getComputedStyle(bitmap).objectFit,
            hidden:getComputedStyle(bitmap.parentElement).display==='none',size:[bitmap.naturalWidth,bitmap.naturalHeight]};`);
    assert.equal(result.surfaceOpacity,'0');assert.equal(result.imgOpacity,'0');
    assert.equal(result.bitmapOpacity,'1');assert.equal(result.fit,'cover');assert.equal(result.hidden,false);
    assert.deepEqual(result.size,report.fixture.originalSize);
    report.replacement=result;
    report.cases.push(lightboxOnly ? 'default PaddleOCR result visibly replaces X background surface'
        : 'one-click Chinese/English/Japanese language preparation continues to real OCR, translation, and visible X replacement');
    await shot('x-04-translated');
    await click('文字');
    await wait(() => ui("return !!this.querySelector('.fr-image-reader-body')"));
    report.translatedText=await ui("return this.querySelector('.fr-image-reader-body').textContent");
    assert.match(report.translatedText,/[\u4e00-\u9fff]/);
    await shot('x-05-translated-text');
    await click('文字');
    const requests=await worker.evaluate(()=>globalThis.__imageFixture.requests.length);
    if (lightboxOnly) assert.ok(requests > 0, '必须实际命中 Google 翻译 transport');
    const operations=await worker.evaluate(()=>globalThis.__imageFixture.operationIds.length);
    assert.ok(operations > 0, '必须观察真实图片翻译请求');
    report.requests=await worker.evaluate(()=>globalThis.__imageFixture.requests);
    await menuAction();
    await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='idle'"));
    assert.equal(await surface.evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal(await page.locator('#sample').evaluate(el=>getComputedStyle(el).opacity),'0');
    await shot('x-06-restored');
    await menuAction();
    await wait(() => ui("return this.querySelector('.fr-image-controls')?.dataset.phase==='translated'"));
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.requests.length),requests);
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.operationIds.length),operations);
    report.cases.push('right-click restore and cached redisplay preserve the X source DOM');
    await ui('this.__progressObserver?.disconnect();return true;');
    await ui("this.__lightboxThumbnail=this.querySelector('.fluent-read-image-translation-overlay img');return true;");

    // X 点击缩略图后保留列表原节点，并在独立图层打开大图。
    await page.evaluate(() => {
        document.querySelector('#x-surface').addEventListener('click', () => {
            if (document.querySelector('#x-lightbox')) return;
            const dialog = document.createElement('div');
            dialog.id = 'x-lightbox'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
            dialog.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center';
            const photo = document.createElement('img'); photo.id = 'x-lightbox-photo';
            photo.src = document.querySelector('#sample').src;
            photo.style.cssText = 'width:95vw;height:70vh;object-fit:contain;background:white';
            const close = document.createElement('button'); close.id = 'x-lightbox-close'; close.textContent = '关闭大图';
            close.style.cssText = 'position:absolute;right:16px;top:16px;border:0;padding:8px;background:white;color:black';
            close.addEventListener('click', () => dialog.remove());
            const next = document.createElement('button'); next.id = 'x-lightbox-next'; next.textContent = '下一张';
            next.style.cssText = 'position:absolute;right:16px;bottom:16px;border:0;padding:8px;background:white;color:black';
            next.addEventListener('click', () => {photo.src = document.querySelector('#sample').src + '#next';});
            dialog.append(photo, close, next); document.body.append(dialog);
        });
    });
    await surface.click();
    await page.locator('#x-lightbox-photo').waitFor({state:'visible'});
    await shot('x-07-lightbox-open');
    assert.equal(await ui("return getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display"),'none',
        '列表缩略译图不得悬浮在宿主大图查看器上');
    assert.equal(await surface.evaluate(el=>getComputedStyle(el).opacity),'1');
    const originalSource = await page.locator('#sample').getAttribute('src');
    assert.equal(await page.locator('#x-lightbox-photo').getAttribute('src'),originalSource);

    // 大图中的翻译入口仍然可用，译层应只跟随大图，不复活列表译图。
    await page.locator('#x-lightbox-photo').click({button:'right'}); await page.keyboard.press('Escape');
    const response = await worker.evaluate(async url => {
        const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);
        return chrome.tabs.sendMessage(tab.id,{type:'contextMenuTranslateImage'}, {frameId:0});
    },page.url());
    assert.equal(response?.status,'success');
    await wait(() => ui("return [...this.querySelectorAll('.fr-image-controls')].filter(el=>el.dataset.phase==='translated').length===2"));
    const visibility = await ui("return [...this.querySelectorAll('.fluent-read-image-translation-overlay')].map(el=>getComputedStyle(el).display)");
    assert.deepEqual(visibility,['none','block']);
    await shot('x-08-lightbox-translated');
    const requestsAfterViewer = await worker.evaluate(()=>globalThis.__imageFixture.requests.length);
    const operationsAfterViewer = await worker.evaluate(()=>globalThis.__imageFixture.operationIds.length);
    await page.locator('#x-lightbox-next').click();
    await wait(() => ui("return this.querySelectorAll('.fluent-read-image-translation-overlay img').length===1"));
    assert.equal(await ui("return getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display"),'none');
    assert.equal(await page.locator('#x-lightbox-photo').evaluate(el=>getComputedStyle(el).opacity),'1');
    await shot('x-08-lightbox-next');
    await page.locator('#x-lightbox-close').click();
    await wait(() => ui("return this.querySelectorAll('.fluent-read-image-translation-overlay').length===1 && getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display==='block'"));
    assert.equal(await surface.evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await page.locator('#sample').getAttribute('src'),originalSource);
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.requests.length),requestsAfterViewer);
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.operationIds.length),operationsAfterViewer);
    assert.equal(await ui("return this.querySelector('.fluent-read-image-translation-overlay img')===this.__lightboxThumbnail"),true);
    await shot('x-09-lightbox-closed');
    await surface.click();
    await wait(() => ui("return getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display==='none'"));
    await page.locator('#x-lightbox-close').click();
    await wait(() => ui("return this.querySelectorAll('.fluent-read-image-translation-overlay').length===1 && getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display==='block'"));
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.requests.length),requestsAfterViewer);
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.operationIds.length),operationsAfterViewer);
    await page.evaluate(() => {
        const dialog = document.createElement('dialog'); dialog.id = 'native-image-dialog';
        dialog.style.cssText = 'width:400px;height:200px';
        const close = document.createElement('button'); close.id = 'native-image-dialog-close'; close.textContent = '关闭';
        close.style.cssText = 'border:0;background:white;color:black;padding:8px';
        close.addEventListener('click', () => dialog.close());
        dialog.append(close); document.body.append(dialog); dialog.showModal();
    });
    await wait(() => ui("return getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display==='none'"));
    await page.locator('#native-image-dialog-close').click();
    await wait(() => ui("return getComputedStyle(this.querySelector('.fluent-read-image-translation-overlay')).display==='block'"));
    assert.equal(await worker.evaluate(()=>globalThis.__imageFixture.operationIds.length),operationsAfterViewer);
    await page.locator('#native-image-dialog').evaluate(el=>el.remove());
    report.lightbox = {visibility, requestsBefore:requests, requestsAfterViewer, operations, operationsAfterViewer,
        originalSourcePreserved:true, decodedThumbnailRetained:true};
    report.cases.push('trusted thumbnail click hides background translation under X-style viewer',
        'viewer image translates independently without leaking thumbnail overlay',
        'switching viewer source removes stale enlarged translation',
        'repeated viewer opening and closing keeps one cached thumbnail',
        'native modal open attribute changes suspend and restore thumbnail without new work',
        'closing viewer removes its state and restores cached thumbnail without requests');
}
module.exports={verifyXSurface};
