'use strict';
// 在自有临时扩展中验证产品的串行 Paddle/LaMa Worker 与正式 OPUS Worker，记录重复推理及 Canvas 读回耗时。
// 使用 Chrome 的临时调试加载 API；只操作第二屏上的独立 profile，不触碰用户页面。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
function arg(name,fallback){const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];}
const source=path.resolve(arg('extension-dir',path.join(root,'.output/chrome-mv3')));
const artifacts=path.resolve(arg('artifacts-dir','/private/tmp/fluentread-bundle-model-smoke'));
const data=path.resolve(arg('manga-models-dir','/private/tmp/fluentread-manga-mirror-probe'));
const {chromium}=require(path.join(arg('playwright-root','/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
const {launchFocusSafePersistentContext,newPageWithoutForeground}=require(arg('focus-safe-helper','/Users/thinkstu/.codex/skills/fluentread-browser-translation-test/scripts/focus-safe-browser.cjs'));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-bundle-model-extension-'));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-bundle-model-profile-'));
const kinds=arg('kinds','paddle,opus').split(',');
const report={source,cases:[],errors:[],warnings:[],evidence:'Actual serialized Paddle/LaMa production Worker bundled with the shared ONNX alias, and the unchanged production OPUS Worker. Fixed offline Paddle/LaMa files are hash checked; OPUS downloads are pinned and SHA-256 checked. Controlled samples are not broad quality or mainland-network proof.'};
(async()=>{let session;try{
 fs.mkdirSync(artifacts,{recursive:true});fs.cpSync(source,fixture,{recursive:true});fs.mkdirSync(path.join(fixture,'probe-data'));
 if(kinds.includes('paddle'))for(const name of ['PP-OCRv6_small_det.onnx','PP-OCRv6_small_rec.onnx','ppocrv6_dict.txt','lama-manga-dynamic.onnx'])fs.copyFileSync(path.join(data,name),path.join(fixture,'probe-data',name));
 fs.writeFileSync(path.join(fixture,'model-probe.html'),'<!doctype html><title>FluentRead model size regression</title><h1>Model compatibility verification</h1>');
 const tf=createRequire(require.resolve('@huggingface/transformers-kokoro'));
 const ort=tf.resolve('onnxruntime-web/webgpu'),common=createRequire(ort).resolve('onnxruntime-common');
 await createRequire(require.resolve('vite'))('esbuild').build({stdin:{contents:`export {startMangaInferenceWorker} from './src/features/image-translation/services/mangaInference.worker'; export {createBrowserMangaOcr} from './src/features/image-translation/services/mangaOcr'; export {createBrowserMangaInpainter} from './src/features/image-translation/services/mangaInpainting'; export {importMangaModel} from './src/features/image-translation/services/mangaOcrAssets'; export {getTranslationArtifacts,downloadTranslationArtifact} from './src/features/local-translation/offscreen/artifactStore'; export {resolveOpusTranslationRepository,LOCAL_TRANSLATION_MODEL_IDS} from './src/core/config/localTranslation';`,resolveDir:root},alias:{'@':root,'onnxruntime-web':path.join(path.dirname(ort),'ort.webgpu.min.mjs'),'onnxruntime-web/webgpu':path.join(path.dirname(ort),'ort.webgpu.min.mjs'),'onnxruntime-common':path.resolve(path.dirname(common),'../esm/index.js')},bundle:true,platform:'browser',format:'esm',outfile:path.join(fixture,'model-cache.mjs')});
 session=await launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:arg('browser-path','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),headless:false,background:true,displayTarget:'secondary',viewport:{width:1100,height:800},browserArgs:['--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check']});
 Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
 const context=session.context; const cdp=await context.browser().newBrowserCDPSession(); const {id}=await cdp.send('Extensions.loadUnpacked',{path:fixture}); const origin='chrome-extension://'+id;
 for(const backend of kinds.includes('paddle')?arg('backends','webgpu,wasm').split(','):[]){
  const page=await newPageWithoutForeground(context);await page.goto(origin+'/model-probe.html');page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());if(m.type()==='warning')report.warnings.push(m.text());});console.log(JSON.stringify({phase:'manga',backend}));
  fs.writeFileSync(path.join(fixture,'probe-worker.mjs'),"import {startMangaInferenceWorker} from './model-cache.mjs'; startMangaInferenceWorker();");
  const result=await page.evaluate(async backend=>{
   if(backend==='wasm')Object.defineProperty(navigator,'gpu',{value:undefined});
   const module=await import('./model-cache.mjs');
   for(const name of ['PP-OCRv6_small_det.onnx','PP-OCRv6_small_rec.onnx','ppocrv6_dict.txt','lama-manga-dynamic.onnx']){await module.importMangaModel(new File([await(await fetch('./probe-data/'+name)).blob()],name));}
   const canvas=document.createElement('canvas');canvas.width=900;canvas.height=180;
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,900,180);context.font='bold 64px Arial';context.fillStyle='#000';context.fillText('Hello world',60,110);
   const worker=new Worker('./probe-worker.mjs',{type:'module'});let id=0;
   function request(type,extra={}){return new Promise((resolve,reject)=>{const requestId=++id;const timer=setTimeout(()=>{worker.terminate();reject(new Error(type+' timed out'));},120000);worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.onmessage=e=>{if(e.data.requestId!==requestId)return;if(e.data.stage){return;}clearTimeout(timer);e.data.success?resolve(e.data.result):reject(new Error(e.data.error));};worker.postMessage({requestId,type,cpu:backend==='wasm',...extra});});}
   try {
    const started=performance.now();await request('prepare-ocr');const initMs=performance.now()-started,warm=[];let recognized;
    const image=canvas.toDataURL();for(let i=0;i<4;i++){const t=performance.now();recognized=await request('recognize',{image});warm.push(performance.now()-t);}
    await request('dispose-ocr');
    const patch={image:new Float32Array(3*64*64).fill(0.5),mask:new Float32Array(64*64),width:64,height:64};patch.mask.fill(1,64*20,64*24);
    const inpaintStart=performance.now();await request('prepare-inpaint');const output=await request('inpaint',{patch});await request('dispose-inpaint');
    return {backend,initMs,ocrRunsMs:warm,text:recognized.results.map(row=>row.text).join(' '),inpaintMs:performance.now()-inpaintStart,outputLength:output.length,finite:output.every(Number.isFinite)};
   } finally {worker.terminate();}
  },backend);
  assert.match(result.text,/hello.*world/i);assert.equal(result.outputLength,3*64*64);assert.equal(result.finite,true);report.cases.push(result);console.log(JSON.stringify(result));await page.close();
 }
 if(kinds.includes('opus')){
 const page=await newPageWithoutForeground(context);await page.goto(origin+'/model-probe.html');
 console.log(JSON.stringify({phase:'opus-download'}));
 await page.evaluate(async()=>{const m=await import('./model-cache.mjs');const model=m.LOCAL_TRANSLATION_MODEL_IDS.opusZhEn,repo=m.resolveOpusTranslationRepository(model,'en','zh');for(const file of m.getTranslationArtifacts(model).filter(f=>f.repo===repo))await m.downloadTranslationArtifact(file,new AbortController().signal,()=>{});});
 const opus=await page.evaluate(async()=>{const worker=new Worker(new URL('./localTranslationWorker.js',location.href),{type:'module'});let id=0;function request(text){return new Promise((resolve,reject)=>{const requestId=++id,timer=setTimeout(()=>reject(new Error('OPUS timeout')),90000);worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.onmessage=e=>{if(e.data.requestId===requestId){clearTimeout(timer);e.data.success?resolve(e.data):reject(new Error(e.data.error));}};worker.postMessage({requestId,type:'translate',model:'fluentread/opus-zh-en',text,sourceLanguage:'en',targetLanguage:'zh'});});}try{return [await request('Hello world.'),await request('This is a local translation test.')];}finally{worker.terminate();}});
 for(const value of opus)assert.match(value.result,/[\u3400-\u9fff]/u);report.cases.push({model:'opus-en-zh',outputs:opus});console.log(JSON.stringify(opus));
 }
 const micro=await newPageWithoutForeground(context);await micro.goto(origin+'/model-probe.html');
 report.canvasReadback=await micro.evaluate(()=>{const results=[];for(const frequent of [false,true,true,false,false,true]){const c=document.createElement('canvas');c.width=1600;c.height=1200;const ctx=c.getContext('2d',{willReadFrequently:frequent});ctx.fillStyle='#f2eacd';ctx.fillRect(0,0,c.width,c.height);ctx.font='48px Arial';ctx.fillStyle='#123456';ctx.fillText('FluentRead readback',64,96);let checksum=0;const start=performance.now();for(let n=0;n<16;n++){const pixels=ctx.getImageData(0,0,c.width,c.height).data;checksum+=pixels[0]+pixels[1]+pixels[2]+pixels[3];}results.push({willReadFrequently:frequent,ms:performance.now()-start,checksum});c.width=0;c.height=0;}return results;});console.log(JSON.stringify({canvasReadback:report.canvasReadback}));await micro.close();
 // 结束前再检查后台新页没有使浏览器成为前台，不用截图触发额外窗口行为。
 const last=await newPageWithoutForeground(context);await last.close();assert.deepEqual(report.errors,[]);assert.ok(report.canvasReadback.every(row=>row.checksum===14976));report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));if(session)await session.close();fs.rmSync(profile,{recursive:true,force:true});fs.rmSync(fixture,{recursive:true,force:true});}})();
