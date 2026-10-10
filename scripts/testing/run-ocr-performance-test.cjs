'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
// 实际生产 Offscreen OCR：初始化、语言切换、同图并发与取消。模型下载与识别分别计时。
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const extension = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-ocr-performance'));
const label = arg('label', 'candidate');
const imageFile = arg('image-file');
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
let profile, fixture;
fs.mkdirSync(artifacts, {recursive: true});
const report = {label, extension, scope: 'production Offscreen area OCR, real unchanged models, generated print and optional local screenshot; translation transport excluded', cases: [], errors: []};
(async () => {let session, primaryError, launchAttempted = false; try {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-ocr-performance-profile-'));
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-ocr-performance-extension-'));
    fs.cpSync(extension, fixture, {recursive: true});
    fs.writeFileSync(path.join(fixture, 'probe.html'), '<!doctype html><title>FluentRead OCR performance</title>');
    launchAttempted = true;
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile,
        browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
        viewport: {width: 1100, height: 800}, browserArgs: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`]});
    guardBrowserClose(session, profile);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const context = session.context;
    const sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
    const origin = sw.url().match(/^chrome-extension:\/\/[^/]+/)[0];
    const page = await newPageWithoutForeground(context);
    // 与生产 offscreen client 一样从后台发消息，避免扩展 UI 的请求先被后台未知消息路由回复。
    await page.exposeFunction('sendOcrMessage', message => sw.evaluate(message => chrome.runtime.sendMessage(message), message));
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(origin + '/probe.html');
    await sw.evaluate(async () => chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Isolated production OCR regression'}));
    await page.evaluate(async () => {
        for (let i = 0; i < 100; i++) {
            const ready = await window.sendOcrMessage({target: 'offscreen', type: 'FLUENT_READ_OFFSCREEN_READY'}).catch(() => null);
            if (ready?.ready) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Offscreen not ready');
    });
    const localImage = imageFile ? 'data:image/png;base64,' + fs.readFileSync(imageFile).toString('base64') : null;
    await page.evaluate(async localImage => {
        window.samples = {};
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        for (const [name, texts] of Object.entries({english: ['Welcome to FluentRead', 'Translate images with one click', 'Read every word in your language'], mixed: ['简体中文阅读测试', '繁體中文閱讀測試', '日本語の画像翻訳', 'English OCR language test']})) {
            canvas.width = 1400; canvas.height = 700; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#000'; ctx.font = '48px Arial'; texts.forEach((text, i) => ctx.fillText(text, 70, 110 + i * 140));
            window.samples[name] = {image: canvas.toDataURL(), width: canvas.width, height: canvas.height};
        }
        canvas.width = 650; canvas.height = 550; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 650, 550);
        ctx.fillStyle = '#000'; ctx.font = '42px serif';
        [...'日本語の画像'].forEach((text, i) => ctx.fillText(text, 500, 70 + i * 70));
        [...'翻訳を読む'].forEach((text, i) => ctx.fillText(text, 380, 70 + i * 70));
        window.samples.vertical = {image: canvas.toDataURL(), width: 650, height: 550};
        if (localImage) {const image = new Image(); image.src = localImage; await image.decode(); window.samples.screenshot = {image: localImage, width: image.width, height: image.height};}
        window.sequence = 0;
        window.recognize = async (name, sourceLanguage, suffix, copies = 1, cancelFirst = false) => {
            const sample = window.samples[name], c = document.createElement('canvas'); c.width = sample.width; c.height = sample.height;
            const x = c.getContext('2d'), image = new Image(); image.src = sample.image; await image.decode(); x.drawImage(image, 0, 0);
            // 改变空白边角像素，测量新图片而非已完成缓存命中；文字与坐标不变。
            x.fillStyle = `rgb(${suffix % 240},250,250)`; x.fillRect(0, 0, 1, 1);
            const data = c.toDataURL(); const requestIds = Array.from({length: copies}, () => `ocr-perf-${++window.sequence}`);
            const start = performance.now();
            const jobs = requestIds.map(requestId => window.sendOcrMessage({target: 'offscreen', type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN', requestId,
                image: data, sourceLanguage, selection: {left: 0, top: 0, width: c.width, height: c.height, viewportWidth: c.width, viewportHeight: c.height}}));
            if (cancelFirst) {await new Promise(resolve => setTimeout(resolve, 150)); await window.sendOcrMessage({target: 'offscreen', type: 'CANCEL_IMAGE_OPERATION_OFFSCREEN', requestId: requestIds[0]});}
            const results = await Promise.all(jobs);
            return {ms: performance.now() - start, results: results.map(({image, ...result}) => result)};
        };
    }, localImage);
    const packs = [['chi_sim'], ['chi_tra'], ['eng'], ['jpn']];
    const preparation = async () => page.evaluate(async packs => {
        const start = performance.now(); for (const languages of packs) {
            const response = await window.sendOcrMessage({target: 'offscreen', type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN', languages});
            if (!response?.success) throw new Error(response?.error || 'download failed');
        } return performance.now() - start;
    }, packs);
    report.coldPreparationMs = await preparation();
    report.cachedPreparationMs = await preparation();
    for (const name of ['english', 'mixed', 'vertical', ...(imageFile ? ['screenshot'] : [])]) {
        const measurements = [];
        for (let i = 0; i < 3; i++) {
            const result = await page.evaluate(({name, i}) => window.recognize(name, 'auto', 10 + i), {name, i});
            assert.equal(result.results[0].success, true, `${name}: ${JSON.stringify(result.results[0])}`);
            measurements.push(result);
        }
        report.cases.push({name, measurements});
        console.log(name, measurements.map(m => Math.round(m.ms)));
        fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    }
    const duplicateSample = imageFile ? 'screenshot' : 'mixed';
    report.duplicate = await page.evaluate(name => window.recognize(name, 'auto', 30, 2), duplicateSample);
    assert.equal(report.duplicate.results.every(r => r.success), true);
    assert.deepEqual(report.duplicate.results[0].lines, report.duplicate.results[1].lines);
    report.independentCancellation = await page.evaluate(name => window.recognize(name, 'auto', 40, 2, true), duplicateSample);
    assert.equal(report.independentCancellation.results[0].cancelled, true);
    assert.equal(report.independentCancellation.results[1].success, true);
    report.languageSwitches = [];
    for (const sourceLanguage of ['en', 'auto', 'ja', 'auto']) {
        const result = await page.evaluate(source => window.recognize('english', source, 50 + window.sequence), sourceLanguage);
        assert.equal(result.results[0].success, true);
        report.languageSwitches.push({sourceLanguage, ...result});
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
} catch (error) {primaryError = error; report.ok = false; report.failure = error.stack; process.exitCode = 1;}
finally {
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
    await cleanup('extension fixture', () => {
      // 启动尝试后，活浏览器可能仍从副本加载 Worker/WASM。
      if (fixture && (!launchAttempted || browserClosed)) fs.rmSync(fixture, {recursive: true, force: true});
    });
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
    report.cleaned = (!profile || !fs.existsSync(profile)) && (!fixture || !fs.existsSync(fixture));
    await cleanup('report', () => { fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
    console.log(JSON.stringify({label, ok: report.ok, duplicateMs: report.duplicate?.ms, failure: report.failure}));
}})().catch(error => {console.error(error); process.exitCode = 1;});
