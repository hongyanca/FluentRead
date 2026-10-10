#!/usr/bin/env node
// 设置界面视觉审核：全部分区、亮暗与窄屏、快捷键录制及本地收藏复习；临时后台 Edge，不调用外部模型。
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const arg = (key, fallback) => {
  const index = process.argv.indexOf('--' + key)
  return index < 0 ? fallback : process.argv[index + 1]
}
const root = path.resolve(__dirname, '../..')
const extensionDir = path.resolve(arg('extension-dir', path.join(root, '.output/chrome-mv3')))
const runtime = createRequire(
  path.join(arg('playwright-root', process.env.PLAYWRIGHT_ROOT), 'style-audit.cjs')
)
const { chromium } = runtime('playwright')
const helper = require(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')))
const output = arg('artifacts-dir', '/private/tmp/fluentread-style-audit')
const report = {
  ok: false,
  extension: path.basename(extensionDir),
  cases: [],
  screenshots: [],
  pageErrors: [],
  consoleErrors: [],
}

;(async () => {
  fs.mkdirSync(output, { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-style-audit-'))
  let launched, primaryError
  let launchAttempted = false;
  try {
    launchAttempted = true;
    launched = await helper.launchFocusSafePersistentContext({
      chromium,
      profileDir: profile,
      browserPath:
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      background: true,
      headless: false,
      viewport: { width: 1280, height: 800 },
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      timeout: 30000,
    })
    guardBrowserClose(launched, profile);
    Object.assign(report, {
      launchMode: launched.launchMode,
      focusPolicy: launched.focusPolicy,
      windowPlacement: launched.windowPlacement,
    })
    const context = launched.context
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 30000 }))
    const origin = worker.url().split('/').slice(0, 3).join('/')
    const page = await helper.newPageWithoutForeground(context, 30000)
    page.on('pageerror', (e) => report.pageErrors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') report.consoleErrors.push(m.text())
    })


    await page.goto(origin + '/options.html')
    await page.locator('.settings-app').waitFor()
    const ids = await page.locator('nav button').evaluateAll(bs=>bs.map(b=>b.dataset.section))
    for(const mode of ['light','dark','narrow']) {
      await page.setViewportSize(mode==='narrow'?{width:390,height:844}:{width:1440,height:900})
      await page.emulateMedia({colorScheme:mode==='dark'?'dark':'light'})
      for(const id of ids) {
        await page.locator(`nav button[data-section="${id}"]`).click()
        await page.locator('.settings-card').evaluate(el=>el.scrollTo(0,0))
        await page.waitForTimeout(200)
        await page.screenshot({path:path.join(output,`${mode}-${id}.png`)})
        if(mode==='light') {
          const m=await page.locator('.settings-card').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}))
          if(m.scroll>m.height*1.5) {
            await page.locator('.settings-card').evaluate(el=>el.scrollTo(0,el.scrollHeight/2))
            await page.screenshot({path:path.join(output,`${mode}-${id}-middle.png`)})
            await page.locator('.settings-card').evaluate(el=>el.scrollTo(0,el.scrollHeight))
            await page.screenshot({path:path.join(output,`${mode}-${id}-bottom.png`)})
          }
        }
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)
        assert(!overflow,`${mode} ${id} overflows the viewport`)
        assert.equal(await page.locator('nav button svg path').count(),17)
        if(id==='settings-vocabulary') {
          assert.equal(await page.locator('.summary-grid, .primary-actions, .toolbar').count(), 0, 'Empty learning center must not show zero statistics or unavailable actions')
        }
        report.cases.push({mode,id,overflow,navigationIcons:17})
      }
    }

    const patch = async changes => {
      const result = await page.evaluate(async changes => {
        const stored = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'})
        const config = typeof stored.value==='string'?JSON.parse(stored.value):stored.value
        return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:changes,expected:Object.fromEntries(Object.keys(changes).map(k=>[k,config[k]])),clientId:'ui-style-audit',sequence:Date.now()})
      },changes)
      assert.equal(result.success,true)
    }
    await page.setViewportSize({width:1366,height:768})
    await patch({hotkey:'custom', customHotkey:'ctrl+shift+x', vocabularyBookEnabled:true})
    await page.locator('button[data-section="settings-translation"]').click()
    for(const [mode,width,height] of [['light',1366,768],['dark',1366,768],['narrow',390,600]]) {
      await page.setViewportSize({width,height})
      await page.emulateMedia({colorScheme:mode==='dark'?'dark':'light'})
      await page.getByRole('button',{name:'编辑鼠标悬浮快捷键',exact:true}).click()
      await page.locator('.custom-hotkey-dialog').waitFor()
      await page.locator('.preset-button').first().click()
      assert.equal(await page.locator('.preset-button').first().getAttribute('aria-pressed'),'true')
      assert(await page.locator('.custom-hotkey-dialog .primary-button').isEnabled())
      await page.screenshot({path:path.join(output,`hotkey-${mode}.png`)})
      const bounds=await page.locator('.custom-hotkey-dialog').boundingBox()
      assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1)
      await page.locator('.custom-hotkey-dialog .secondary-button').click()
      assert.equal(await page.locator('.custom-hotkey-dialog').count(),0)
    }
    await page.setViewportSize({width:1366,height:768})
    await page.getByRole('button',{name:'编辑鼠标悬浮快捷键',exact:true}).click()
    await page.locator('.hotkey-input-field').click()
    await page.locator('.hotkey-input-field').press('Control+Shift+F8')
    await page.waitForFunction(()=>document.querySelector('.hotkey-display')?.textContent.includes('F8'))
    await page.locator('.custom-hotkey-dialog .primary-button').click()
    assert((await page.locator('.custom-hotkey-display').first().innerText()).includes('F8'))
    report.cases.push({hotkeyRecordingAndPresetsAndCancel:true})
    await page.locator('.el-message').waitFor({state:'hidden'})
    await page.locator('button[data-section="settings-vocabulary"]').click()
    const entry = await page.evaluate(async () => chrome.runtime.sendMessage({type:'fluentReadVocabularyBook',action:'upsert',input:{sourceLanguage:'en',targetLanguage:'zh-Hans',term:'thoughtful',translation:'体贴的；考虑周到的',context:{text:'A thoughtful design makes reading feel effortless.',capturedAt:Date.now()}}}))
    assert.equal(entry.success,true)
    await page.locator('.word-row').first().waitFor()
    for(const mode of ['light','dark','yuebai','narrow']) {
      await page.setViewportSize(mode==='narrow'?{width:390,height:844}:{width:1366,height:768})
      await page.emulateMedia({colorScheme:mode==='dark'?'dark':'light'})
      await patch({interfaceSkin:mode==='yuebai'?'yuebai':'default'})
      await page.waitForTimeout(200)
      await page.locator('.settings-card').evaluate(el=>el.scrollTo(0,0))
      const firstWord = await page.locator('.word-heading').first().boundingBox()
      assert(firstWord.y + firstWord.height < page.viewportSize().height, `${mode}: first saved word is below the fold`)
      await page.screenshot({path:path.join(output,`vocabulary-populated-${mode}.png`)})
      await page.locator('.start-review').click()
      assert.equal(await page.locator('.beta-panel, .summary-grid, .privacy-note, .selection-reminder').count(), 0, 'Review must focus on the current word')
      await page.locator('.reveal-button').click()
      await page.locator('.review-actions .good').waitFor()
      await page.screenshot({path:path.join(output,`review-${mode}.png`)})
      await page.locator('.review-header button').click()
    }
    await patch({interfaceSkin:'default'})
    await page.locator('.search-field input').fill('no matching saved word')
    await page.getByRole('heading',{name:'没有匹配的词条',exact:true}).waitFor()
    await page.locator('.search-field input').fill('thoughtful')
    assert.equal(await page.locator('.word-row').count(),1)
    await page.locator('.beta-switch').click()
    await page.waitForFunction(()=>document.querySelector('.beta-switch')?.getAttribute('aria-checked')==='false')
    await page.reload()
    await page.locator('.word-row').first().waitFor()
    assert.equal(await page.locator('.beta-switch').getAttribute('aria-checked'),'false')
    assert((await page.locator('.word-row').innerText()).includes('thoughtful'))
    report.cases.push({searchAndDisableKeepsSavedWordsAfterReload:true})
    report.cases.push({vocabularySavedEntryAndReview:true})
    for(const file of ['popup.html','document.html']) {
      await page.setViewportSize(file==='popup.html'?{width:400,height:600}:{width:1440,height:900})
      await page.goto(origin+'/'+file)
      await page.locator(file==='popup.html'?'.popup-shell':'.document-app').waitFor()
      await page.screenshot({path:path.join(output,file+'.png')})
    }
    assert.equal(report.pageErrors.length,0)
    assert.equal(report.consoleErrors.length,0,JSON.stringify(report.consoleErrors))
    report.ok=true
  } catch (error) {
    primaryError = error
    report.error = error.stack
    process.exitCode = 1
  } finally {
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
    await cleanup('browser', async () => { if (launched) { await launched.close(); browserClosed = true; } });
    await cleanup('profile', () => {
      if (!profile) return;
      if (browserClosed) fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
      else if (!launchAttempted) {
        try { fs.rmdirSync(profile); } catch (error) {
          // 未尝试启动浏览器时，仅移除初始空目录。
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup('report', () => { report.screenshots = fs.readdirSync(output).filter(name => name.endsWith('.png')); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
    console.log(JSON.stringify(report, null, 2))
  }
})().catch(error => {console.error(error); process.exitCode = 1;})
