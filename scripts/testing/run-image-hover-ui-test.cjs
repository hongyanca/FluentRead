'use strict';
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
/**
 * 生产图片悬浮入口回归：真实 CDP 鼠标、封闭 Shadow DOM、原有淡色图标、图标解码与可信点击。
 * 只使用 focus-safe helper 的临时配置；夹具分别模拟 X 登录/未登录的两种媒体结构。
 * --live-url 可额外验证公开页面，登录后的结构使用夹具，不读取用户账户或配置。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(argument('artifacts-dir', path.join(os.tmpdir(), 'fluentread-image-hover-ui')));
const {chromium} = require(path.join(argument('playwright-root', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(argument('focus-safe-helper', path.join(os.homedir(), '.codex/skills/fluentread-browser-translation-test/scripts/focus-safe-browser.cjs')));
const browserPath = argument('browser-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const liveUrl = argument('live-url', '');
const report = {cases: [], errors: []};
fs.mkdirSync(artifactsDir, {recursive: true});

(async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-image-hover-'));
  let session;
  try {
    session = await launchFocusSafePersistentContext({chromium, profileDir, browserPath, headless: false, background: true,
      viewport: {width: 1280, height: 900}, browserArgs: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const context = session.context;
    const browserCdp = await context.browser().newBrowserCDPSession();
    const {id} = await browserCdp.send('Extensions.loadUnpacked', {path: extensionDir});
    const popup = await newPageWithoutForeground(context);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await waitForAsyncCondition(() => popup.evaluate(async () => Boolean((await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value)), {timeoutMs: 30000, message: "图片悬浮测试配置尚未就绪"});
    await popup.evaluate(async () => {
      const {value} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      // 未准备的 Tesseract 语言包提供实际失败反馈，点击测试不下载模型或调用翻译服务。
      const config = {on: true, disableImageTranslator: false, imageTranslationHoverEnabled: true,
        imageTranslationOcrEngine: 'tesseract', from: 'en', uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
      const expected = Object.fromEntries(Object.keys(config).map(key => [key, value[key]]));
      const result = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config, expected,
        clientId: 'image-hover-ui', sequence: 1, baseRevision: value.__fluentConfigRevision || 0});
      if (!result.success) throw new Error(result.error);
    });
    const page = await newPageWithoutForeground(context);
    page.on('pageerror', error => report.errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    async function controls() {
      const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
      let host;
      function visit(node) {
        const attrs = node.attributes || [];
        for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'id' && attrs[i + 1] === 'fluent-read-image-translation-root') host = node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
      }
      visit(tree.root);
      if (!host?.shadowRoots?.[0]) return {visible: false};
      const {object} = await cdp.send('DOM.resolveNode', {nodeId: host.shadowRoots[0].nodeId});
      try {
        const result = await cdp.send('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true, awaitPromise: true,
          functionDeclaration: `async function() {
            const b = this.querySelector('.fluent-read-image-translation-button');
            if (!b) return {visible: false};
            const r = b.getBoundingClientRect(), style = getComputedStyle(b), pseudo = getComputedStyle(b, '::before');
            const row = b.closest('.fr-image-actions'), rowStyle = getComputedStyle(row);
            let opacity = 1;
            for (let e = b; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
            const root = this;
            const hit = root.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
            const icon = new Image();
            icon.src = pseudo.backgroundImage.slice(5, -2);
            let iconLoaded = false;
            try {await icon.decode(); iconLoaded = icon.naturalWidth > 0;} catch {}
            return {visible: r.width > 0 && r.height > 0 && style.visibility === 'visible', text: b.textContent,
              phase: b.dataset.phase, rect: r.toJSON(), fontSize: parseFloat(style.fontSize), opacity,
              frame: {rect: row.getBoundingClientRect().toJSON(), padding: rowStyle.padding, borderWidth: rowStyle.borderWidth, background: rowStyle.backgroundColor},
              iconLoaded, iconFilter: pseudo.filter, hitButton: hit === b || b.contains(hit),
              feedback: this.querySelector('.fr-image-feedback')?.textContent};
          }`});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      } finally {await cdp.send('Runtime.releaseObject', {objectId: object.objectId});}
    }
    function assertEntry(result) {
      assert.equal(result.visible, true, '悬浮入口不可见');
      assert.equal(result.text, '翻译');
      assert.equal(result.rect.width, 24, '悬浮入口尺寸偏离原有小图标');
      assert.equal(result.rect.height, 24);
      assert.equal(result.fontSize, 0, '原有图标入口意外变成文字按钮');
      assert.equal(result.opacity, 0.28, '原有淡色入口透明度发生变化');
      assert.equal(result.frame.rect.width, 24, '图标外围仍有额外留白');
      assert.equal(result.frame.rect.height, 24);
      assert.equal(result.frame.padding, '0px');
      assert.equal(result.frame.borderWidth, '0px');
      assert.equal(result.frame.background, 'rgba(0, 0, 0, 0)', '图标外围仍有透明底色框');
      assert.equal(result.iconLoaded, true, '图标未能解码');
      assert.equal(result.iconFilter, 'grayscale(1)', '原有灰色图标样式发生变化');
      assert.equal(result.hitButton, true, '鼠标未命中按钮');
    }
    async function hover(photo) {
      await photo.evaluate(image => {image.scrollIntoView({block: 'start'}); window.scrollBy(0, -100);});
      await page.mouse.move(15, 15); await page.waitForTimeout(650);
      const r = await photo.boundingBox();
      await page.mouse.move(r.x + r.width/2, Math.max(110, r.y + Math.min(r.height/2, 200)));
      await page.waitForTimeout(850);
      return controls();
    }
    const source = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="white"/><text x="45" y="160" fill="black" font-size="42">FluentRead image hover test</text></svg>');
    for (const mode of ['ordinary', 'x-source-img', 'x-inert-link', 'native-button']) {
      const photo = `<div class="photo" data-testid="tweetPhoto">${mode === 'x-source-img' ? `<div class="background" style="background-image:url('${source}')"></div>` : ''}<img src="${source}" style="${mode === 'x-source-img' ? 'position:absolute;inset:0;opacity:0' : ''}"></div>`;
      const media = mode === 'x-inert-link' ? `<div class="photo"><div inert><a href="/photo/1"><img src="${source}"></a></div><a href="/photo/1" aria-label="查看媒体" style="position:absolute;inset:0"></a></div>` : mode === 'native-button' ? `<button>${photo}</button>` : `<a href="/photo/1">${photo}</a>`;
      const html = `<!doctype html><html><head><style>body{margin:60px;background:#eef1f6;font:18px system-ui}.photo,img{width:700px;height:350px}.photo{position:relative}.background{position:absolute;inset:0;background-size:cover}img{display:block}button{padding:0;border:0}</style></head><body><h1>${mode}</h1>${media}</body></html>`;
      await page.route('http://127.0.0.1:21991/**', route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
      await page.goto(`http://127.0.0.1:21991/${mode}`);
      await page.waitForFunction(() => document.getElementById('fluent-read-page-styles') && document.images[0]?.complete);
      const original = await page.locator('.photo').first().evaluate(element => element.outerHTML);
      const entry = await hover(page.locator('img'));
      const record = {mode, entry}; report.cases.push(record);
      if (mode === 'native-button') assert.equal(entry.visible, false);
      else {
        assertEntry(entry);
        await page.screenshot({path: path.join(artifactsDir, `${mode}.png`)});
        await page.mouse.move(entry.rect.x + entry.rect.width/2, entry.rect.y + entry.rect.height/2);
        await page.waitForTimeout(180);
        record.highlighted = await controls();
        assert.equal(record.highlighted.opacity, 1, '移到图标上未恢复清晰显示');
        assert.equal(record.highlighted.iconFilter, 'none');
        await page.mouse.move(15, 15); await page.waitForTimeout(650);
        record.afterLeave = await controls(); assert.equal(record.afterLeave.visible, false);
        assertEntry(await hover(page.locator('img')));
        await page.evaluate(() => {
          const modal = document.createElement('div'); modal.id = 'modal'; modal.setAttribute('role', 'dialog');
          modal.style.cssText = 'position:fixed;inset:0;background:white;z-index:9999999'; document.body.append(modal);
        });
        await page.waitForTimeout(200); record.modal = await controls(); assert.equal(record.modal.visible, false);
        await page.evaluate(() => document.getElementById('modal').remove());
        record.afterModal = await hover(page.locator('img')); assertEntry(record.afterModal);
        // 真实 CDP 点击必须改变任务状态且不能打开宿主媒体链接。
        const r = record.afterModal.rect, url = page.url();
        await page.mouse.click(r.x + r.width/2, r.y + r.height/2);
        await page.waitForTimeout(1200); record.afterClick = await controls();
        assert.notEqual(record.afterClick.phase, 'idle', '可信点击未启动图片翻译');
        assert.equal(page.url(), url, '点击错误地打开了宿主图片');
        assert.equal(await page.locator('.photo').first().evaluate(element => element.outerHTML), original, '宿主媒体被修改');
        await page.screenshot({path: path.join(artifactsDir, `${mode}-clicked.png`)});
      }
      await page.unroute('http://127.0.0.1:21991/**');
      console.log(JSON.stringify({mode, visible: entry.visible, clickPhase: record.afterClick?.phase}));
    }
    if (liveUrl) {
      await page.goto(liveUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
      await page.waitForTimeout(5000);
      const photos = page.locator('img[src*="/media/"]');
      assert.ok(await photos.count(), '公开页面没有加载媒体图片');
      report.live = [];
      // 当前匿名 X 的回复区受登录墙限制；真实站点只验证帖子与引用的前两张图片。
      for (let index = 0; index < Math.min(2, await photos.count()); index++) {
        const entry = await hover(photos.nth(index));
        assertEntry(entry); report.live.push({index, entry});
        await page.screenshot({path: path.join(artifactsDir, `live-${index}.png`)});
      }
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {report.error = error.stack; process.exitCode = 1; console.error(error.message);}
  finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    if (session) await session.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
})();
