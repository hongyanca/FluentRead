import {describe, expect, it} from 'vitest';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Run the actual public CLI entry files with controlled external ports.
// No browser, DOM, OCR, GPU, account, native say/afconvert or product success is simulated as proof.
const workspace = resolve('.');
const scripts = [
    'scripts/testing/run-config-history-ui-test.cjs',
    'scripts/capture-product-assets.cjs',
    'scripts/testing/run-ocr-diagnostics-smoke.cjs',
    'scripts/testing/run-ui-consistency-test.cjs',
    'scripts/testing/run-local-audio-gpu-test.cjs',
] as const;
type Script = typeof scripts[number];
type Mode = 'report' | 'close' | 'partial' | 'profile-remove' | 'fixture-remove' | 'connections' | 'cdp' | 'copy' | 'output';
type Receipt = {kind: string; pid?: number; profile?: string; directory?: string; exists?: boolean};

const ownerPort = String.raw`
const fs = require('node:fs'), path = require('node:path');
const root = process.env.CLI_CLEANUP_FIXTURE;
const profile = process.argv[2];
const log = event => fs.appendFileSync(path.join(root, 'receipts.jsonl'), JSON.stringify(event) + '\n');
let finished = false;
function finish(reason) {
    if (finished) return; finished = true;
    clearInterval(poll); clearTimeout(deadline);
    log({kind:'owner-exit',pid:process.pid,profile,exists:fs.existsSync(profile),reason});
    process.exit(0);
}
const poll = setInterval(() => {if (fs.existsSync(path.join(root, 'stop-owner'))) finish('receipt-stop');}, 20);
const deadline = setTimeout(() => finish('finite-owner-deadline'), 12000);
process.on('SIGTERM', () => finish('TERM'));
process.on('SIGINT', () => finish('INT'));
log({kind:'owner-ready',pid:process.pid,profile});
process.send({kind:'ready',pid:process.pid});
`;

const browserPort = String.raw`
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const root = process.env.CLI_CLEANUP_FIXTURE, mode = process.env.CLI_CLEANUP_MODE;
const log = event => {
    const file = path.join(root, 'receipts.jsonl');
    fs.appendFileSync(file, JSON.stringify(event) + '\n');
};
const worker = {url:()=>'chrome-extension://owned-fixture/background.js',on(){},evaluate:async()=> 'FluentRead fixture'};
const page = {
    on(){},setDefaultTimeout(){},isClosed:()=>false,
    setViewportSize:async()=>{log({kind:'viewport-port'});},
    goto:async()=>{log({kind:'page-port'});if(mode!=='cdp')throw Error('PRIMARY_PAGE_FAILURE');},
    screenshot:async()=>{throw Error('CONTROLLED_FAILURE_SCREENSHOT');},
    locator:()=>({waitFor:async()=>{}}),evaluate:async()=>({success:true}),
};
exports.launchFocusSafePersistentContext = async options => {
    log({kind:'launch',profile:options.profileDir});
    const owner = spawn(process.execPath,[path.join(root,'owner.cjs'),options.profileDir],{stdio:['ignore','ignore','ignore','ipc']});
    // Subscribe before ready/disconnect: exit is the actual process receipt, independent of IPC close.
    const exited = new Promise(resolve=>owner.once('exit',(code,signal)=>{
        log({kind:'owner-process-exit',pid:owner.pid,code,signal});
        resolve({code,signal});
    }));
    await new Promise((resolve,reject)=>{owner.once('message',resolve);owner.once('error',reject);});
    // The ready owner remains live without keeping the public CLI's event loop alive.
    if(owner.connected)owner.disconnect();
    owner.unref();
    if(mode==='partial')throw Error('PRIMARY_PARTIAL_LAUNCH_FAILURE');
    const cdp = {send:async()=>{throw Error('PRIMARY_CDP_FAILURE');},detach:async()=>{log({kind:'cdp-detach'});throw Error('CONTROLLED_CDP_DETACH_FAILURE');}};
    return {launchMode:'controlled-port',focusPolicy:'no-browser-launched',windowPlacement:{},context:{
        serviceWorkers:()=>[worker],
        newCDPSession:async()=>cdp,
        browser:()=>({version:()=>'controlled-port',newBrowserCDPSession:async()=>({send:async()=>({processInfo:[{type:'browser',id:999999}]}),detach:async()=>{}})}),
    },close:async()=>{
        log({kind:'session-close',pid:owner.pid});
        if(mode==='close')throw Error('CONTROLLED_CLOSE_FAILURE');
        let timer;
        try {
            fs.writeFileSync(path.join(root,'stop-owner'),'stop');
            const receipt = await Promise.race([exited,new Promise((resolve,reject)=>{
                timer=setTimeout(()=>{
                    log({kind:'session-close-timeout',pid:owner.pid,exitCode:owner.exitCode,signalCode:owner.signalCode});
                    reject(Error('CONTROLLED_OWNER_CLOSE_TIMEOUT'));
                },5000);
            })]);
            log({kind:'session-close-receipt',pid:owner.pid,code:receipt.code,signal:receipt.signal});
        } finally {clearTimeout(timer);}
    }};
};
exports.newPageWithoutForeground = async()=>page;
exports.activateExtensionTabWithoutForeground = async()=>{};
`;

const preloadPort = String.raw`
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),cp=require('node:child_process');
const root=process.env.CLI_CLEANUP_FIXTURE,mode=process.env.CLI_CLEANUP_MODE;
const log=event=>fs.appendFileSync(path.join(root,'receipts.jsonl'),JSON.stringify(event)+'\n');
const load=Module._load;
Module._load=function(request,...args){
    if(request==='playwright'||request.endsWith('/playwright'))return {chromium:{}};
    if(request==='esbuild')return {build:async()=>{log({kind:'build-port'});}};
    return load.call(this,request,...args);
};
const extension=Module._extensions['.js'];
Module._extensions['.js']=function(mod,file){if(file===process.argv[1])log({kind:'original-cli-loaded',file});return extension(mod,file);};
const temp=fs.mkdtempSync;
fs.mkdtempSync=function(prefix,...args){const directory=temp.call(this,prefix,...args);if(directory.startsWith(process.env.TMPDIR))log({kind:'directory-created',directory});return directory;};
const remove=fs.rmSync;
fs.rmSync=function(directory,...args){
    if(String(directory).startsWith(process.env.TMPDIR)){
        log({kind:'directory-remove',directory});
        if(mode==='profile-remove'&&/(?:profile-|fluentread-history-|product-capture-|fr-ui-consistency-)/.test(directory))throw Error('CONTROLLED_PROFILE_REMOVE_FAILURE');
        if(mode==='fixture-remove'&&/audio-gpu-extension-/.test(directory))throw Error('CONTROLLED_FIXTURE_REMOVE_FAILURE');
    }
    return remove.call(this,directory,...args);
};
const copy=fs.cpSync;
fs.cpSync=function(from,to,...args){if(mode==='copy'&&from===path.join(root,'extension'))throw Error('PRIMARY_COPY_FAILURE');return copy.call(this,from,to,...args);};
const copyFile=fs.copyFileSync;
fs.copyFileSync=function(from,to,...args){
    if(/(?:tesseract-core-simd-lstm\.wasm\.js|tesseract\.min\.js)$/.test(from))return fs.writeFileSync(to,'controlled local OCR file port');
    return copyFile.call(this,from,to,...args);
};
const sync=cp.execFileSync;
cp.execFileSync=function(command,args,...rest){if(command==='git')return 'controlled-capture-revision\n';if(command==='/usr/bin/osascript')return JSON.stringify({pid:1});return sync.call(this,command,args,...rest);};
const start=cp.spawn;
cp.spawn=function(command,args,options){
    if(command==='/usr/bin/say'||command==='/usr/bin/afconvert')return start.call(this,process.execPath,['-e',"require('node:fs').appendFileSync(process.env.CLI_CLEANUP_FIXTURE+'/receipts.jsonl',JSON.stringify({kind:'native-port-exit',pid:process.pid})+'\\n')"],options);
    return start.call(this,command,args,options);
};
const http=require('node:http'),close=http.Server.prototype.close,connections=http.Server.prototype.closeAllConnections;
http.Server.prototype.close=function(...args){this.once('close',()=>log({kind:'server-close-receipt'}));log({kind:'server-close-attempt'});return close.apply(this,args);};
http.Server.prototype.closeAllConnections=function(...args){log({kind:'connection-close-attempt'});if(mode==='connections')throw Error('CONTROLLED_CONNECTION_CLOSE_FAILURE');return connections.apply(this,args);};
`;

const delay = (ms: number) => new Promise<void>(resolveDelay => setTimeout(resolveDelay, ms));
function receipts(root: string): Receipt[] {
    const file = join(root, 'receipts.jsonl');
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
async function waitOwnerExit(root: string, timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const events = receipts(root);
        if (!events.some(e => e.kind === 'owner-ready') || events.some(e => e.kind === 'owner-exit')) return;
        await delay(20);
    }
    throw new Error('Owned fixture process has no exit receipt');
}
async function waitOwnerGone(pid: number, timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {process.kill(pid, 0);} catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
            throw error;
        }
        await delay(20);
    }
    throw new Error('Owned fixture PID is still running after the bounded wait');
}

async function invoke(script: Script, mode: Mode) {
    const root = mkdtempSync(join(tmpdir(), 'verification-cli-cleanup-'));
    const temp = join(root, 'temp'), source = join(root, 'extension'), artifacts = join(root, 'artifacts');
    mkdirSync(temp); mkdirSync(source); mkdirSync(artifacts);
    const foreign = join(temp, 'foreign-profile'); mkdirSync(foreign); writeFileSync(join(foreign, 'sentinel'), 'foreign-owned');
    writeFileSync(join(source, 'manifest.json'), '{}');
    for (const file of ['localTtsWorker.js', 'videoTranscriptionWorker.js']) writeFileSync(join(source, file), 'async function fixture(){return await initialize("q4")}');
    const languages = join(root, 'languages');mkdirSync(languages);
    for (const language of ['eng', 'chi_sim']) writeFileSync(join(languages, language + '.traineddata'), 'controlled language fixture');
    for (const [file, text] of [['owner.cjs', ownerPort], ['browser.cjs', browserPort], ['preload.cjs', preloadPort]]) writeFileSync(join(root, file), text);
    const capture = script === scripts[1];
    const reportPath = join(artifacts, capture ? 'capture-report.json' : 'report.json');
    if (mode === 'report') mkdirSync(reportPath);
    if (mode === 'output') {rmSync(artifacts, {recursive:true});writeFileSync(artifacts, 'blocked output');}
    const args = ['--require', join(root, 'preload.cjs'), join(workspace, script), '--extension-dir', source,
        '--playwright-root', root, '--focus-safe-helper', join(root, 'browser.cjs'), '--artifacts-dir', artifacts,
        '--runtime', root, '--helper', join(root, 'browser.cjs'), '--output', join(artifacts, 'screenshots'), '--language-dir', languages];
    const cli = spawn(process.execPath, args, {cwd:workspace, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe'],
        env:{...process.env,TMPDIR:temp,CLI_CLEANUP_FIXTURE:root,CLI_CLEANUP_MODE:mode}});
    let stdout = '', stderr = '', timedOut = false;
    const signalGroup = (signal: NodeJS.Signals) => {if(cli.pid)try{process.kill(process.platform === 'win32' ? cli.pid : -cli.pid, signal);}catch{ /* Owned group already exited. */ }};
    let force: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {timedOut=true;signalGroup('SIGTERM');force=setTimeout(()=>signalGroup('SIGKILL'),5000);}, 8000);
    cli.stdout.on('data', value => {stdout += String(value);});cli.stderr.on('data', value => {stderr += String(value);});
    try {
        const completion = await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolveCompletion => {
            // Spawn failure still settles at close, so timers and handles are always joined.
            cli.once('error', error => {stderr += String(error);});
            cli.once('close', (code, signal) => resolveCompletion({code,signal}));
        });
        clearTimeout(timer);if(force)clearTimeout(force);
        const events = receipts(root);
        const owner = events.find(e => e.kind === 'owner-ready');
        const ownerStillRunning = Boolean(owner && !events.some(e => e.kind === 'owner-exit'));
        if (ownerStillRunning) expect(() => process.kill(owner!.pid!, 0)).not.toThrow();
        const directories = events.filter(e => e.kind === 'directory-created').map(e => ({path:e.directory!,exists:existsSync(e.directory!)}));
        const report = existsSync(reportPath) && mode !== 'report' ? JSON.parse(readFileSync(reportPath,'utf8')) : null;
        expect(readFileSync(join(foreign,'sentinel'),'utf8')).toBe('foreign-owned');
        expect(readdirSync(temp)).toContain('foreign-profile');
        const ownerProfileEntries = owner && existsSync(owner.profile!) ? readdirSync(owner.profile!) : [];
        return {script,mode,...completion,stdout,stderr,timedOut,events,ownerStillRunning,ownerProfileEntries,directories,report};
    } finally {
        clearTimeout(timer);if(force)clearTimeout(force);
        writeFileSync(join(root,'stop-owner'),'stop');
        const owner = receipts(root).find(e => e.kind === 'owner-ready');
        if (owner) {
            try {await waitOwnerExit(root,1000);await waitOwnerGone(owner.pid!,1000);}
            catch {
                signalGroup('SIGTERM');
                try {await waitOwnerGone(owner.pid!,5000);}
                catch {signalGroup('SIGKILL');await waitOwnerGone(owner.pid!,1000);}
            }
        }
        rmSync(root,{recursive:true,force:true});
    }
}

function primary(result: Awaited<ReturnType<typeof invoke>>, message = 'PRIMARY_PAGE_FAILURE') {
    expect(result.timedOut).toBe(false);expect(result.code).toBe(1);
    expect(result.events.some(e=>e.kind==='original-cli-loaded')).toBe(true);
    expect(result.stderr).toContain(message);
}

describe('public verification CLI cleanup with owned process receipts', () => {
    for (const script of scripts) {
        it(`${script}: report EISDIR cannot block session close or mask primary failure`, async () => {
            const result=await invoke(script,'report');primary(result);
            expect(result.stderr).toContain('EISDIR');
            expect(result.events.filter(e=>e.kind==='session-close-receipt')).toHaveLength(1);
            expect(result.ownerStillRunning).toBe(false);expect(result.directories.every(d=>!d.exists)).toBe(true);
            if(script===scripts[1])expect(result.events.filter(e=>e.kind==='server-close-receipt')).toHaveLength(1);
        },20000);
        it(`${script}: rejected close preserves primary and exact live owner profile`, async () => {
            const result=await invoke(script,'close');primary(result);
            expect(result.events.filter(e=>e.kind==='session-close')).toHaveLength(1);
            expect(result.ownerStillRunning).toBe(true);expect(result.directories.every(d=>d.exists)).toBe(true);
            expect(result.ownerProfileEntries).toEqual([]);
            expect(result.report.cleanupError).toContain('CONTROLLED_CLOSE_FAILURE');
            expect(result.report.error || result.report.failure).toContain('PRIMARY_PAGE_FAILURE');
            expect(result.report.retainedProfile).toBe(result.events.find(e=>e.kind==='owner-ready')!.profile);
            if(script===scripts[1])expect(result.events.filter(e=>e.kind==='server-close-receipt')).toHaveLength(1);
        },20000);
        it(`${script}: partial launcher with a real live child retains even an empty profile`, async () => {
            const result=await invoke(script,'partial');primary(result,'PRIMARY_PARTIAL_LAUNCH_FAILURE');
            expect(result.ownerStillRunning).toBe(true);expect(result.directories.every(d=>d.exists)).toBe(true);
            expect(result.ownerProfileEntries).toEqual([]);
            expect(result.events.filter(e=>e.kind==='session-close')).toHaveLength(0);
            expect(result.report.retainedProfile).toBe(result.events.find(e=>e.kind==='owner-ready')!.profile);
            if(script===scripts[1])expect(result.events.filter(e=>e.kind==='server-close-receipt')).toHaveLength(1);
        },20000);
    }
    for (const script of [scripts[2],scripts[4]]) {
        it(`${script}: profile removal failure still attempts the independent fixture cleanup`, async () => {
            const result=await invoke(script,'profile-remove');primary(result);
            expect(result.events.filter(e=>e.kind==='session-close-receipt')).toHaveLength(1);
            expect(result.directories.find(d=>d.path.includes('profile-'))!.exists).toBe(true);
            expect(result.directories.find(d=>d.path.includes('extension-'))!.exists).toBe(false);
            expect(result.report.directoryCleanupErrors[0].error).toContain('CONTROLLED_PROFILE_REMOVE_FAILURE');
            expect(result.report.failure).toContain('PRIMARY_PAGE_FAILURE');
        },20000);
        it(`${script}: prelaunch copy failure cleans every allocated owned directory`, async () => {
            const result=await invoke(script,'copy');primary(result,'PRIMARY_COPY_FAILURE');
            expect(result.events.filter(e=>e.kind==='launch')).toHaveLength(0);
            expect(result.directories).toHaveLength(2);expect(result.directories.every(d=>!d.exists)).toBe(true);
        },20000);
    }
    it('audio fixture removal failure preserves the primary error after profile and child release', async () => {
        const result=await invoke(scripts[4],'fixture-remove');primary(result);
        expect(result.ownerStillRunning).toBe(false);
        expect(result.directories.find(d=>d.path.includes('profile-'))!.exists).toBe(false);
        expect(result.directories.find(d=>d.path.includes('extension-'))!.exists).toBe(true);
        expect(result.report.directoryCleanupErrors[0].error).toContain('CONTROLLED_FIXTURE_REMOVE_FAILURE');
        expect(result.report.failure).toContain('PRIMARY_PAGE_FAILURE');
    },20000);
    it('capture connection cleanup rejection still closes its real loopback server and profile', async () => {
        const result=await invoke(scripts[1],'connections');primary(result);
        expect(result.events.filter(e=>e.kind==='server-close-receipt')).toHaveLength(1);
        expect(result.directories.every(d=>!d.exists)).toBe(true);
        expect(result.report.connectionCleanupError).toContain('CONTROLLED_CONNECTION_CLOSE_FAILURE');
        expect(result.report.error).toContain('PRIMARY_PAGE_FAILURE');
    },20000);
    it('capture owns a partial CDP acquisition and continues cleanup after detach rejection', async () => {
        const result=await invoke(scripts[1],'cdp');primary(result,'PRIMARY_CDP_FAILURE');
        expect(result.events.filter(e=>e.kind==='cdp-detach')).toHaveLength(1);
        expect(result.events.filter(e=>e.kind==='session-close-receipt')).toHaveLength(1);
        expect(result.events.filter(e=>e.kind==='server-close-receipt')).toHaveLength(1);
        expect(result.directories.every(d=>!d.exists)).toBe(true);
        expect(result.report.cdpCleanupErrors[0]).toContain('CONTROLLED_CDP_DETACH_FAILURE');
        expect(result.report.error).toContain('PRIMARY_CDP_FAILURE');
    },20000);
    it('history output initialization failure allocates no profile and preserves its filesystem error', async () => {
        const result=await invoke(scripts[0],'output');
        expect(result.timedOut).toBe(false);expect(result.code).toBe(1);expect(result.stderr).toContain('EEXIST');
        expect(result.events.filter(e=>e.kind==='launch')).toHaveLength(0);expect(result.directories).toEqual([]);
    },20000);
});
