/**
 * @file scripts/testing/video-ai-corpus.cjs
 * 文件职责：读取真实字幕质量基准的本地语料清单，固定音频身份和参考语言。
 * 主要内容：核对来源、相对路径、SHA与时长，把已授权音频转换为 16 kHz 单声道 PCM16，区分显式语言基线与自动检测。
 * 模块边界：不下载语料、不读取用户 profile、不执行模型；参考全文只用于内存计分，模型/分模块精度摘要不从旧 dtype 猜造。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {digestFile} = require('./model-cache-transfer.cjs');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function loadVideoAiCorpus(manifestFile, {ffmpeg = '/opt/homebrew/bin/ffmpeg', audioPaddingMs = 0} = {}) {
  assert.ok(Number.isSafeInteger(audioPaddingMs) && audioPaddingMs >= 0 && audioPaddingMs <= 10000, 'Invalid corpus audio padding');
  const realManifest = fs.realpathSync(manifestFile), root = path.dirname(realManifest);
  const manifestBytes = fs.readFileSync(realManifest), manifest = JSON.parse(manifestBytes);
  const samples = manifest.samples || manifest.entries;
  assert.ok(Array.isArray(samples) && samples.length > 0, 'Corpus manifest requires samples');
  const ids = new Set(), clips = [];
  for (const sample of samples) {
    assert.match(sample.id, /^[a-z0-9][a-z0-9._-]{0,63}$/i);
    assert.ok(!ids.has(sample.id), 'Duplicate corpus sample id'); ids.add(sample.id);
    assert.ok(typeof sample.reference === 'string' && sample.reference.trim(), 'Corpus sample needs a reference');
    assert.ok(sample.source && (typeof sample.source === 'string' || typeof sample.source === 'object'), 'Corpus sample needs source provenance');
    assert.ok(typeof sample.source === 'string' ? sample.source.trim() : Object.keys(sample.source).length > 0, 'Corpus source provenance must be meaningful');
    const languages = Array.isArray(sample.language) ? sample.language : [sample.language];
    assert.ok(languages.length > 0 && languages.every(language => typeof language === 'string' && (language === 'mixed' || /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(language))), 'Corpus language must describe its ground truth');
    assert.ok(Number.isFinite(sample.durationMs) && sample.durationMs > 0 && sample.durationMs <= 30000, 'Direct Worker corpus samples must be at most 30 seconds');
    assert.match(sample.sha256, /^[a-f0-9]{64}$/);
    assert.ok(typeof sample.file === 'string', 'Corpus sample needs a local file');
    const file = fs.realpathSync(path.resolve(root, sample.file));
    assert.ok(file.startsWith(root + path.sep), 'Corpus audio must remain inside its manifest directory');
    const actual = await digestFile(file);
    assert.equal(actual.sha256, sample.sha256, 'Corpus source SHA changed');
    if (sample.bytes !== undefined) assert.equal(actual.bytes, sample.bytes, 'Corpus source byte length changed');
    let spokenBytes;
    if (sample.format === 'pcm16le' || sample.format === 's16le') {
      assert.equal(sample.sampleRate ?? 16000, 16000, 'PCM corpus requires 16 kHz');
      assert.equal(sample.channels ?? 1, 1, 'PCM corpus requires mono');
      assert.ok(actual.bytes <= 30 * 32000, 'PCM corpus input exceeds 30 seconds');
      spokenBytes = fs.readFileSync(file);
    } else {
      assert.ok(actual.bytes <= 64 * 1024 * 1024, 'Encoded corpus sample exceeded its input bound');
      const result = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], {timeout: 30000, maxBuffer: 2 * 1024 * 1024});
      assert.equal(result.status, 0, `Corpus audio conversion failed: ${String(result.stderr)}`);
      spokenBytes = result.stdout;
    }
    assert.equal(spokenBytes.length % 2, 0, 'PCM16 body has a partial sample');
    const durationMs = spokenBytes.length / 32;
    assert.ok(Math.abs(durationMs - sample.durationMs) <= 50, 'Corpus decoded duration differs from its declared duration');
    const pcm16Sha256 = sha(spokenBytes);
    if (sample.pcm16Sha256) assert.equal(pcm16Sha256, sample.pcm16Sha256, 'Corpus derived PCM SHA changed');
    const padding = Buffer.alloc(audioPaddingMs * 32);
    const bytes = audioPaddingMs ? Buffer.concat([padding, spokenBytes, padding]) : spokenBytes;
    assert.ok(bytes.length <= 30 * 32000, 'Padded direct Worker sample exceeds 30 seconds');
    const explicitLanguages = sample.explicitLanguages || languages.filter(language => language !== 'mixed');
    assert.ok(Array.isArray(explicitLanguages) && explicitLanguages.every(language => /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(language)), 'Explicit baselines need language codes');
    const metric = sample.metric || (languages.some(language => ['zh', 'ja', 'ko', 'mixed'].includes(language.split(/[-_]/)[0])) ? 'cer' : 'wer');
    assert.ok(['cer', 'wer'].includes(metric), 'Corpus metric must be cer or wer');
    assert.ok((metric === 'wer' ? words : characters)(sample.reference).length > 0, 'Corpus reference has no scoreable units');
    assert.ok(Array.isArray(sample.models || ['tiny', 'base', 'small']) && (sample.models || ['tiny', 'base', 'small']).every(model => ['tiny', 'base', 'small'].includes(model)), 'Invalid corpus model selection');
    const streamGroup = sample.streamGroup || sample.languageSessionKey;
    if (streamGroup !== undefined) assert.match(streamGroup, /^[a-z0-9][a-z0-9._-]{0,63}$/i);
    const repeat = sample.repeat ?? 1;
    assert.ok(Number.isSafeInteger(repeat) && repeat > 0 && repeat <= 10, 'Sample repeat must be between 1 and 10');
    clips.push({id: sample.id, reference: sample.reference, explicitLanguages, language: sample.language, metric,
      source: sample.source, sourceSha256: sample.sha256, sourceBytes: actual.bytes, pcm16Sha256, inputPcm16Sha256: sha(bytes),
      referenceSha256: sha(Buffer.from(sample.reference)), audioPcm16Base64: bytes.toString('base64'),
      audioSeconds: bytes.length / 32000, spokenAudioSeconds: durationMs / 1000, models: sample.models || ['tiny', 'base', 'small'], natural: true, streamGroup, repeat});
  }
  return {manifestSha256: sha(manifestBytes), manifestFile: realManifest, clips};
}
function languageModes(clip, modes) {
  return [...new Set(modes.flatMap(mode => mode === 'explicit' ? clip.explicitLanguages : [mode]))];
}
function corpusCases(clips, modes, model) {
  return modes.flatMap(mode => clips.filter(clip => clip.models.includes(model)).flatMap(clip =>
    languageModes(clip, [mode]).flatMap(sourceLanguage => Array.from({length: clip.repeat || 1}, (_, repetition) =>
      ({clip, sourceLanguage, mode: sourceLanguage === 'auto' ? 'auto' : 'explicit', repetition,
        sessionKey: `${sourceLanguage}-${clip.streamGroup || clip.id}`})))));
}
function editMetric(reference, actual, tokenize) {
  const a = tokenize(reference), b = tokenize(actual);
  let row = Array.from({length: b.length + 1}, (_, index) => index);
  for (let index = 1; index <= a.length; index++) {
    const next = [index];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[index - 1] !== b[j - 1]));
    row = next;
  }
  return {errors: row[b.length], referenceUnits: a.length, actualUnits: b.length, rate: a.length ? row[b.length] / a.length : null};
}
const characters = value => Array.from(String(value).replace(/[\s\p{P}\p{S}]/gu, ''));
const words = value => String(value).toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim().split(/\s+/).filter(Boolean);
function scoreClip(clip, text) {return editMetric(clip.reference, text, clip.metric === 'wer' ? words : characters);}
function modelResultMetadata(requestedModel, result = {}) {
  assert.ok(['tiny', 'base', 'small'].includes(requestedModel), 'Unsupported benchmark model');
  const validDtype = value => ['fp32', 'q4', 'q8'].includes(value) ? value : null;
  const encoderDtype = validDtype(result.encoderDtype), decoderDtype = validDtype(result.decoderDtype);
  return {requestedModelId: 'onnx-community/whisper-' + requestedModel,
    actualModelId: result.model === requestedModel ? 'onnx-community/whisper-' + result.model : null,
    workerReportedModel: result.model ?? null, encoderDtype, decoderDtype,
    precisionReportedComplete: encoderDtype !== null && decoderDtype !== null,
    legacyDtype: result.dtype ?? null,
    expectedSmallPrecision: requestedModel === 'small' ? {encoder_model: 'fp32', decoder_model_merged: 'q4'} : undefined};
}
module.exports = {loadVideoAiCorpus, languageModes, corpusCases, scoreClip, characters, words, modelResultMetadata};
