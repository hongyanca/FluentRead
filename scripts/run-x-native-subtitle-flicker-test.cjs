#!/usr/bin/env node
// Production X captions: incremental HLS resources must not reset a selected native track.
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
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-x-native-flicker'));
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper');
if (!runtime || !helperPath) throw new Error('Explicit Playwright runtime and focus-safe helper are required');
const {chromium} = createRequire(path.join(runtime, 'x-native-flicker.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
const report = {success: false, evidence: 'Production extension; real video and TextTrack; controlled HLS fragments and 250ms translation responses', checks: [], errors: [], cleanupErrors: []};
const check = (name, pass, details) => report.checks.push({name, pass: Boolean(pass), details});
let session, profileDir, profileIdentity;
let launchAttempted = false;
(async () => {
  fs.mkdirSync(artifacts, {recursive: true});
  const mediaFile = path.join(artifacts, 'fixture.mp4');
  const media = spawnSync('/opt/homebrew/bin/ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x123044:s=960x540:r=30',
    '-t', '15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaFile],
    {encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL'});
  report.media = {status: media.status, signal: media.signal || null, error: media.error?.message};
  if (media.error) throw media.error;
  assert.equal(media.status, 0, media.stderr);
  const mediaSource = `data:video/mp4;base64,${fs.readFileSync(mediaFile).toString('base64')}`;
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-x-native-flicker-profile-'));
  profileIdentity = fs.lstatSync(profileDir);
  launchAttempted = true;
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check']});
  const {context} = session;
  const install = await context.browser().newBrowserCDPSession();
  let extensionId;
  try {
    ({id: extensionId} = await install.send('Extensions.loadUnpacked', {path: extensionDir}));
  } finally {
    try {await install.detach();}
    catch (error) {report.cleanupErrors.push(`CDP detach: ${error?.stack || String(error)}`);}
  }
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers().find(candidate => new URL(candidate.url()).host === extensionId)
    || await context.waitForEvent('serviceworker', {predicate: candidate => new URL(candidate.url()).host === extensionId});
  await worker.evaluate(() => {
    globalThis.flickerRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (!String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
      const source = String(JSON.parse(init.body)[0]);
      globalThis.flickerRequests.push({source, at: Date.now()});
      await new Promise(resolve => setTimeout(resolve, 250));
      return new Response(JSON.stringify([{translations: [{text: `译文：${source}`}]}]), {status: 200, headers: {'content-type': 'application/json'}});
    };
  });
  const control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  const saved = await control.evaluate(async () => {
    const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value || {};
    return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'x-native-flicker', sequence: 1,
      config: {...current, on: true, from: 'en', to: 'zh-Hans', videoSourceLanguage: 'auto', videoTranslationEnabled: true,
        videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual', videoSubtitleOffsetMs: 0,
        videoService: 'microsoft', videoServiceDefaultMigrated: true, useCache: false},
      ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
  });
  assert.equal(saved.success, true);
  const url = 'https://x.com/native-flicker/status/424242';
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:24px;background:#eef2f8">
    <h1>X 原生字幕分片稳定性</h1><article><div data-testid="videoPlayer" style="position:relative;width:960px;height:540px">
    <video muted controls style="width:100%;height:100%" src="${mediaSource}"></video>
    <div style="position:absolute;right:12px;bottom:40px"><button aria-label="Volume">Volume</button><button aria-label="Settings">Settings</button></div>
    </div></article></body></html>`}));
  await context.route('https://pbs.twimg.com/**', route => route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'}));
  const page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await page.locator('video').hover();
  await page.waitForSelector('#fluent-read-video-subtitle-button');
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await page.evaluate(() => {
    const video = document.querySelector('video');
    video.poster = 'https://pbs.twimg.com/ext_tw_video_thumb/424242/fixture.jpg';
    const track = video.addTextTrack('captions', 'English', 'en');
    track.addCue(new VTTCue(0, 8, 'A stable native sentence at five seconds.'));
    track.addCue(new VTTCue(9, 12, 'The next native sentence.'));
    track.mode = 'showing';
    video.currentTime = 5;
  });
  const expected = '译文：A stable native sentence at five seconds.';
  await page.waitForFunction(text => document.querySelector('#fluent-read-video-subtitle')?.textContent === text, expected);
  const initialRequests = await worker.evaluate(() => globalThis.flickerRequests);
  report.beforeFragments = initialRequests;
  await page.evaluate(async () => {
    const samples = window.flickerSamples = [];
    const sample = () => {
      const panel = document.querySelector('#fluent-read-video-subtitle-panel');
      samples.push({at: performance.now(), source: document.querySelector('#fluent-read-video-subtitle-original')?.textContent,
        translation: document.querySelector('#fluent-read-video-subtitle')?.textContent,
        active: panel?.classList.contains('fluent-read-video-subtitle-panel-active')});
    };
    sample();
    const timer = setInterval(sample, 20);
    try {
      for (let i = 0; i < 5; i += 1) {
        window.postMessage({source: 'fluent-read', type: 'fluent-read-x-video-subtitle-resource', pageHref: location.href,
          url: `https://video.twimg.com/ext_tw_video/424242/captions/fragment-${i}.vtt`,
          responseText: 'WEBVTT\n\n00:00:00.000 --> 00:00:08.000\nA stable native sentence at five seconds.\n'}, location.origin);
        await new Promise(resolve => setTimeout(resolve, 550));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {clearInterval(timer);}
  });
  report.samples = await page.evaluate(() => window.flickerSamples);
  report.afterFragments = await worker.evaluate(() => globalThis.flickerRequests);
  const blank = report.samples.filter(sample => !sample.source || sample.translation !== expected);
  check('Incremental sidecar fragments never blank the selected native bilingual cue', blank.length === 0, {blankSamples: blank.length, totalSamples: report.samples.length});
  check('Incremental sidecar fragments reuse native translations', report.afterFragments.length === initialRequests.length,
    {before: initialRequests.length, after: report.afterFragments.length});
  await page.screenshot({path: path.join(artifacts, 'native-with-fragments.png')});
  await page.evaluate(() => document.querySelector('video').currentTime = 8.5);
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-original')?.textContent);
  check('The real native cue gap remains empty despite sidecar captions', true);
  await page.evaluate(() => document.querySelector('video').currentTime = 9.5);
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：The next native sentence.');
  check('Seeking forward shows the matching next native pair', true);
  check('No page errors', report.errors.length === 0, report.errors);
  report.success = report.checks.every(result => result.pass);
  if (!report.success) process.exitCode = 1;
})().catch(error => {report.failure = error?.stack || String(error); console.error(error); process.exitCode = 1;}).finally(async () => {
  let closed = !launchAttempted;
  if (session) {
    try {await session.close(); closed = true;}
    catch (error) {report.cleanupErrors.push(`session close: ${error?.stack || String(error)}`);}
  }
  if (profileDir) {
    if (closed && profileIdentity) {
      try {
        const current = fs.lstatSync(profileDir);
        assert.ok(!current.isSymbolicLink() && current.ino === profileIdentity.ino && current.dev === profileIdentity.dev,
          'Temporary profile ownership changed');
        fs.rmSync(profileDir, {recursive: true, force: true}); report.profileRemoved = true;
      }
      catch (error) {report.cleanupErrors.push(`profile removal: ${error?.stack || String(error)}`); report.retainedProfile = profileDir;}
    } else report.retainedProfile = profileDir;
  }
  if (report.cleanupErrors.length) {report.success = false; process.exitCode = 1;}
  try {fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));}
  catch (error) {
    report.cleanupErrors.push(`report write: ${error?.stack || String(error)}`);
    report.success = false;
    console.error(error);
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report));
}).catch(error => {console.error(error?.stack || String(error)); process.exitCode = 1;});
