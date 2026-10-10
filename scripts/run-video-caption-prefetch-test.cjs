#!/usr/bin/env node
// Production extension, real media clock, controlled caption tracks and a 500 ms provider.
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');
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
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-caption-prefetch'));
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs'));
const extensionInstall = arg('extension-install', 'command-line');
if (!runtime || !helperPath) throw new Error('Explicit Playwright runtime and focus-safe helper are required');
const {chromium} = createRequire(path.join(runtime, 'caption-prefetch-proof.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
fs.mkdirSync(artifacts, {recursive: true});
const mediaFile = path.join(artifacts, 'fixture.mp4');
const media = spawnSync(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-y', '-f', 'lavfi', '-i', 'color=c=0x123044:s=960x540:r=30',
  '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaFile], {encoding: 'utf8'});
assert.equal(media.status, 0, media.stderr);
const mediaSource = `data:video/mp4;base64,${fs.readFileSync(mediaFile).toString('base64')}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-caption-prefetch-profile-'));
const report = {success: false, providerDelayMs: 500, evidence: 'Production extension; controlled YouTube/X caption tracks; real video; simulated provider', checks: [], errors: []};
const check = (name, pass, details) => report.checks.push({name, pass: Boolean(pass), details});
let session, youtube, x;
let primaryError;
let launchAttempted = false;
(async () => {
  launchAttempted = true;
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: [...(extensionInstall === 'cdp' ? ['--enable-unsafe-extension-debugging']
      : [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]), '--no-first-run', '--no-default-browser-check'],
  });
  guardBrowserClose(session, profileDir);
  const {context} = session;
  if (extensionInstall === 'cdp') {
    const install = await context.browser().newBrowserCDPSession();
    let installError;
    try {await install.send('Extensions.loadUnpacked', {path: extensionDir});}
    catch (error) {installError = error; throw error;}
    finally {
      try {await install.detach();} catch (error) {
        if (!installError) throw error;
        process.stderr.write(`CDP detach failed: ${error.stack || error}\n`);
      }
    }
  }
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().endsWith('/background.js')});
  await worker.evaluate(() => {
    globalThis.prefetchProofRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (!String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
      const source = String(JSON.parse(init.body)[0]);
      globalThis.prefetchProofRequests.push({source, at: Date.now()});
      await new Promise(resolve => setTimeout(resolve, 500));
      return new Response(JSON.stringify([{translations: [{text: `译文：${source}`}]}]), {status: 200, headers: {'content-type': 'application/json'}});
    };
  });
  const control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const configResult = await control.evaluate(async () => {
    const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value || {};
    return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'caption-prefetch-proof', sequence: 1,
      config: {...current, on: true, from: 'en', to: 'zh-Hans', videoSourceLanguage: 'auto', videoTranslationEnabled: true,
        videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual', videoSubtitleOffsetMs: 0,
        videoPreferHumanSubtitles: false, videoService: 'microsoft', videoServiceDefaultMigrated: true, useCache: false},
      ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
  });
  assert.equal(configResult.success, true);
  const youtubeUrl = 'https://www.youtube.com/watch?v=caption-prefetch-proof';
  await context.route(youtubeUrl, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:20px;background:#eef2f8;font:18px Arial}#movie_player{position:relative;width:960px;height:540px;background:#123044;color:white}
    video{width:100%;height:100%}.ytp-right-controls{position:absolute;right:16px;bottom:8px}#ytp-caption-window-container{position:absolute;bottom:64px;width:100%;text-align:center}
    </style></head><body><h1>字幕预翻译时序</h1><div id="movie_player" class="html5-video-player"><video class="html5-main-video" muted src="${mediaSource}"></video>
    <div id="ytp-caption-window-container"><span class="ytp-caption-segment">Repeated rolling sentence.</span></div><div class="ytp-right-controls"><button aria-label="Settings">设置</button></div></div></body></html>`}));
  youtube = await helper.newPageWithoutForeground(context);
  await youtube.goto(youtubeUrl);
  await youtube.waitForSelector('#fluent-read-video-subtitle-button');
  await youtube.waitForFunction(() => document.querySelector('video').readyState >= 2);
  // Repeated overlapping rolling rows must not occupy all eight prefetch entries.
  await youtube.evaluate(() => window.postMessage({source: 'fluent-read', type: 'fluent-read-youtube-timedtext',
    url: 'https://www.youtube.com/api/timedtext?v=caption-prefetch-proof&lang=en', responseText: JSON.stringify({events: [
      ...Array.from({length: 8}, (_, i) => ({tStartMs: i * 20, dDurationMs: 5000, segs: [{utf8: 'Repeated rolling sentence.'}]})),
      {tStartMs: 1000, dDurationMs: 2500, segs: [{utf8: 'The next distinct sentence is ready.'}]},
    ]})}, location.origin));
  await youtube.waitForTimeout(1500);
  const beforeSwitch = await worker.evaluate(() => globalThis.prefetchProofRequests);
  check('A distinct upcoming sentence is prefetched beyond repeated rolling rows', beforeSwitch.some(r => r.source === 'The next distinct sentence is ready.'), beforeSwitch);
  await youtube.evaluate(() => {
    window.prefetchProofSamples = [];
    window.prefetchProofObserver = new MutationObserver(() => {
      window.prefetchProofSamples.push({at: performance.now(), original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent,
        translation: document.querySelector('#fluent-read-video-subtitle')?.textContent});
    });
    window.prefetchProofObserver.observe(document.querySelector('#movie_player'), {subtree: true, childList: true, characterData: true});
    document.querySelector('video').currentTime = 1.2;
    document.querySelector('.ytp-caption-segment').textContent = 'The next distinct sentence is ready.';
  });
  await youtube.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：The next distinct sentence is ready.');
  const samples = await youtube.evaluate(() => {
    window.prefetchProofObserver.disconnect();
    return window.prefetchProofSamples.filter(s => s.original === 'The next distinct sentence is ready.');
  });
  const translated = samples.find(s => s.translation === '译文：The next distinct sentence is ready.');
  report.subtitleLagMs = translated ? translated.at - samples[0].at : null;
  check('Cached original and translation first appear together', samples.length > 0 && samples[0].translation === '译文：The next distinct sentence is ready.', {lagMs: report.subtitleLagMs, samples});
  await youtube.screenshot({path: path.join(artifacts, 'prefetched-bilingual.png')});
  await youtube.evaluate(() => {
    document.querySelector('video').currentTime = 12;
    document.querySelector('.ytp-caption-segment').textContent = 'Cached replay without a matching timeline.';
  });
  await youtube.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：Cached replay without a matching timeline.');
  await youtube.evaluate(() => { document.querySelector('.ytp-caption-segment').textContent = ''; });
  await youtube.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle')?.textContent);
  await youtube.evaluate(() => {
    window.replaySamples = [];
    window.replayObserver = new MutationObserver(() => window.replaySamples.push({
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent,
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent,
    }));
    window.replayObserver.observe(document.querySelector('#movie_player'), {subtree: true, childList: true, characterData: true});
    document.querySelector('.ytp-caption-segment').textContent = 'Cached replay without a matching timeline.';
  });
  await youtube.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：Cached replay without a matching timeline.');
  const replaySamples = await youtube.evaluate(() => {window.replayObserver.disconnect(); return window.replaySamples.filter(s => s.original === 'Cached replay without a matching timeline.');});
  check('Cached DOM-only captions bypass the text stability wait', replaySamples[0]?.translation === '译文：Cached replay without a matching timeline.', replaySamples);

  const xUrl = 'https://x.com/caption-prefetch-proof';
  await context.route(xUrl, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div data-testid="videoPlayer" style="position:relative;width:960px;height:540px">
    <video muted style="width:100%;height:100%" src="${mediaSource}"></video><div style="position:absolute;right:12px;bottom:40px"><button aria-label="Volume">Volume</button><button aria-label="Settings">Settings</button></div></div></body></html>`}));
  x = await helper.newPageWithoutForeground(context);
  await x.goto(xUrl);
  await x.waitForSelector('#fluent-read-video-subtitle-button');
  await x.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const addedAt = await x.evaluate(() => {
    const track = document.querySelector('video').addTextTrack('captions', 'English', 'en');
    track.addCue(new VTTCue(2, 5, 'Native upcoming cue should be translated early.'));
    track.mode = 'showing';
    return Date.now();
  });
  for (let i = 0; i < 60; i += 1) {
    if (await worker.evaluate(() => globalThis.prefetchProofRequests.some(r => r.source === 'Native upcoming cue should be translated early.'))) break;
    await x.waitForTimeout(50);
  }
  const nativeRequest = await worker.evaluate(() => globalThis.prefetchProofRequests.find(r => r.source === 'Native upcoming cue should be translated early.'));
  report.nativeTrackDispatchMs = nativeRequest.at - addedAt;
  check('Adding a native track primes upcoming captions immediately', report.nativeTrackDispatchMs < 200, report.nativeTrackDispatchMs);
  await x.waitForTimeout(600);
  await x.evaluate(() => document.querySelector('video').currentTime = 2.1);
  await x.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：Native upcoming cue should be translated early.');
  check('Native cached cue renders matching original and translation', await x.evaluate(() =>
    document.querySelector('#fluent-read-video-subtitle-original')?.textContent === 'Native upcoming cue should be translated early.'));
  await x.evaluate(() => {
    const video = document.querySelector('video');
    video.currentTime = 0;
    const track = video.textTracks[0];
    Array.from(track.cues).forEach(cue => track.removeCue(cue));
    for (let i = 0; i < 8; i += 1) track.addCue(new VTTCue(i * .02, 10, 'Native repeated rolling sentence.'));
    track.addCue(new VTTCue(3, 6, 'Native distinct sentence follows repeated rows.'));
  });
  await x.waitForTimeout(1600);
  const nativeBeforeSwitch = await worker.evaluate(() => globalThis.prefetchProofRequests);
  check('Native repeated entries do not consume the upcoming distinct sentence budget', nativeBeforeSwitch.some(r => r.source === 'Native distinct sentence follows repeated rows.'), nativeBeforeSwitch);
  await x.evaluate(() => {
    window.nativePrefetchSamples = [];
    window.nativePrefetchObserver = new MutationObserver(() => {
      window.nativePrefetchSamples.push({at: performance.now(), original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent,
        translation: document.querySelector('#fluent-read-video-subtitle')?.textContent});
    });
    window.nativePrefetchObserver.observe(document.querySelector('[data-testid="videoPlayer"]'), {subtree: true, childList: true, characterData: true});
    document.querySelector('video').currentTime = 3.1;
  });
  await x.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：Native distinct sentence follows repeated rows.');
  const nativeSamples = await x.evaluate(() => {
    window.nativePrefetchObserver.disconnect();
    return window.nativePrefetchSamples.filter(s => s.original === 'Native distinct sentence follows repeated rows.');
  });
  const nativeTranslated = nativeSamples.find(s => s.translation === '译文：Native distinct sentence follows repeated rows.');
  report.nativeSubtitleLagMs = nativeTranslated ? nativeTranslated.at - nativeSamples[0].at : null;
  check('Native prefetched original and translation first appear together', nativeSamples.length > 0
    && nativeSamples[0].translation === '译文：Native distinct sentence follows repeated rows.', {lagMs: report.nativeSubtitleLagMs, samples: nativeSamples});
  await x.screenshot({path: path.join(artifacts, 'native-prefetched-bilingual.png')});
  await x.evaluate(() => {
    const video = document.querySelector('video'); video.currentTime = 0;
    const track = video.textTracks[0]; Array.from(track.cues).forEach(cue => track.removeCue(cue));
    track.addCue(new VTTCue(18, 19, 'Fast playback should prefetch this distant cue.'));
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await x.waitForTimeout(200);
  check('Normal-speed prefetch respects its ten-second window', !await worker.evaluate(() => globalThis.prefetchProofRequests.some(r => r.source === 'Fast playback should prefetch this distant cue.')));
  await x.evaluate(() => document.querySelector('video').playbackRate = 2);
  await x.waitForTimeout(200);
  check('Changing to double speed immediately expands the prefetch window', await worker.evaluate(() => globalThis.prefetchProofRequests.some(r => r.source === 'Fast playback should prefetch this distant cue.')));
  await x.waitForTimeout(600);
  await x.evaluate(() => {
    const video = document.querySelector('video'); video.currentTime = 0; video.playbackRate = 1;
    const track = video.textTracks[0]; Array.from(track.cues).forEach(cue => track.removeCue(cue));
    for (let i = 1; i <= 8; i += 1) track.addCue(new VTTCue(i, i + .5, `Old seek window sentence ${i}.`));
    track.addCue(new VTTCue(20, 21, 'The sought current caption has priority.'));
    track.addCue(new VTTCue(21, 22, 'The sought upcoming caption is prefetched.'));
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await x.waitForTimeout(100);
  await x.evaluate(() => document.querySelector('video').currentTime = 20.1);
  await x.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：The sought current caption has priority.');
  await x.waitForTimeout(650);
  const afterSeek = await worker.evaluate(() => globalThis.prefetchProofRequests);
  check('Seeking removes queued old prefetches and primes the new window', afterSeek.some(r => r.source === 'The sought upcoming caption is prefetched.')
    && !afterSeek.some(r => /^Old seek window sentence [3-8]\./.test(r.source)), afterSeek.filter(r => /seek window|sought/.test(r.source)));

  // Cold captions must also appear as a pair, including the first frame visible to the user.
  await x.evaluate(() => {
    const video = document.querySelector('video');
    const track = video.textTracks[0];
    Array.from(track.cues).forEach(cue => track.removeCue(cue));
    window.coldSamples = [];
    window.coldObserver = new MutationObserver(() => window.coldSamples.push({
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
    }));
    window.coldObserver.observe(document.querySelector('[data-testid="videoPlayer"]'), {subtree: true, childList: true, characterData: true});
    track.addCue(new VTTCue(10, 12, 'Cold caption waits for its matching translation.'));
    video.currentTime = 10.1;
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await x.waitForTimeout(200);
  const pendingPair = await x.evaluate(() => ({
    original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '',
    translation: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
  }));
  check('Untranslated X captions keep both display lines empty while waiting', pendingPair.original === '' && pendingPair.translation === '', pendingPair);
  await x.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：Cold caption waits for its matching translation.');
  const coldSamples = await x.evaluate(() => {window.coldObserver.disconnect(); return window.coldSamples;});
  const firstCold = coldSamples.find(sample => sample.original === 'Cold caption waits for its matching translation.');
  check('Cold original and translation first appear in the same DOM update', firstCold?.translation === '译文：Cold caption waits for its matching translation.', coldSamples);
  await x.screenshot({path: path.join(artifacts, 'native-cold-synchronized-bilingual.png')});
  await x.evaluate(() => {
    const video = document.querySelector('video');
    video.textTracks[0].addCue(new VTTCue(13, 14, 'Discard the late translation after a seek.'));
    video.currentTime = 13.1;
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await x.waitForTimeout(100);
  await x.evaluate(() => document.querySelector('video').currentTime = 15);
  await x.waitForTimeout(700);
  check('A late X translation cannot reappear during a caption gap', await x.evaluate(() =>
    !document.querySelector('#fluent-read-video-subtitle')?.textContent && !document.querySelector('#fluent-read-video-subtitle-original')?.textContent));

  const selectMode = async mode => {
    if (await x.locator('#fluent-read-video-subtitle-menu').isHidden()) await x.locator('#fluent-read-video-subtitle-button').click();
    await x.locator(`#fluent-read-video-subtitle-menu [data-mode="${mode}"]`).click();
  };
  await selectMode('original-only');
  await x.evaluate(() => {
    const video = document.querySelector('video');
    video.textTracks[0].addCue(new VTTCue(16, 17, 'Original-only captions need no translation.'));
    video.currentTime = 16.1;
  });
  await x.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-original')?.textContent === 'Original-only captions need no translation.');
  check('Original-only mode displays a cold caption without a provider request', !await worker.evaluate(() => globalThis.prefetchProofRequests.some(r => r.source === 'Original-only captions need no translation.')));
  await selectMode('bilingual');
  await x.evaluate(() => {
    const video = document.querySelector('video');
    video.textTracks[0].addCue(new VTTCue(18, 19, '这是无需翻译的中文字幕。'));
    video.currentTime = 18.1;
  });
  await x.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-original')?.textContent === '这是无需翻译的中文字幕。');
  check('Target-language subtitles show one original line without waiting', await x.evaluate(() => !document.querySelector('#fluent-read-video-subtitle')?.textContent));
  report.requests = await worker.evaluate(() => globalThis.prefetchProofRequests);
  report.success = report.checks.every(c => c.pass) && report.errors.length === 0;
  assert.equal(report.success, true, JSON.stringify(report.checks.filter(c => !c.pass)));
})().catch(error => {primaryError = error; report.failure = error.stack; process.exitCode = 1;}).finally(async () => {
  const cleanupErrors = [];
  const cleanup = async action => {
    try {await action();} catch (error) {cleanupErrors.push(error);}
  };
  let browserClosed = false;
  await cleanup(async () => {
    if (session) {await session.close(); browserClosed = true;}
  });
  await cleanup(() => {
    if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
    else if (!launchAttempted) {
      // No browser launch was attempted; only remove an empty initial profile.
      try {fs.rmdirSync(profileDir);} catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
      }
    }
  });
  if (cleanupErrors.length) {
    report.success = false;
    report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
  }
  await cleanup(() => {fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));});
  for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
  if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  console.log(JSON.stringify(report, null, 2));
}).catch(error => {console.error(error.stack || error); process.exitCode = 1;});
