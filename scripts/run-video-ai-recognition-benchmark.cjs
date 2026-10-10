#!/usr/bin/env node
/**
 * @file scripts/run-video-ai-recognition-benchmark.cjs
 * 文件职责：在隔离浏览器中比较真实 Whisper 的语音质量、语言检测和执行成本。
 * 主要内容：支持旧合成样本和 SHA 固定的自然/混合语种清单，通过 loopback HTTP 导入公开模型，分别记录准备、检测、推理与 RPC 时延。
 * 模块边界：只驱动生产后台消息和拥有的临时浏览器，不改模型参数、生产权限或用户 profile；自然语料报告省去参考全文和音频。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');
const {loadVerifiedModelCache, seedModelCache, exportModelCache: exportRegisteredModelCache} = require('./testing/model-cache-transfer.cjs');
const {loadVideoAiCorpus, corpusCases, scoreClip, modelResultMetadata} = require('./testing/video-ai-corpus.cjs');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper');
const validateOnly = process.argv.includes('--validate-only');
if (!validateOnly && (!runtime || !helperPath)) throw new Error('Explicit isolated Playwright runtime and focus-safe helper are required');
const chromium = validateOnly ? null : createRequire(path.join(runtime, 'asr-benchmark.cjs'))('playwright').chromium;
const helper = validateOnly ? null : require(path.resolve(helperPath));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-asr-benchmark'));
fs.mkdirSync(artifacts, {recursive: true});
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-asr-benchmark-'));
const profileDir = path.join(temporary, 'profile');
const stagedExtension = path.join(temporary, 'extension');
const versions = [{name: arg('version-label', 'baseline'), source: path.resolve(arg('extension-dir', '.output/chrome-mv3')), sourceCommit: arg('source-commit')}];
if (arg('next-extension-dir')) versions.push({name: 'fixed', source: path.resolve(arg('next-extension-dir')), sourceCommit: arg('next-source-commit')});
const models = arg('models', 'tiny,base').split(',');
assert.ok(models.length > 0 && models.every(model => ['tiny', 'base', 'small'].includes(model)), 'Supported models are tiny, base and explicit small');
const corpusManifest = arg('corpus-manifest');
const languages = arg('languages', corpusManifest ? 'explicit,auto' : 'zh-Hans,auto').split(',');
assert.ok(languages.length > 0 && languages.every(language => ['explicit', 'auto'].includes(language) || /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(language)), 'Invalid language modes');
const cacheDir = arg('model-cache-dir') ? path.resolve(arg('model-cache-dir')) : null;
const exportCacheDir = arg('export-model-cache-dir') ? path.resolve(arg('export-model-cache-dir')) : null;
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const extensionInstall = arg('extension-install', browserPath.includes('Google Chrome') ? 'cdp' : 'flags');
assert.ok(['flags', 'cdp'].includes(extensionInstall), 'Extension installation must be flags or cdp');
const installWithCdp = extensionInstall === 'cdp';
const uconv = arg('uconv', '/opt/homebrew/opt/icu4c/bin/uconv');
const prepareTimeoutMs = Number(arg('prepare-timeout-ms', '120000'));
const inferenceTimeoutMs = Number(arg('inference-timeout-ms', '45000'));
const audioPaddingMs = Number(arg('audio-padding-ms', '0'));
const silenceProbe = process.argv.includes('--silence-probe');
const assertSilenceGate = process.argv.includes('--assert-silence-gate');
const assertPaddingOffset = process.argv.includes('--assert-padding-offset');
const cachePreflightOnly = process.argv.includes('--cache-preflight-only');
assert.ok(!cachePreflightOnly || cacheDir, 'Cache preflight requires --model-cache-dir');
assert.ok(Number.isSafeInteger(audioPaddingMs) && audioPaddingMs >= 0 && audioPaddingMs <= 10000, 'Audio padding must be between 0 and 10000ms');
for (const timeout of [prepareTimeoutMs, inferenceTimeoutMs]) assert.ok(Number.isSafeInteger(timeout) && timeout > 0, 'Timeouts must be positive integers');
const texts = [
  {reference: '我挟天子以令诸侯，天下都给我让道。', rate: '190'},
  {reference: '我们正在测试中文视频字幕，识别结果应该保持完整，不要重复。', rate: '190'},
  {reference: '今天我们测试自动生成视频字幕。中文识别需要正确判断语言，完整保留每一句对白，遇到背景音乐也不要输出大量重复文字。', rate: '260'},
];
function command(program, args, options = {}) {
  const result = spawnSync(program, args, options);
  if (result.status !== 0) throw new Error(`${program}: ${String(result.stderr)}`);
  return result.stdout;
}
function syntheticClips() {return texts.map(({reference, rate}, index) => {
  const file = path.join(temporary, `chinese-${index}.aiff`);
  command('/usr/bin/say', ['-v', arg('voice', 'Tingting'), '-r', rate, '-o', file, reference]);
  const spokenBytes = command(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const padding = Buffer.alloc(audioPaddingMs * 32);
  const bytes = audioPaddingMs ? Buffer.concat([padding, spokenBytes, padding]) : spokenBytes;
  return {id: `synthetic-mandarin-${index}`, reference, explicitLanguages: ['zh-Hans'], metric: 'cer', models,
    source: {kind: 'synthetic', voice: arg('voice', 'Tingting'), rate}, language: 'zh',
    pcm16Sha256: createHash('sha256').update(spokenBytes).digest('hex'), inputPcm16Sha256: createHash('sha256').update(bytes).digest('hex'),
    audioPcm16Base64: bytes.toString('base64'), audioSeconds: bytes.length / 32000, spokenAudioSeconds: spokenBytes.length / 32000};
});}
let clips;
const report = {success: false, startedAt: new Date().toISOString(), evidence: cachePreflightOnly ? 'A registered public model JSON fetched and cached from a real extension origin; no ASR' : corpusManifest ? 'Real production Whisper on a SHA-fixed local corpus; automatic and explicit modes are separate, no live X audio' : 'Real Whisper on three synthetic Mandarin clips; raw CER excludes punctuation but counts simplified/traditional differences; no live X audio', models, languages, audioPaddingMs, silenceProbe, prepareTimeoutMs, inferenceTimeoutMs, extensionInstall: installWithCdp ? 'cdp' : 'flags', modelCache: null, results: [], phases: [],
  scriptSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  directWorkerWindowSeconds: 30, scopeLimit: 'Direct Worker samples can exceed production capture windows (10/14s); this matrix does not accept live X capture or translation'};
const persist = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
const phase = (name, details = {}) => {report.phase = name; report.phases.push({name, at: new Date().toISOString(), ...details}); persist(); console.log(JSON.stringify({phase: name, ...details}));};
let session;
let launchAttempted = false;
let cacheManifest = {entries: []};
async function importModelCache(control, context) {
  if (!cacheDir) return;
  await context.route(/^https:\/\/(?:modelscope\.cn\/models|huggingface\.co|hf-mirror\.com)\/.*whisper-(?:tiny|base|small)\//, route => {
    (report.unexpectedModelNetwork ||= []).push(route.request().url()); return route.abort('blockedbyclient');
  });
  return seedModelCache(control, {directory: cacheDir, models, preflightOnly: cachePreflightOnly, onFile: entry => phase('cache-file-imported', {url: entry.url, bytes: entry.bytes, sha256: entry.sha256, wallMs: entry.wallMs})});
}
async function rpc(control, message, timeoutMs) {
  const counts = report.rpcCounts ||= {}; counts[message.type] = (counts[message.type] || 0) + 1;
  return control.evaluate(({message, timeoutMs}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Production RPC timed out: ' + message.type)), timeoutMs);
    chrome.runtime.sendMessage(message).then(resolve, reject).finally(() => clearTimeout(timer));
  }), {message, timeoutMs});
}
function assertRpc(result, stage) {
  assert.equal(result?.success, true, `${stage}: ${result?.error || 'No successful production response'}`);
}
function resultSummary(result, requestedModel = result.model) {
  return {success: result.success, model: result.model, models: result.models, backend: result.backend, dtype: result.dtype, available: result.available,
    ...(requestedModel ? modelResultMetadata(requestedModel, result) : {})};
}
function assertSmallIdentity(result, model) {
  if (model !== 'small') return;
  assert.equal(result.model, 'small', 'Small must use its actual production model id, never a Base alias');
  assert.equal(result.encoderDtype, 'fp32', 'Actual Small encoder precision must be reported');
  assert.equal(result.decoderDtype, 'q4', 'Actual Small decoder precision must be reported');
}
async function exportModelCache(control) {
  if (!exportCacheDir) return;
  fs.mkdirSync(exportCacheDir, {recursive: true});
  cacheManifest.entries.push(...await exportRegisteredModelCache(control, {directory: exportCacheDir, models, existingEntries: cacheManifest.entries}));
  fs.writeFileSync(path.join(exportCacheDir, 'manifest.json'), JSON.stringify(cacheManifest, null, 2));
}
async function main() {
  phase('input-preflight');
  if (cacheDir) {
    const verified = await loadVerifiedModelCache(cacheDir);
    report.modelCache = {source: cacheDir, manifestSha256: verified.manifestSha256, entries: verified.entries.map(({localFile, identity, ...entry}) => entry)};
  }
  if (exportCacheDir && fs.existsSync(path.join(exportCacheDir, 'manifest.json'))) cacheManifest.entries = (await loadVerifiedModelCache(exportCacheDir)).entries.map(({localFile, identity, ...entry}) => entry);
  if (corpusManifest) {
    const corpus = await loadVideoAiCorpus(path.resolve(corpusManifest), {ffmpeg: arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), audioPaddingMs});
    clips = corpus.clips;
    report.corpus = {manifestFile: corpus.manifestFile, manifestSha256: corpus.manifestSha256, samples: clips.map(({reference, audioPcm16Base64, ...metadata}) => metadata)};
  } else if (!cachePreflightOnly) clips = syntheticClips(); else clips = [];
  report.casePlan = models.flatMap(model => corpusCases(clips, languages, model).map(({clip, sourceLanguage, mode, repetition, sessionKey}) => ({model, sampleId: clip.id, sourceLanguage, mode, repetition, sessionKey})));
  phase('inputs-validated', {samples: clips.length});
  if (validateOnly) {report.success = true; report.browserLaunched = false; report.scope = 'Input manifest, model file identities and case planning only; no browser or ASR executed'; return;}
  for (const version of versions) {
    fs.rmSync(stagedExtension, {recursive: true, force: true});
    fs.cpSync(version.source, stagedExtension, {recursive: true});
    launchAttempted = true;
    phase('browser-launch', {version: version.name});
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath,
      headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
      browserArgs: [...(installWithCdp ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${stagedExtension}`, `--load-extension=${stagedExtension}`]), '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    report.browserLaunched = true;
    report[version.name] = {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement};
    const {context} = session;
    report[version.name].extensionWorkerSha256 = createHash('sha256').update(fs.readFileSync(path.join(version.source, 'videoTranscriptionWorker.js'))).digest('hex');
    report[version.name].extensionSource = version.source;
    report[version.name].sourceCommit = version.sourceCommit || null;
    report[version.name].browserVersion = context.browser().version();
    let extensionId;
    if (installWithCdp) {
      const install = await context.browser().newBrowserCDPSession();
      try {extensionId = (await install.send('Extensions.loadUnpacked', {path: stagedExtension})).id;} finally {await install.detach();}
    }
    const isProduct = worker => worker.url().endsWith('/background.js') && (!extensionId || new URL(worker.url()).host === extensionId);
    const worker = context.serviceWorkers().find(isProduct) || await context.waitForEvent('serviceworker', {predicate: isProduct});
    const control = await helper.newPageWithoutForeground(context);
    await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    report[version.name].gpuCapability = await control.evaluate(async () => {
      if (!navigator.gpu) return {available: false};
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return {available: false};
      const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
      return {available: true, isFallbackAdapter: adapter.isFallbackAdapter ?? null, vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description};
    });
    phase('cache-import', {version: version.name});
    report[version.name].cacheSeed = await importModelCache(control, context);
    phase('cache-import-complete', {version: version.name});
    const cdp = await context.browser().newBrowserCDPSession();
    const cpu = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
    const browserPid = (await cpu()).find(process => process.type === 'browser').id;
    const assertBackground = () => {
      const current = JSON.parse(command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit');const a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier)});"], {encoding: 'utf8'}));
      assert.notEqual(current.pid, browserPid, 'Owned benchmark browser must stay behind the user application');
      (report[version.name].focusChecks ||= []).push(current);
    };
    assertBackground();
    if (cachePreflightOnly) {
      report[version.name].cacheDom = await control.evaluate(() => ({url: location.href, secureContext: isSecureContext,
        documentReadyState: document.readyState, popupMounted: Boolean(document.body?.textContent?.trim())}));
      await control.screenshot({path: path.join(artifacts, 'cache-preflight.png')});
    }
    if (!cachePreflightOnly) for (const model of models) {
      if (silenceProbe) {
        const started = Date.now();
        const streamId = 'benchmark-silence-' + model;
        const result = await rpc(control, {type: 'fluentReadTranscribeLocalVideoAudio', model, streamId, generation: 1,
          sourceLanguage: 'auto', audioPcm16Base64: Buffer.alloc(6 * 32000).toString('base64')}, inferenceTimeoutMs);
        assertRpc(result, 'Silence probe');
        if (assertSilenceGate) {
          assert.equal(result.text, '', 'Digital silence must not produce subtitles');
          assert.deepEqual(result.segments, [], 'Digital silence must not produce timed segments');
          assert.equal(result.inferenceMs, 0, 'Digital silence must avoid model inference');
        }
        (report.silenceProbes ||= []).push({version: version.name, model, audioSeconds: 6, wallMs: Date.now() - started,
          textEmpty: result.text === '', segmentCount: result.segments?.length, inferenceMs: result.inferenceMs, ...resultSummary(result, model)});
        await rpc(control, {type: 'fluentReadCancelLocalVideoTranscription', streamId, generation: 1, reason: 'complete'}, 10000);
      }
      phase('model-cache-prepare', {version: version.name, model});
      const prepareAt = Date.now();
      const prepared = await rpc(control, {type: 'fluentReadPrepareLocalVideoModel', model, keepWarm: false}, prepareTimeoutMs);
      assertRpc(prepared, 'Model cache preparation');
      const modelReport = {version: version.name, model, prepareMs: Date.now() - prepareAt, prepared: resultSummary(prepared, model), runs: []};
      report.results.push(modelReport);
      const registry = await rpc(control, {type: 'fluentReadGetLocalVideoModelState'}, 10000);
      assertRpc(registry, 'Authoritative model registry');
      modelReport.registeredModelState = resultSummary(registry);
      assert.equal(registry.available?.[model], true, 'Prepared model must be registered by production');
      await exportModelCache(control);
      phase('model-session-prepare', {version: version.name, model});
      const warmStreamId = 'benchmark-session-prepare-' + model;
      const warmAt = Date.now();
      try {
        const warm = await rpc(control, {type: 'fluentReadPrepareLocalVideoModel', model, keepWarm: true,
          streamId: warmStreamId, generation: 1}, prepareTimeoutMs);
        assertRpc(warm, 'ONNX session preparation');
        assertSmallIdentity(warm, model);
        modelReport.sessionPrepare = {wallMs: Date.now() - warmAt, ...resultSummary(warm, model), gpuInfo: warm.gpuInfo, threads: warm.threads};
      } finally {
        await rpc(control, {type: 'fluentReadCancelLocalVideoTranscription', streamId: warmStreamId, generation: 1, reason: 'complete'}, 10000);
      }
      const cases = corpusCases(clips, languages, model);
      assert.ok(cases.length, 'No corpus cases selected for ' + model);
      let activeStream, needsSessionPrepare = false;
      const keepCaseFailure = (error, stage, {clip, sourceLanguage, mode, repetition}, elapsedMs) => {
        const failure = {success: false, sampleId: clip.id, sourceLanguage, mode, repetition, streamGroup: clip.streamGroup || null,
          audioSeconds: clip.audioSeconds, inputPcm16Sha256: clip.inputPcm16Sha256, stage, error: String(error.message || error),
          wallMs: elapsedMs, backend: modelReport.sessionPrepare?.backend || null, dtype: modelReport.sessionPrepare?.dtype || null,
          backendFromPriorPrepare: true, encoderDtype: modelReport.sessionPrepare?.encoderDtype ?? null, decoderDtype: modelReport.sessionPrepare?.decoderDtype ?? null, requestedModelId: 'onnx-community/whisper-' + model, score: null};
        modelReport.runs.push(failure);
        phase('case-failed', {version: version.name, model, ...failure});
      };
      try {
        for (let index = 0; index < cases.length; index++) {
          const {clip, sourceLanguage, mode, repetition, sessionKey} = cases[index];
          const streamId = 'benchmark-' + model + '-' + createHash('sha256').update(sessionKey).digest('hex').slice(0, 24);
          if (activeStream && activeStream !== streamId) await rpc(control,
            {type: 'fluentReadCancelLocalVideoTranscription', streamId: activeStream, generation: 1, reason: 'complete'}, 10000);
          activeStream = streamId;
          assertBackground();
          if (needsSessionPrepare) {
            const recoveryAt = Date.now();
            try {
              const warm = await rpc(control, {type: 'fluentReadPrepareLocalVideoModel', model, keepWarm: true, streamId, generation: 1}, prepareTimeoutMs);
              assertRpc(warm, 'Recovery ONNX session preparation');
              assertSmallIdentity(warm, model);
              (modelReport.recoverySessionPrepares ||= []).push({sampleId: clip.id, sourceLanguage, wallMs: Date.now() - recoveryAt, ...resultSummary(warm, model)});
              needsSessionPrepare = false;
            } catch (error) {
              keepCaseFailure(error, 'recovery-session-prepare', cases[index], Date.now() - recoveryAt);
              if (control.isClosed()) throw error;
              await rpc(control, {type: 'fluentReadCancelLocalVideoTranscription', streamId, generation: 1, reason: 'cancel'}, 10000);
              activeStream = undefined; continue;
            }
          }
          phase('transcribe', {version: version.name, model, sampleId: clip.id, sourceLanguage, repetition, streamGroup: clip.streamGroup || null});
          const before = await cpu();
          const rss = processes => Number(command('/bin/ps', ['-o', 'rss=', '-p', processes.map(x => x.id).join(',')], {encoding: 'utf8'}).trim().split(/\s+/).reduce((sum, value) => sum + (Number(value) || 0), 0));
          const initialRssKb = rss(before);
          let peakRssKb = initialRssKb;
          const sample = setInterval(async () => {try {peakRssKb = Math.max(peakRssKb, rss(await cpu()));} catch {}}, 500);
          let result, wallMs, caseError;
          const started = Date.now();
          try {
            result = await rpc(control, {type: 'fluentReadTranscribeLocalVideoAudio', streamId, generation: 1, model,
              sourceLanguage, audioPcm16Base64: clip.audioPcm16Base64}, inferenceTimeoutMs);
            wallMs = Date.now() - started;
            assertRpc(result, 'Transcription');
            assertSmallIdentity(result, model);
            if (audioPaddingMs && assertPaddingOffset && result.segments?.length) assert.ok(result.segments.every(segment =>
              segment.startMs >= audioPaddingMs - 200 && segment.endMs <= clip.audioSeconds * 1000 - audioPaddingMs + 200),
              'Padded speech timestamps must restore the original audio offset');
          } catch (error) {caseError = error; wallMs = Date.now() - started;}
          finally {clearInterval(sample);}
          if (caseError) {
            keepCaseFailure(caseError, 'transcription', cases[index], wallMs);
            if (control.isClosed()) throw caseError;
            // A failed RPC cannot lend its pending inference or language lock to a later case.
            await rpc(control, {type: 'fluentReadCancelLocalVideoTranscription', streamId, generation: 1, reason: 'cancel'}, 10000);
            activeStream = undefined; needsSessionPrepare = true; continue;
          }
          const after = await cpu(), beforeCpu = new Map(before.map(x => [x.id, x.cpuTime]));
          const metric = scoreClip(clip, result.text);
          let normalizedScore;
          const chinese = (Array.isArray(clip.language) ? clip.language : [clip.language]).some(language => language.split(/[-_]/)[0] === 'zh');
          if (chinese && clip.metric === 'cer' && fs.existsSync(uconv)) {
            const normalizedReference = command(uconv, ['-x', 'Traditional-Simplified'], {input: clip.reference, encoding: 'utf8'});
            const normalizedText = command(uconv, ['-x', 'Traditional-Simplified'], {input: result.text || '', encoding: 'utf8'});
            normalizedScore = {transform: 'ICU Traditional-Simplified (evaluation only)', ...scoreClip({...clip, reference: normalizedReference}, normalizedText)};
          }
          const detectedLanguage = typeof result.detectedLanguage === 'string' ? result.detectedLanguage : null;
          const expectedLanguages = (Array.isArray(clip.language) ? clip.language : [clip.language]).filter(language => language !== 'mixed').map(language => language.toLowerCase().split(/[-_]/)[0]);
          const run = {success: true, sampleId: clip.id, mode, sourceLanguage, repetition, streamGroup: clip.streamGroup || null, independentLanguageSession: !clip.streamGroup,
            expectedLanguages, detectedLanguage, languageCorrect: mode === 'auto' && detectedLanguage && expectedLanguages.length === 1 ? expectedLanguages.includes(detectedLanguage.split(/[-_]/)[0]) : null,
            multiLanguageGroundTruth: expectedLanguages.length > 1, languageEvaluation: detectedLanguage ? 'dominant-language-only; not code-switch coverage' : 'unknown; Worker did not expose detection metadata',
            languageConfidence: result.languageConfidence ?? null, languageDetectionMs: result.languageDetectionMs ?? null, encoderReuse: result.encoderReuse ?? null,
            audioSeconds: clip.audioSeconds, spokenAudioSeconds: clip.spokenAudioSeconds, inputPcm16Sha256: clip.inputPcm16Sha256,
            productionWindowSeconds: model === 'tiny' ? 10 : 14, fitsProductionWindow: clip.audioSeconds <= (model === 'tiny' ? 10 : 14),
            wallMs, realTimeFactor: wallMs / 1000 / clip.audioSeconds, inferenceMs: result.inferenceMs ?? null,
            inferenceRealTimeFactor: Number.isFinite(result.inferenceMs) ? result.inferenceMs / 1000 / clip.audioSeconds : null,
            detectionIncludedInInferenceMs: result.languageDetectionMs !== undefined ? true : null, decodeMs: result.decodeMs ?? null,
            firstInferenceAfterSessionPrepare: index === 0, backend: result.backend, dtype: result.dtype, ...modelResultMetadata(model, result),
            textSha256: createHash('sha256').update(result.text || '').digest('hex'), metric: clip.metric, score: metric, normalizedScore,
            segmentCount: result.segments?.length || 0, segmentRangeMs: result.segments?.length ? [result.segments[0].startMs, result.segments.at(-1).endMs] : null,
            resources: {initialBrowserRssMb: initialRssKb / 1024, peakBrowserRssMb: peakRssKb / 1024,
              cpuSeconds: after.reduce((sum, x) => sum + Math.max(0, x.cpuTime - (beforeCpu.get(x.id) || 0)), 0)}};
          // Preserve legacy synthetic report fields; natural reference/transcript/body stay out of the report.
          if (!clip.natural) Object.assign(run, {reference: clip.reference, text: result.text, segments: result.segments,
            cer: {errors: metric.errors, characters: metric.referenceUnits, rate: metric.rate}});
          modelReport.runs.push(run);
          assertBackground(); phase('transcribe-complete', {version: version.name, model, sampleId: clip.id, sourceLanguage, wallMs,
            detectedLanguage, languageDetectionMs: run.languageDetectionMs, inferenceMs: run.inferenceMs, metric: clip.metric, score: metric});
        }
      } finally {
        if (activeStream) await rpc(control, {type: 'fluentReadCancelLocalVideoTranscription', streamId: activeStream, generation: 1, reason: 'complete'}, 10000);
      }
    }
    assertBackground();
    await cdp.detach();
    await session.close();
    report[version.name].guardedCloseSucceeded = true;
    session = null;
    launchAttempted = false;
  }
  report.success = true;
  report.scope = cachePreflightOnly ? 'extension-origin-loopback-cache-preflight-only; no ASR executed' : 'real production cache preparation, ONNX session, and Worker transcription; no live X media';
}
main().catch(error => {report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;}).finally(async () => {
  let closed = !launchAttempted;
  try {if (session) {await session.close(); closed = true; report.guardedCloseSucceeded = true;}} catch (error) {report.success = false; report.cleanupError = error.stack || String(error); process.exitCode = 1;}
  if (closed) fs.rmSync(temporary, {recursive: true, force: true});
  else report.retainedTemporaryDirectory = temporary;
  if (exportCacheDir) report.exportedModelCache = {directory: exportCacheDir, entries: cacheManifest.entries.map(entry => ({...entry}))};
  const runs = report.results.flatMap(model => model.runs);
  report.allCasesSucceeded = cachePreflightOnly || validateOnly ? null : report.success && runs.length > 0 && runs.length === report.casePlan.length * versions.length && runs.every(run => run.success === true);
  report.failureCounts = {cases: runs.filter(run => run.success !== true).length, byStage: runs.filter(run => run.success !== true).reduce((counts, run) => ({...counts, [run.stage]: (counts[run.stage] || 0) + 1}), {})};
  report.completedCases = runs.length;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, error: report.error, artifacts}));
});
