#!/usr/bin/env node
/**
 * @file scripts/testing/video-ai-benchmark-smoke.cjs
 * 文件职责：不启动浏览器地验证模型 loopback 传输和语料计分驱动。
 * 主要内容：使用自产小 JSON、8 MiB 二进制和静音 PCM，检查 SHA/Origin/token、流式取消/导出、显式与自动语言会话。
 * 模块边界：只创建自己的临时文件和本机 HTTP，不读取真实模型或音频、不连接公网、不触碰用户 profile。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const helpers = require('./model-cache-transfer.cjs');
const corpus = require('./video-ai-corpus.cjs');
const vm = require('node:vm');
async function runBenchmarkSmoke() {
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-transfer-smoke-'));
const origin = 'chrome-extension://' + 'a'.repeat(32);
const report = {success:false, checks:[]};
const pass = name => report.checks.push(name);
const entry = (file, body) => {
  fs.mkdirSync(path.dirname(path.join(folder,file)),{recursive:true});fs.writeFileSync(path.join(folder,file),body);
  const model=file.split('/')[0],url='https://modelscope.cn/models/onnx-community/whisper-'+model+'/resolve/master/'+file.slice(model.length+1);
  return {url,file,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex'),
    ...(model==='small'?{sourceModelId:'onnx-community/whisper-small',actualModelId:'onnx-community/whisper-small',sourceUrl:url,sourceRevision:'master'}:{})};
};
const entries = [entry('tiny/config.json',Buffer.from('{"model_type":"whisper"}')),entry('tiny/onnx/encoder_model_q4.onnx',Buffer.alloc(8*1024*1024,17))];
fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({entries}));
const bodyStore = new Map();
const cacheStorage={open:async() => ({put: async(url,response)=>bodyStore.set(url,{body:Buffer.from(await response.arrayBuffer()),headers:Object.fromEntries(response.headers)}),match:async url=>bodyStore.has(url)?new Response(bodyStore.get(url).body,{headers:bodyStore.get(url).headers}):undefined,keys:async()=>[...bodyStore.keys()].map(url=>({url}))})};
const argumentsSizes=[];
const control = {url:()=>origin+'/popup.html', evaluate:async (fn,args)=>{if(args)argumentsSizes.push(Buffer.byteLength(JSON.stringify(args)));return vm.runInNewContext('(' + fn.toString() + ')(input)', {input:args, fetch, Response, ReadableStream, AbortController, setTimeout, clearTimeout, isSecureContext:true, location:{origin}, caches:cacheStorage});}};
try {
  const verified=await helpers.loadVerifiedModelCache(folder);assert.equal(verified.entries.length,2);pass('preverify-length-sha');
  const server=await helpers.startTransferServer({entries:verified.entries,origin});
  try {
    const get=await fetch(server.url+'/0',{headers:{Origin:origin}});assert.equal(get.status,200);assert.equal(get.headers.get('access-control-allow-origin'),origin);assert.equal(await get.text(),'{"model_type":"whisper"}');pass('loopback-real-http-extension-origin-cors');
    assert.equal((await fetch(server.url+'/0',{headers:{Origin:'https://evil.invalid'}})).status,403);pass('wrong-origin-denied');
    assert.equal((await fetch(server.url.replace(/\/[a-f0-9]+$/,'/wrong')+'/0')).status,404);pass('wrong-token-denied');
    assert.equal((await fetch(server.url+'/9')).status,404);pass('unregistered-route-denied');
    const stream=await fetch(server.url+'/1');const read=stream.body.getReader();assert.equal((await read.read()).done,false);await read.cancel();pass('large-response-stream-abort');
  } finally {await server.close();}
  const seeded=await helpers.seedModelCache(control,{directory:folder,models:['tiny']});assert.equal(seeded.entries,2);assert.equal(seeded.preflight.passed,true);assert.deepEqual(bodyStore.get(entries[1].url).body,Buffer.alloc(8*1024*1024,17));assert.ok(Math.max(...argumentsSizes)<2000);pass('seed-8MiB-no-CDP-base64-small-metadata');
  const exportedFolder=path.join(folder,'export');fs.mkdirSync(exportedFolder);
  const exported=await helpers.exportModelCache(control,{directory:exportedFolder,models:['tiny']});assert.equal(exported.length,2);fs.writeFileSync(path.join(exportedFolder,'manifest.json'),JSON.stringify({entries:exported}));await helpers.loadVerifiedModelCache(exportedFolder);pass('HTTP-export-roundtrip-sha');
  const controller=new AbortController();const aborted=await helpers.startTransferServer({entries:[{...entries[0],file:'tiny/config.json'}],origin,directory:path.join(folder,'cancel-export'),signal:controller.signal});
  const url=new URL(aborted.url+'/0');let upload;
  const pending=new Promise(resolve=>{upload=http.request(url,{method:'PUT',headers:{'Content-Length':1048576,Origin:origin}},()=>resolve());upload.on('error',()=>resolve());upload.write(Buffer.alloc(65536));});
  const partDirectory=path.join(folder,'cancel-export','tiny');
  for(let tries=0;tries<200&&!fs.existsSync(partDirectory);tries++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(fs.existsSync(partDirectory),true,'Owned partial upload must start before cancellation');controller.abort();await aborted.close();await pending;assert.deepEqual(fs.readdirSync(path.join(folder,'cancel-export','tiny')),[]);pass('abort-closes-owned-sockets-cleans-partial-upload');
  const smallFolder=path.join(folder,'small-cache');fs.mkdirSync(smallFolder);
  const smallEntries=[entry('small/config.json',Buffer.from(JSON.stringify({model_type:'whisper',d_model:768,encoder_layers:12,decoder_layers:12}))),entry('small/onnx/encoder_model.onnx',Buffer.alloc(8*1024*1024,23))];
  for(const e of smallEntries){fs.mkdirSync(path.dirname(path.join(smallFolder,e.file)),{recursive:true});fs.copyFileSync(path.join(folder,e.file),path.join(smallFolder,e.file));}
  fs.writeFileSync(path.join(smallFolder,'manifest.json'),JSON.stringify({entries:smallEntries}));
  const smallSeed=await helpers.seedModelCache(control,{directory:smallFolder,models:['small']});assert.equal(smallSeed.entries,2);assert.ok(Math.max(...argumentsSizes)<2000);pass('canonical-small-loopback-seed-with-small-metadata');
  delete bodyStore.get(smallEntries[1].url).headers['content-length'];
  const smallExport=path.join(folder,'small-export');fs.mkdirSync(smallExport);const smallExported=await helpers.exportModelCache(control,{directory:smallExport,models:['small']});
  fs.writeFileSync(path.join(smallExport,'manifest.json'),JSON.stringify({entries:smallExported}));const smallVerified=await helpers.loadVerifiedModelCache(smallExport);assert.equal(smallVerified.entries.length,2);assert.equal(smallVerified.entries[1].sourceModelId,'onnx-community/whisper-small');pass('canonical-small-HTTP-export-no-content-length-roundtrip-sha-source');
  const largeAbort=new AbortController(),largeDirectory=path.join(folder,'small-large-cancel');
  const largeUploadServer=await helpers.startTransferServer({entries:[{url:smallEntries[1].url,file:smallEntries[1].file}],origin,directory:largeDirectory,signal:largeAbort.signal});
  let largeUpload;const largePending=new Promise(resolve=>{largeUpload=http.request(largeUploadServer.url+'/0',{method:'PUT',headers:{'Content-Length':352825870,Origin:origin}},resolve);largeUpload.on('error',resolve);largeUpload.write(Buffer.alloc(65536));});
  const largeParts=path.join(largeDirectory,'small','onnx');
  for(let tries=0;tries<200&&(!fs.existsSync(largeParts)||!fs.readdirSync(largeParts).length);tries++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(fs.existsSync(largeParts),true,'Known Small encoder >256MiB header must start a bounded stream');assert.ok(fs.readdirSync(largeParts).some(name=>name.endsWith('.part')));
  largeAbort.abort();await largeUploadServer.close();await largePending;assert.deepEqual(fs.readdirSync(largeParts),[]);pass('small-352MiB-declared-upload-bounded-abort-cleanup');
  const badSmall={...smallEntries[0],sourceModelId:'onnx-community/whisper-base'};fs.writeFileSync(path.join(smallFolder,'manifest.json'),JSON.stringify({entries:[badSmall]}));await assert.rejects(helpers.loadVerifiedModelCache(smallFolder),/actual canonical model/);pass('small-base-alias-source-rejected');
  fs.writeFileSync(path.join(folder,'tiny/config.json'),'tamper');await assert.rejects(helpers.loadVerifiedModelCache(folder),/length changed|digest changed/);pass('tampered-model-rejected');
  const natural=path.join(folder,'natural');fs.mkdirSync(natural);const pcm=Buffer.alloc(16000*2);fs.writeFileSync(path.join(natural,'audio.pcm16le'),pcm);
  const sourceSHA=crypto.createHash('sha256').update(pcm).digest('hex');
  const samples=['en1','en2','ja1'].map((id,index)=>({id,file:'audio.pcm16le',format:'pcm16le',reference:index===2?'こんにちは':'hello world',language:index===2?'ja':'en',durationMs:1000,sha256:sourceSHA,source:{license:'test-only',kind:'hermetic-silence'},streamGroup:'switch'}));
  const manifest=path.join(natural,'corpus.json');fs.writeFileSync(manifest,JSON.stringify({samples}));const parsed=await corpus.loadVideoAiCorpus(manifest);
  const plan=corpus.corpusCases(parsed.clips,['explicit','auto'],'tiny');assert.equal(plan.length,6);assert.deepEqual(plan.slice(3).map(run=>run.sessionKey),['auto-switch','auto-switch','auto-switch']);assert.deepEqual(plan.slice(0,3).map(run=>run.sourceLanguage),['en','en','ja']);assert.equal(corpus.scoreClip(parsed.clips[0],'hello').rate,0.5);pass('corpus-explicit-auto-independent-modes-and-en-en-ja-session');
  assert.equal(corpus.scoreClip(parsed.clips[2],'こんにちは').rate,0);pass('CER-and-WER-independent-metrics');
  assert.equal(corpus.corpusCases(parsed.clips,['auto'],'small').length,3);pass('explicit-small-model-corpus-selection');
  report.success=true;report.maxEvaluateArgumentBytes=Math.max(...argumentsSizes);report.transferredBytes=seeded.bytes;
  return report;
} finally {fs.rmSync(folder,{recursive:true,force:true});}
}
module.exports = {runBenchmarkSmoke};
if (require.main === module) {
  const flag = process.argv.indexOf('--artifacts-dir');
  const artifacts = path.resolve(flag < 0 ? path.join(os.tmpdir(), 'fluentread-benchmark-smoke-report') : process.argv[flag + 1]);
  fs.mkdirSync(artifacts, {recursive:true});
  runBenchmarkSmoke().catch(error => {
    process.exitCode=1; return {success:false,error:{message:error.message,stack:error.stack}};
  }).then(report => {fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
}
