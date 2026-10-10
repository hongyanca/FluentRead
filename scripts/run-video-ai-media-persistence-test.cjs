#!/usr/bin/env node
// Production-extension regression for AI subtitle persistence through X hover and media metadata changes.
// Uses seeded transcript cues and a deterministic translation response, not live ASR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-video-ai-persistence'));
const helperPath = arg('focus-safe-helper');
const playwrightRoot = arg('playwright-root');
if (!helperPath || !playwrightRoot) throw new Error('Explicit focus-safe helper and Playwright runtime are required');
const helper = require(path.resolve(helperPath));
const {chromium} = createRequire(path.join(playwrightRoot, 'video-menu-proof.cjs'))('playwright');
fs.mkdirSync(artifacts, {recursive: true});
const mediaFile = path.join(artifacts, 'fixture.mp4');
const media = spawnSync(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), [
  '-y', '-f', 'lavfi', '-i', 'color=c=0x10283f:s=960x540:r=10',
  '-t', '10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaFile,
], {encoding: 'utf8'});
assert.equal(media.status, 0, media.stderr);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-menu-state-'));
const report = {success: false, evidence: 'Production extension; X DOM fixture; seeded AI cache; mocked translation; no live ASR', checks: [], errors: []};
let session;
let page;
async function main() {
  session = await helper.launchFocusSafePersistentContext({
    chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
  });
  const {context} = session;
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  context.on('page', candidate => candidate.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().endsWith('/background.js')});
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fixtureTranslationCalls = 0;
    globalThis.fixtureAiCalls = {get: 0, set: 0, transcribe: 0};
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (!sender.tab) return;
      const key = {fluentReadGetVideoAiSubtitleCache: 'get', fluentReadSetVideoAiSubtitleCache: 'set', fluentReadTranscribeLocalVideoAudio: 'transcribe'}[message.type];
      if (key) globalThis.fixtureAiCalls[key] += 1;
    });
    globalThis.fetch = async (input, init) => {
      if (!String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
      globalThis.fixtureTranslationCalls += 1;
      if (globalThis.fixtureTranslationFails) return new Response(JSON.stringify([{translations: [{text: ''}]}]), {status: 200, headers: {'content-type': 'application/json'}});
      return new Response(JSON.stringify([{translations: [{text: '字幕菜单同步测试'}]}]), {status: 200, headers: {'content-type': 'application/json'}});
    };
  });
  const control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${id}/popup.html`);
  let sequence = 0;
  const patchConfig = async patch => {
    const response = await control.evaluate(async ({patch, sequence}) => {
      const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!stored.success) throw new Error('Cannot read fixture configuration');
      const current = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value || {};
      return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'video-menu-state-proof', sequence,
        config: {...current, ...patch}, ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
    }, {patch, sequence: ++sequence});
    assert.equal(response.success, true);
  };
  await patchConfig({on: true, uiLanguage: 'zh-CN', from: 'en', to: 'zh-Hans',
    videoTranslationEnabled: true, videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual',
    videoService: 'microsoft', videoServiceDefaultMigrated: true, videoLocalModel: 'tiny', videoSourceLanguage: 'auto'});
  const cached = await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadSetVideoAiSubtitleCache',
    source: {statusUrl: 'https://x.com/fluentread/status/424242', videoIndex: '1'}, model: 'tiny', sourceLanguage: 'auto',
    cues: [{startMs: 0, durationMs: 10000, text: 'Subtitle menu state fixture.'}]}));
  assert.equal(cached.cached, true);
  const url = 'https://x.com/fluentread/status/424242';
  await context.route('https://video.twimg.com/**', route => {
    const bytes = fs.readFileSync(mediaFile);
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({contentType: 'video/mp4', headers: {'accept-ranges': 'bytes'}, body: bytes});
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    return route.fulfill({status: 206, contentType: 'video/mp4',
      headers: {'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${bytes.length}`},
      body: bytes.subarray(start, end + 1)});
  });
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    .fixture-controls{position:absolute;bottom:0;left:12px;right:12px;display:flex;align-items:center;height:44px;background:#222;color:#fff}
    .fixture-controls button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;padding:0;border:0;background:transparent;color:#fff;font-size:20px}
    .fixture-time{flex:1;min-width:0;font:12px Arial;white-space:nowrap;overflow:hidden}
    .fixture-actions{display:flex;align-items:center;flex:none}
    [data-testid="videoPlayer"]:fullscreen{width:100vw!important;height:100vh!important}
    </style></head><body style="margin:24px;background:#f3f5f9">
    <h1>字幕菜单状态同步</h1><article><div data-testid="videoPlayer" style="position:relative;width:960px;height:540px;overflow:hidden">
    <video src="https://video.twimg.com/fixture.mp4" style="width:100%;height:100%" muted></video>
    <div class="fixture-controls"><button aria-label="Play" onclick="this.dataset.clicked='true'">▶</button><span class="fixture-time">0:02 / 0:13</span>
    <div class="fixture-actions"><button aria-label="Captions">▣</button><button aria-label="Volume">◖</button><button aria-label="Settings">⚙</button>
    <div id="fixture-pip"><button aria-label="Picture in picture" onclick="this.dataset.clicked='true'">▣</button></div>
    <div id="fixture-fullscreen"><button aria-label="Full screen" onclick="this.closest('[data-testid=videoPlayer]').requestFullscreen()">⛶</button></div>
    </div></div></div></article></body></html>`}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    video.src = URL.createObjectURL(await (await fetch(video.src)).blob());
    video.load();
  });
  await page.locator('video').hover();

  const original = page.locator('#fluent-read-video-subtitle-original');
  const assertReady = async name => {
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-original')?.textContent === 'Subtitle menu state fixture.', null, {timeout: 6000});
    await page.locator('#fluent-read-video-subtitle-button').click();
    await page.waitForFunction(() => document.querySelector('[data-source-status]')?.textContent.includes('1 条'), null, {timeout: 6000});
    assert.equal(await page.locator('[data-action="toggle-ai-subtitle"]').getAttribute('aria-checked'), 'true');
    await page.locator('[data-action="close-menu"]').click();
    report.checks.push(name);
  };
  await assertReady('initial cached timeline restored');
  const initialCalls = await worker.evaluate(() => ({...globalThis.fixtureAiCalls}));
  // X may attach the media poster after the first identity was based only on the post.
  await page.mouse.move(4, 4);
  await page.evaluate(() => { document.querySelector('video').poster = 'https://pbs.twimg.com/ext_tw_video_thumb/424242/pu/img/fixture.jpg'; });
  await page.locator('video').hover();
  await page.waitForTimeout(1800);
  await assertReady('late poster enrichment preserves the ready timeline without another cache lookup');
  await page.waitForTimeout(200);
  const enrichedCalls = await worker.evaluate(() => ({...globalThis.fixtureAiCalls}));
  assert.equal(enrichedCalls.get, initialCalls.get);
  assert.equal(enrichedCalls.set, initialCalls.set + 1, 'Save the enriched durable cache alias once');
  await page.evaluate(() => { window.fixtureControls = document.querySelector('.fixture-controls'); window.fixtureControls.remove(); document.querySelector('video').removeAttribute('poster'); });
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1800);
  assert.equal(await original.textContent(), 'Subtitle menu state fixture.');
  await page.evaluate(() => document.querySelector('[data-testid="videoPlayer"]').appendChild(window.fixtureControls));
  await page.locator('video').hover();
  await assertReady('hover out/in and control remount with missing poster preserve subtitles');
  await page.evaluate(() => {
    const video = document.querySelector('video');
    const replacement = video.cloneNode(true);
    replacement.poster = 'https://pbs.twimg.com/ext_tw_video_thumb/424242/pu/img/fixture.jpg';
    video.replaceWith(replacement);
  });
  await page.locator('video').hover();
  await page.waitForTimeout(1800);
  await assertReady('same-media video node replacement preserves subtitles');
  await page.evaluate(() => document.querySelector('video').style.display = 'none');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector('video').style.display = '');
  await page.locator('video').hover();
  await assertReady('temporarily hidden connected video preserves subtitles beyond the remount grace period');
  await page.evaluate(() => {
    window.fixtureVideo = document.querySelector('video');
    window.fixtureParent = window.fixtureVideo.parentElement;
    window.fixtureVideo.remove();
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.fixtureVideo.style.display = 'none'; window.fixtureParent.prepend(window.fixtureVideo); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.fixtureVideo.style.display = '');
  await page.locator('video').hover();
  await assertReady('a reconnected hidden video cancels a pending missing-video timeout');
  const remountedCalls = await worker.evaluate(() => ({...globalThis.fixtureAiCalls}));
  assert.deepEqual(remountedCalls, enrichedCalls, 'Hover/remount must not repeat cache reads, writes or ASR');
  assert.equal(remountedCalls.transcribe, 0);
  report.checks.push('hover/remount causes no repeated cache work or ASR');
  await page.locator('[data-testid="videoPlayer"]').screenshot({path: path.join(artifacts, 'preserved-subtitles.png')});
  await page.evaluate(() => { document.querySelector('video').poster = 'https://pbs.twimg.com/ext_tw_video_thumb/999999/pu/img/other.jpg'; });
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-original')?.textContent, null, {timeout: 6000});
  await page.locator('#fluent-read-video-subtitle-button').click();
  await page.waitForFunction(() => document.querySelector('[data-source-status]')?.textContent === '暂未检测到字幕', null, {timeout: 6000});
  report.checks.push('different durable media identity clears old subtitles');
  await page.screenshot({path: path.join(artifacts, 'different-media.png')});
  report.success = true;
}
main().catch(async error => {
  report.error = {message: error.message, stack: error.stack};
  if (page) {
    report.state = await page.evaluate(() => ({source: document.querySelector('[data-source-status]')?.textContent,
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent, ai: document.querySelector('[data-action="toggle-ai-subtitle"]')?.textContent})).catch(() => null);
    await page.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await session?.close();
  fs.rmSync(profileDir, {recursive: true, force: true});
});
