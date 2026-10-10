/**
 * @file scripts/testing/model-cache-transfer.cjs
 * 文件职责：通过本机 HTTP 在隔离扩展页与已登记的公开 Whisper 文件之间传输缓存。
 * 主要内容：逐文件校验长度/SHA、限定 loopback/token/扩展 Origin，流式读取和落盘，关闭本任务连接并提供有界取消。
 * 模块边界：只服务清单中的公开模型，不启动浏览器、不更改扩展权限或模型下载登记，不把权重交给 CDP。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createHash, randomBytes} = require('node:crypto');
const {pipeline} = require('node:stream/promises');

const FILES = new Set(['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
  'onnx/encoder_model.onnx']);
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const SMALL_ENCODER_MAX_BYTES = 384 * 1024 * 1024;
const SUPPORTED_MODELS = ['tiny', 'base', 'small'];
function knownModelFile(url) {
  const match = String(url).match(/^https:\/\/modelscope\.cn\/models\/onnx-community\/whisper-(tiny|base|small)\/resolve\/master\/(.+)$/);
  return match && FILES.has(match[2]) ? {model: match[1], name: match[2]} : null;
}
// A larger bound is specific to the canonical Small FP32 encoder; no decoder/arbitrary file grows.
function modelFileMaxBytes(url) {
  const known = knownModelFile(url);
  if (!known) return 0;
  return known.model === 'small' && known.name === 'onnx/encoder_model.onnx' ? SMALL_ENCODER_MAX_BYTES : MAX_FILE_BYTES;
}
function modelSourceIdentity(entry) {
  const known = knownModelFile(entry.url);
  assert.ok(known, 'Only registered public Whisper URLs may be transferred');
  const modelId = 'onnx-community/whisper-' + known.model;
  for (const key of ['actualModelId', 'sourceModelId']) if (entry[key] !== undefined) assert.equal(entry[key], modelId, 'Cache scope must identify the actual canonical model');
  if (entry.controllerModelAlias !== undefined) assert.equal(entry.controllerModelAlias, known.model, 'Model aliases are not canonical cache sources');
  if (entry.sourceUrl !== undefined) {
    const name = known.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = String(entry.sourceUrl).match(new RegExp('^https://huggingface\\.co/onnx-community/whisper-' + known.model + '/resolve/(master|[a-f0-9]{40})/' + name + '$'));
    assert.ok(entry.sourceUrl === entry.url || source, 'Model source must be the matching canonical public model/file');
    if (entry.sourceRevision !== undefined) assert.equal(entry.sourceRevision, source ? source[1] : 'master', 'Model source revision disagrees with its URL');
  }
  if (known.model === 'small') {
    assert.equal(entry.sourceModelId, modelId, 'Small imports require explicit canonical source identity');
    assert.ok(typeof entry.sourceUrl === 'string', 'Small imports require a canonical source URL');
  }
  return known;
}
async function digestFile(file, signal) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file, {signal})) {bytes += chunk.length; hash.update(chunk);}
  return {bytes, sha256: hash.digest('hex')};
}
async function loadVerifiedModelCache(directory, {signal} = {}) {
  const root = fs.realpathSync(directory);
  const manifestFile = path.join(root, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestBytes);
  assert.ok(Array.isArray(manifest.entries), 'Model cache manifest must contain entries');
  const seen = new Set();
  const entries = [];
  for (const entry of manifest.entries) {
    const known = modelSourceIdentity(entry);
    assert.equal(entry.file, `${known.model}/${known.name}`, 'Cache filename must match its public URL');
    assert.ok(!seen.has(entry.url), 'Duplicate public model URL'); seen.add(entry.url);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= modelFileMaxBytes(entry.url), 'Invalid model byte length');
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    const localFile = fs.realpathSync(path.resolve(root, entry.file));
    assert.ok(localFile.startsWith(root + path.sep), 'Model cache file must not escape its directory');
    const stat = fs.statSync(localFile);
    assert.ok(stat.isFile(), 'Model cache entry must be a regular file');
    const actual = await digestFile(localFile, signal);
    assert.equal(actual.bytes, entry.bytes, 'Public model byte length changed');
    assert.equal(actual.sha256, entry.sha256, 'Public model digest changed');
    if (known.model === 'small' && known.name === 'config.json') {
      assert.ok(entry.bytes <= 2 * 1024 * 1024, 'Small config must be bounded JSON');
      const config = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      assert.equal(config.model_type, 'whisper', 'Small cache config must describe Whisper');
      assert.deepEqual([config.d_model, config.encoder_layers, config.decoder_layers], [768, 12, 12], 'Small cache must contain actual Small config rather than Base aliases');
    }
    const after = fs.statSync(localFile);
    assert.deepEqual([after.dev, after.ino, after.mtimeMs, after.size], [stat.dev, stat.ino, stat.mtimeMs, stat.size], 'Model file changed during verification');
    entries.push({...entry, localFile, identity: {dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size}});
  }
  return {manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), entries};
}
function extensionOrigin(control) {
  const url = new URL(control.url());
  assert.equal(url.protocol, 'chrome-extension:', 'Cache transfers must run in the extension origin');
  assert.match(url.host, /^[a-p]{32}$/);
  return `chrome-extension://${url.host}`;
}
async function startTransferServer({entries, origin, directory, signal, onFile} = {}) {
  assert.match(origin, /^chrome-extension:\/\/[a-p]{32}$/);
  assert.ok(Array.isArray(entries), 'Registered entries are required');
  for (const entry of entries) {
    const known = knownModelFile(entry.url);
    assert.ok(known, 'Transfer server only accepts registered public model URLs');
    if (directory) assert.equal(entry.file, `${known.model}/${known.name}`);
  }
  const token = randomBytes(24).toString('hex');
  const sockets = new Set(), streams = new Set(), jobs = new Set(), transfers = [];
  let port, closing = false;
  const handle = async (request, response) => {
    const fail = status => {response.writeHead(status); response.end();};
    if (closing || request.headers.host !== `127.0.0.1:${port}`) return fail(403);
    if (request.headers.origin && request.headers.origin !== origin) return fail(403);
    const match = request.url?.match(new RegExp(`^/${token}/(\\d+)$`));
    const index = match && Number(match[1]);
    const entry = match && entries[index];
    if (!entry) return fail(404);
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Model-Sha256');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', directory ? 'PUT, OPTIONS' : 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.writeHead(204); response.end(); return;
    }
    const startedAt = Date.now();
    let transfer;
    try {
      if (!directory && (request.method === 'GET' || request.method === 'HEAD')) {
        const stat = fs.statSync(entry.localFile);
        assert.deepEqual({dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size}, entry.identity, 'Verified model file changed before transfer');
        response.setHeader('Content-Type', entry.contentType || 'application/octet-stream');
        response.setHeader('Content-Length', entry.bytes);
        response.setHeader('X-Model-Sha256', entry.sha256);
        response.writeHead(200);
        if (request.method === 'HEAD') {response.end(); return;}
        const stream = fs.createReadStream(entry.localFile); streams.add(stream);
        try {await pipeline(stream, response);} finally {streams.delete(stream);}
        transfer = {url: entry.url, bytes: entry.bytes, sha256: entry.sha256, wallMs: Date.now() - startedAt};
      } else if (directory && request.method === 'PUT') {
        const declared = Number(request.headers['content-length']);
        assert.ok(Number.isSafeInteger(declared) && declared >= 0 && declared <= modelFileMaxBytes(entry.url), 'Export requires a bounded Content-Length');
        const file = path.resolve(directory, entry.file);
        assert.ok(file.startsWith(path.resolve(directory) + path.sep));
        fs.mkdirSync(path.dirname(file), {recursive: true});
        assert.ok(fs.realpathSync(path.dirname(file)).startsWith(fs.realpathSync(directory) + path.sep), 'Export path must not escape through a symlink');
        const temporary = file + '.' + token + '.part';
        const hash = createHash('sha256'); let bytes = 0;
        const output = fs.createWriteStream(temporary, {flags: 'wx'}); streams.add(output);
        try {
          const measured = async function* () {
            for await (const chunk of request) {
              bytes += chunk.length; assert.ok(bytes <= declared && bytes <= modelFileMaxBytes(entry.url), 'Export body exceeded its declared bound');
              hash.update(chunk); yield chunk;
            }
            assert.equal(bytes, declared, 'Export ended before its declared byte length');
          };
          await pipeline(measured(), output);
          fs.renameSync(temporary, file);
        } catch (error) {fs.rmSync(temporary, {force: true}); throw error;}
        finally {streams.delete(output);}
        transfer = {url: entry.url, file: entry.file, contentType: entry.contentType, bytes, sha256: hash.digest('hex'),
          sourceModelId: 'onnx-community/whisper-' + knownModelFile(entry.url).model, actualModelId: 'onnx-community/whisper-' + knownModelFile(entry.url).model, sourceUrl: entry.url, sourceRevision: 'master', wallMs: Date.now() - startedAt};
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(transfer));
      } else return fail(405);
      transfers.push(transfer); onFile?.(transfer);
    } catch (error) {
      if (!response.headersSent) {response.writeHead(500); response.end('Registered model transfer failed');}
      else response.destroy(error);
    }
  };
  const server = http.createServer((request, response) => {
    const job = handle(request, response); jobs.add(job);
    void job.finally(() => jobs.delete(job));
  });
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  port = server.address().port;
  let closePromise;
  const close = () => closePromise ||= (async () => {
    closing = true; signal?.removeEventListener('abort', close);
    const stopped = new Promise(resolve => server.close(resolve));
    for (const stream of streams) stream.destroy();
    for (const socket of sockets) socket.destroy();
    await stopped;
    await Promise.allSettled([...jobs]);
  })();
  if (signal?.aborted) {await close(); throw signal.reason || new Error('Model transfer aborted');}
  signal?.addEventListener('abort', close, {once: true});
  return {url: `http://127.0.0.1:${port}/${token}`, transfers, close};
}
async function seedModelCache(control, {directory, models = ['tiny', 'base'], signal, fileTimeoutMs = 120000, onFile, preflightOnly = false} = {}) {
  assert.ok(models.length > 0 && models.every(model => SUPPORTED_MODELS.includes(model)), 'Only tiny/base/small model caches are supported');
  assert.ok(Number.isSafeInteger(fileTimeoutMs) && fileTimeoutMs > 0, 'Transfer timeout must be positive');
  const verified = await loadVerifiedModelCache(directory, {signal});
  // Confirm extension-origin fetch/CacheStorage with a small JSON before any weight transfer.
  const eligible = verified.entries.filter(entry => models.includes(knownModelFile(entry.url).model)).sort((a, b) => a.bytes - b.bytes);
  const preflight = eligible.find(entry => knownModelFile(entry.url).name.endsWith('.json') && entry.bytes <= 2 * 1024 * 1024);
  assert.ok(preflight, 'A small registered JSON file is required for loopback preflight');
  const entries = preflightOnly ? [preflight] : [preflight, ...eligible.filter(entry => entry !== preflight)];
  const server = await startTransferServer({entries, origin: extensionOrigin(control), signal, onFile});
  const started = Date.now();
  try {
    const result = await control.evaluate(async ({entries, baseUrl, fileTimeoutMs}) => {
      if (!isSecureContext || !caches) throw new Error('Extension CacheStorage is unavailable');
      const cache = await caches.open('transformers-cache');
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index], controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Local model cache import timed out')), fileTimeoutMs);
        try {
          const response = await fetch(`${baseUrl}/${index}`, {signal: controller.signal});
          if (response.status !== 200 || response.type === 'opaque') throw new Error('Extension loopback fetch preflight/import failed');
          if (Number(response.headers.get('Content-Length')) !== entry.bytes || response.headers.get('X-Model-Sha256') !== entry.sha256) throw new Error('Verified local cache headers changed');
          await cache.put(entry.url, response);
          const cached = await cache.match(entry.url);
          if (!cached || Number(cached.headers.get('Content-Length')) !== entry.bytes) throw new Error('Model cache write was not confirmed');
        } finally {clearTimeout(timer); controller.abort();}
      }
      return {entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), cache: 'transformers-cache', origin: location.origin};
    }, {entries: entries.map(({url, bytes, sha256}) => ({url, bytes, sha256})), baseUrl: server.url, fileTimeoutMs});
    return {...result, directory, manifestSha256: verified.manifestSha256, wallMs: Date.now() - started, preflightOnly,
      preflight: {url: preflight.url, bytes: preflight.bytes, passed: true}, transport: 'loopback-http-response-to-extension-cache', files: server.transfers};
  } finally {await server.close();}
}
async function exportModelCache(control, {directory, models = ['tiny', 'base'], existingEntries = [], fileTimeoutMs = 120000, signal} = {}) {
  assert.ok(models.length > 0 && models.every(model => SUPPORTED_MODELS.includes(model)), 'Only tiny/base/small model caches are supported');
  assert.ok(Number.isSafeInteger(fileTimeoutMs) && fileTimeoutMs > 0, 'Transfer timeout must be positive');
  const cached = await control.evaluate(async () => (await (await caches.open('transformers-cache')).keys()).map(request => request.url));
  const entries = cached.flatMap(url => {
    const known = knownModelFile(url);
    return known && models.includes(known.model) && !existingEntries.some(entry => entry.url === url)
      ? [{url, file: `${known.model}/${known.name}`, contentType: known.name.endsWith('.json') ? 'application/json' : 'application/octet-stream', maxBytes: modelFileMaxBytes(url)}] : [];
  });
  if (!entries.length) return [];
  const server = await startTransferServer({entries, origin: extensionOrigin(control), directory, signal});
  try {
    await control.evaluate(async ({entries, baseUrl, fileTimeoutMs}) => {
      const cache = await caches.open('transformers-cache');
      for (let index = 0; index < entries.length; index++) {
        const response = await cache.match(entries[index].url);
        if (!response) throw new Error('Registered public model cache entry disappeared');
        const controller = new AbortController(), reader = response.body?.getReader();
        const timer = setTimeout(() => controller.abort(new Error('Local model cache export timed out')), fileTimeoutMs);
        let streamController, bytes = 0, bodyReadPending = true;
        const abortRead = () => {
          if (!bodyReadPending) return;
          bodyReadPending = false;
          void reader?.cancel(controller.signal.reason).catch(() => {});
          streamController?.error(controller.signal.reason);
        };
        controller.signal.addEventListener('abort', abortRead, {once: true});
        try {
          const declared = response.headers.get('Content-Length');
          if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) < 0 || Number(declared) > entries[index].maxBytes)) throw new Error('Cached model header exceeds its registered byte bound');
          if (!reader) throw new Error('Cached model body is unavailable');
          // A bounded native Blob travels through HTTP, rather than a base64 string through CDP.
          // Counting the cached stream also bounds missing/misleading Content-Length and cancels pending reads.
          const bounded = new ReadableStream({
            start(active) {streamController = active;},
            async pull(active) {
              try {
                const next = await reader.read();
                if (controller.signal.aborted) throw controller.signal.reason;
                if (next.done) {bodyReadPending = false; active.close(); return;}
                bytes += next.value.byteLength;
                if (bytes > entries[index].maxBytes) throw new Error('Cached model body exceeded its registered byte bound');
                active.enqueue(next.value);
              } catch (error) {
                await reader.cancel(error).catch(() => {});
                if (bodyReadPending) {bodyReadPending = false; active.error(error);}
              }
            },
            cancel(reason) {return reader.cancel(reason);},
          });
          const body = await new Response(bounded).blob();
          if (declared !== null && body.size !== Number(declared)) throw new Error('Cached model body disagrees with its declared byte length');
          const sent = await fetch(`${baseUrl}/${index}`, {method: 'PUT', body, signal: controller.signal});
          if (!sent.ok) throw new Error('Public model cache export failed');
          await sent.json();
        } finally {
          bodyReadPending = false; clearTimeout(timer); controller.signal.removeEventListener('abort', abortRead);
          await reader?.cancel().catch(() => {}); controller.abort();
        }
      }
    }, {entries, baseUrl: server.url, fileTimeoutMs});
    return server.transfers.map(({wallMs, ...entry}) => entry);
  } finally {await server.close();}
}
module.exports = {knownModelFile, modelFileMaxBytes, modelSourceIdentity, loadVerifiedModelCache, startTransferServer, seedModelCache, exportModelCache, digestFile};
