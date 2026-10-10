import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Actual public CLI bytes execute in a bounded subprocess. Only external media,
// filesystem failure, launcher/CDP/page transports are controlled. The supplied
// evaluate callbacks execute unchanged to exercise their own interval lifetime.
// This is not a rendered extension/native-video/provider integration test.
const scriptPath = path.resolve(process.env.FLUENTREAD_X_FLICKER_CLI_ROOT || process.cwd(), 'scripts/run-x-native-subtitle-flicker-test.cjs');
const evidenceRoot = process.env.FLUENTREAD_X_FLICKER_EVIDENCE;
let suiteRoot: string;
let invocation = 0;
type Trace = {kind: string; [key: string]: any};
type Exit = {code: number | null; signal: NodeJS.Signals | null};
const closePromises = new WeakMap<ChildProcess, Promise<Exit>>();
const owned = new Set<ChildProcess>();
const ownershipReceipts: Record<string, unknown>[] = [];

function track(child: ChildProcess): Promise<Exit> {
    owned.add(child);
    const closed = new Promise<Exit>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {owned.delete(child); resolve({code, signal});});
    });
    closePromises.set(child, closed);
    return closed;
}

function isGone(pid: number): boolean {
    try {process.kill(pid, 0); return false;}
    catch (error) {return (error as NodeJS.ErrnoException).code === 'ESRCH';}
}

async function settleWithin<T>(promise: Promise<T>, milliseconds: number): Promise<{settled: true; value: T} | {settled: false}> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise.then(value => ({settled: true as const, value})),
            new Promise<{settled: false}>(resolve => {timer = setTimeout(() => resolve({settled: false}), milliseconds);}),
        ]);
    } finally {if (timer) clearTimeout(timer);}
}

async function stopOwned(child: ChildProcess, reason: string): Promise<Exit> {
    const closed = closePromises.get(child)!;
    const signals: string[] = [];
    if (owned.has(child)) {signals.push('SIGTERM'); child.kill('SIGTERM');}
    let result = await settleWithin(closed, 5000);
    if (!result.settled) {
        if (owned.has(child)) {signals.push('SIGKILL'); child.kill('SIGKILL');}
        result = await settleWithin(closed, 5000);
    }
    if (!result.settled) throw new Error('Owned child did not close after bounded TERM/KILL/wait');
    const gone = isGone(child.pid!);
    ownershipReceipts.push({pid: child.pid, reason, signals, waited: true, ...result.value, gone});
    expect(gone, 'only this tracked process handle was stopped and waited').toBe(true);
    return result.value;
}

const preload = String.raw`
const fs=require('node:fs'),cp=require('node:child_process');
const flags=global.__fixtureFlags=new Set(process.env.FLICKER_FAULT.split('+'));
const log=global.__fixtureLog=(kind,data={})=>fs.appendFileSync(process.env.FLICKER_EVENTS,JSON.stringify({kind,...data})+'\n');
log('external-ports-ready',{pid:process.pid});
const temp=fs.mkdtempSync;
fs.mkdtempSync=function(...args){if(flags.has('temp-create'))throw Error('CONTROLLED_PROFILE_CREATE_FAILURE');const directory=temp.apply(this,args);log('profile-created',{directory});return directory;};
const remove=fs.rmSync;
fs.rmSync=function(directory,...args){log('profile-remove',{directory});if(flags.has('remove-profile'))throw Error('CONTROLLED_PROFILE_REMOVE_FAILURE');return remove.call(this,directory,...args);};
const write=fs.writeFileSync;
fs.writeFileSync=function(file,...args){if(String(file).endsWith('/artifacts/report.json'))log('report-write');return write.call(this,file,...args);};
cp.spawnSync=function(command,args,options){
 if(command!=='/opt/homebrew/bin/ffmpeg')throw Error('UNEXPECTED_NATIVE_COMMAND');
 log('media-port',{command,args,options});
 if(flags.has('media-timeout')||flags.has('media-missing')){const error=Error(flags.has('media-timeout')?'CONTROLLED_MEDIA_TIMEOUT':'CONTROLLED_MEDIA_ENOENT');error.code=flags.has('media-timeout')?'ETIMEDOUT':'ENOENT';return {status:null,signal:flags.has('media-timeout')?'SIGKILL':null,error,stderr:error.message,stdout:''};}
 if(flags.has('media-exit'))return {status:7,signal:null,stderr:'CONTROLLED_MEDIA_EXIT_FAILURE',stdout:''};
 if(!flags.has('media-read'))fs.writeFileSync(args.at(-1),'controlled media bytes; no native decoder');
 return {status:0,signal:null,stderr:'',stdout:''};
};
const nativeSet=setInterval,nativeClear=clearInterval,intervals=global.__fixtureIntervals=new Set();
global.setInterval=(callback,delay,...args)=>{const handle=nativeSet(callback,delay,...args);if(delay===20){intervals.add(handle);log('sampling-start',{delay});}return handle;};
global.clearInterval=handle=>{if(intervals.delete(handle))log('sampling-clear');return nativeClear(handle);};
// A real browser context disposes its realm even if the page callback omitted
// clearInterval. Model that boundary separately from production-owned retirement.
global.__disposeFixtureRealm=()=>{for(const handle of intervals)nativeClear(handle);log('realm-dispose',{active:intervals.size});intervals.clear();};
global.chrome={runtime:{sendMessage:async message=>{log('runtime-message',{type:message.type});return message.type==='configStorageRead'?{success:true,value:{}}:{success:true};}}};
const video={readyState:2,currentTime:0,addTextTrack:(...args)=>{log('native-track-port',{args});return {addCue:cue=>log('native-cue-port',{start:cue.startTime,end:cue.endTime,text:cue.text})};}};
global.VTTCue=class {constructor(start,end,text){this.startTime=start;this.endTime=end;this.text=text;}};
// DOM transport values deliberately contain no translated UI. These tests do not
// implement subtitle selection/translation or claim that client assertions pass.
global.document={querySelector:selector=>selector==='video'?video:null};
global.window={postMessage:(data,origin)=>{log('fragment-post',{data,origin});if(flags.has('interval-throw'))throw Error('CONTROLLED_FRAGMENT_FAILURE');}};
global.location={href:'https://x.com/native-flicker/status/424242',origin:'https://x.com'};
global.fetch=async()=>{throw Error('UNEXPECTED_PROVIDER_REQUEST');};
`;

const helper = String.raw`
const fs=require('node:fs'),path=require('node:path');
const flags=global.__fixtureFlags,log=global.__fixtureLog;
const waitFile=async file=>{const deadline=Date.now()+2500;while(!fs.existsSync(file)){if(Date.now()>deadline)throw Error('CONTROLLED_PROCESS_PORT_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,5));}return JSON.parse(fs.readFileSync(file,'utf8'));};
let pages=0;
const worker={url:()=> 'chrome-extension://owned-extension/background.js',evaluate:async callback=>{log('worker-evaluate');return structuredClone(await callback());}};
exports.launchFocusSafePersistentContext=async options=>{
 log('launcher',{profileDir:options.profileDir});
 if(flags.has('partial-launch')||flags.has('process-session')){
  fs.writeFileSync(path.join(process.env.FLICKER_FIXTURE,'start-request.json'),JSON.stringify({profileDir:options.profileDir}));
  const receipt=await waitFile(path.join(process.env.FLICKER_FIXTURE,'process-ready.json'));
  log('acquired-process-port',receipt);
 }
 if(flags.has('partial-launch')||flags.has('launch-reject'))throw Error('CONTROLLED_LAUNCH_REJECTION');
 const cdp={send:async(method,params)=>{log('cdp-send',{method,params});if(flags.has('cdp-load'))throw Error('CONTROLLED_LOAD_FAILURE');return {id:'owned-extension'};},detach:async()=>{log('cdp-detach');if(flags.has('cdp-detach'))throw Error('CONTROLLED_DETACH_FAILURE');}};
 const context={browser:()=>({newBrowserCDPSession:async()=>{log('cdp-acquired');return cdp;}}),on(){},serviceWorkers:()=>[worker],route:async()=>{log('route-port');}};
 return {context,launchMode:'controlled-external-launcher',focusPolicy:'no-browser',windowPlacement:{browserFrontmost:false},close:async()=>{
  log('session-close',{samplingActive:global.__fixtureIntervals.size});
  if(flags.has('close-reject'))throw Error('CONTROLLED_CLOSE_FAILURE');
  if(flags.has('process-session')){
   fs.writeFileSync(path.join(process.env.FLICKER_FIXTURE,'stop-request.json'),'{}');
   const receipt=await waitFile(path.join(process.env.FLICKER_FIXTURE,'process-exit-receipt.json'));
   log('process-exit-receipt',receipt);
  }
  global.__disposeFixtureRealm();
  if(flags.has('ownership-swap')){
   const original=fs.lstatSync(options.profileDir);
   fs.renameSync(options.profileDir,options.profileDir+'.original');
   fs.mkdirSync(options.profileDir);
   fs.writeFileSync(path.join(options.profileDir,'foreign-sentinel'),'foreign replacement must survive');
   const replacement=fs.lstatSync(options.profileDir);
   log('profile-ownership-swapped',{directory:options.profileDir,original:{dev:original.dev,ino:original.ino},replacement:{dev:replacement.dev,ino:replacement.ino,symlink:replacement.isSymbolicLink()}});
  }
 }};
};
exports.newPageWithoutForeground=async()=>{
 const number=++pages;
 return {on(){},goto:async url=>{log('page-goto',{number,url});if(number===1&&flags.has('control-primitive'))throw null;if(number===1&&flags.has('control-fail'))throw Error('CONTROLLED_PRIMARY_PAGE_FAILURE');},
  // Readiness is a controlled transport acknowledgement, not a DOM/client proof.
  waitForFunction:async()=>{log('readiness-port');},waitForSelector:async()=>{},locator:()=>({hover:async()=>{}}),
  evaluate:async(callback,arg)=>{log('page-evaluate',{number});return structuredClone(await callback(arg));},screenshot:async()=>{log('screenshot-port');}};
};
`;

const actorSource = String.raw`
const fs=require('node:fs');
const profileDir=process.argv[2],ready=process.argv[3];
const fd=fs.openSync(require('node:path').join(profileDir,'own-process.lock'),'w');
fs.writeFileSync(ready,JSON.stringify({pid:process.pid,profileDir}));
process.on('SIGTERM',()=>{fs.closeSync(fd);process.exit(0);});
setInterval(()=>{},1000);
`;

beforeAll(() => {
    const parent = process.env.FLUENTREAD_X_FLICKER_FIXTURE_ROOT || tmpdir();
    mkdirSync(parent, {recursive: true});
    suiteRoot = mkdtempSync(path.join(parent, 'x-native-flicker-cli-'));
});
afterAll(async () => {
    for (const child of [...owned]) await stopOwned(child, 'suite-finally');
    if (evidenceRoot) {mkdirSync(evidenceRoot, {recursive: true}); writeFileSync(path.join(evidenceRoot, 'ownership-receipts.json'), JSON.stringify(ownershipReceipts, null, 2));}
    if (suiteRoot) rmSync(suiteRoot, {recursive: true, force: true});
});

async function invoke(fault: string) {
    const fixture = path.join(suiteRoot, String(++invocation));
    for (const folder of ['runtime/node_modules/playwright', 'artifacts', 'temp', 'extension']) mkdirSync(path.join(fixture, folder), {recursive: true});
    writeFileSync(path.join(fixture, 'runtime/node_modules/playwright/index.js'), 'exports.chromium={};\n');
    writeFileSync(path.join(fixture, 'runtime/node_modules/playwright/package.json'), '{"type":"commonjs","main":"index.js"}');
    writeFileSync(path.join(fixture, 'extension/manifest.json'), '{}');
    writeFileSync(path.join(fixture, 'preload.cjs'), preload);
    writeFileSync(path.join(fixture, 'helper.cjs'), helper);
    writeFileSync(path.join(fixture, 'actor.cjs'), actorSource);
    const eventFile = path.join(fixture, 'events.jsonl');
    writeFileSync(eventFile, '');
    if (fault.includes('report-eisdir')) mkdirSync(path.join(fixture, 'artifacts/report.json'));
    let actor: ChildProcess | undefined;
    let actorStop: Promise<Exit> | undefined;
    let started = false, driverBusy = false, driverFailure: unknown;
    const driver = setInterval(async () => {
        if (driverBusy) return;
        driverBusy = true;
        try {
            const request = path.join(fixture, 'start-request.json');
            if (!started && existsSync(request)) {
                started = true;
                const {profileDir} = JSON.parse(readFileSync(request, 'utf8'));
                if (!path.resolve(profileDir).startsWith(path.resolve(fixture, 'temp') + path.sep)) throw new Error('Refuse foreign profile process request');
                actor = spawn(process.execPath, [path.join(fixture, 'actor.cjs'), profileDir, path.join(fixture, 'process-ready.json')], {detached: true, stdio: 'ignore'});
                track(actor);
            }
            if (actor && !actorStop && existsSync(path.join(fixture, 'stop-request.json'))) {
                actorStop = stopOwned(actor, 'confirmed-launcher-close');
                const exit = await actorStop;
                writeFileSync(path.join(fixture, 'process-exit-receipt.json'), JSON.stringify({pid: actor.pid, waited: true, gone: isGone(actor.pid!), ...exit}));
            }
        } catch (error) {driverFailure = error;} finally {driverBusy = false;}
    }, 5);
    const args = ['--require', path.join(fixture, 'preload.cjs'), scriptPath, '--playwright-root', path.join(fixture, 'runtime'), '--focus-safe-helper', path.join(fixture, 'helper.cjs'), '--extension-dir', path.join(fixture, 'extension'), '--artifacts-dir', path.join(fixture, 'artifacts')];
    const child = spawn(process.execPath, args, {detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, TMPDIR: path.join(fixture, 'temp'), FLICKER_FAULT: fault, FLICKER_EVENTS: eventFile, FLICKER_FIXTURE: fixture}});
    const close = track(child);
    let stdout = '', stderr = '', timedOut = false;
    child.stdout!.on('data', data => {stdout += data;});
    child.stderr!.on('data', data => {stderr += data;});
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => {
        timedOut = true;
        if (owned.has(child)) {try {process.kill(-child.pid!, 'SIGTERM');} catch {child.kill('SIGTERM');}}
        killTimer = setTimeout(() => {if (owned.has(child)) {try {process.kill(-child.pid!, 'SIGKILL');} catch {child.kill('SIGKILL');}}}, 5000);
    }, 7000);
    let result;
    try {
        const exit = await close;
        const events: Trace[] = readFileSync(eventFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const profiles = events.filter(event => event.kind === 'profile-created').map(event => ({path: event.directory, existsAtCliClose: existsSync(event.directory)}));
        const reportFile = path.join(fixture, 'artifacts/report.json');
        const report = existsSync(reportFile) && statSync(reportFile).isFile() ? JSON.parse(readFileSync(reportFile, 'utf8')) : undefined;
        const lastLine = stdout.trim().split('\n').at(-1);
        let summary;
        try {summary = JSON.parse(lastLine || '');} catch {summary = undefined;}
        const actorAtCliClose = actor ? {pid: actor.pid, alive: !isGone(actor.pid!), profileExists: profiles[0]?.existsAtCliClose} : undefined;
        const sentinel = profiles[0] && path.join(profiles[0].path, 'foreign-sentinel');
        const replacementSentinelAtCliClose = sentinel && existsSync(sentinel) ? readFileSync(sentinel, 'utf8') : undefined;
        result = {...exit, fault, timedOut, stdout, stderr, events, profiles, report, summary, actorAtCliClose, replacementSentinelAtCliClose, scriptPath, scriptSHA256: createHash('sha256').update(readFileSync(scriptPath)).digest('hex'), cliPid: child.pid, cliWaited: true, cliGone: isGone(child.pid!), fixture};
    } finally {
        clearTimeout(deadline); if (killTimer) clearTimeout(killTimer); clearInterval(driver);
        if (actorStop) await actorStop;
        else if (actor) await stopOwned(actor, 'invocation-finally');
        if (owned.has(child)) await stopOwned(child, 'exceptional-cli-finally');
    }
    if (evidenceRoot) {
        mkdirSync(evidenceRoot, {recursive: true});
        writeFileSync(path.join(evidenceRoot, `${invocation}-${fault}.json`), JSON.stringify({...result, actorGoneAfterTeardown: actor ? isGone(actor.pid!) : undefined, driverFailure: driverFailure ? String(driverFailure) : undefined}, null, 2));
    }
    expect(driverFailure).toBeUndefined();
    expect(result!.timedOut, result!.stderr).toBe(false);
    expect(result!.signal).toBeNull();
    expect(result!.cliGone).toBe(true);
    if (actor) expect(isGone(actor.pid!)).toBe(true);
    return result!;
}

const count = (result: Awaited<ReturnType<typeof invoke>>, kind: string) => result.events.filter(event => event.kind === kind).length;
const removed = (result: Awaited<ReturnType<typeof invoke>>) => {expect(result.profiles).toHaveLength(1); expect(result.profiles[0].existsAtCliClose).toBe(false);};
const primary = (result: Awaited<ReturnType<typeof invoke>>, message: string) => {expect(result.code).toBe(1); expect(result.report, 'current failure has its own structured report').toBeDefined(); expect(result.report.success).toBe(false); expect(result.report.failure).toContain(message);};

// Assertions below inspect public CLI exit/report/resource events, never source
// strings or copied subtitle behavior. Both original and candidate use this file.
describe('X native subtitle flicker public CLI resource ownership', () => {
    it('bounds the media subprocess and reports its timeout before any launcher acquisition', async () => {
        const result = await invoke('media-timeout');
        primary(result, 'CONTROLLED_MEDIA_TIMEOUT');
        const media = result.events.find(event => event.kind === 'media-port')!;
        expect(media.options.timeout).toBe(30000); expect(media.options.killSignal).toBe('SIGKILL');
        expect(result.report.media).toMatchObject({status: null, signal: 'SIGKILL', error: 'CONTROLLED_MEDIA_TIMEOUT'});
        expect(count(result, 'launcher')).toBe(0); expect(result.profiles).toHaveLength(0);
    });
    for (const [fault, message] of [['media-missing', 'CONTROLLED_MEDIA_ENOENT'], ['media-exit', 'CONTROLLED_MEDIA_EXIT_FAILURE'], ['media-read', 'ENOENT'], ['temp-create', 'CONTROLLED_PROFILE_CREATE_FAILURE']]) {
        it(`records ${fault} through the actual public CLI initialization report`, async () => {
            const result = await invoke(fault);
            primary(result, message); expect(count(result, 'launcher')).toBe(0); expect(result.profiles).toHaveLength(0);
        });
    }
    it('preserves the primary page failure and closes session plus profile before its final report', async () => {
        const result = await invoke('control-fail');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE'); removed(result);
        expect(count(result, 'session-close')).toBe(1); expect(count(result, 'cdp-detach')).toBe(1);
        const operations = result.events.map(event => event.kind);
        expect(operations.indexOf('report-write')).toBeGreaterThan(operations.indexOf('profile-remove'));
    });
    it('preserves a non-Error primary rejection while still releasing its acquired resources', async () => {
        const result = await invoke('control-primitive');
        primary(result, 'null'); expect(count(result, 'session-close')).toBe(1); removed(result);
    });
    it('releases acquired session and profile before an actual report EISDIR failure', async () => {
        const result = await invoke('control-fail+report-eisdir');
        expect(result.code).toBe(1); expect(result.stderr).toContain('EISDIR'); expect(result.summary.failure).toContain('CONTROLLED_PRIMARY_PAGE_FAILURE');
        expect(result.summary.cleanupErrors.join('\n')).toContain('report write'); expect(count(result, 'session-close')).toBe(1); removed(result);
    });
    it('retains the exact profile and both errors when close rejects after the primary failure', async () => {
        const result = await invoke('control-fail+close-reject');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE'); expect(result.report.cleanupErrors.join('\n')).toContain('CONTROLLED_CLOSE_FAILURE');
        expect(result.profiles[0].existsAtCliClose).toBe(true); expect(result.report.retainedProfile).toBe(result.profiles[0].path); expect(count(result, 'profile-remove')).toBe(0);
    });
    it('preserves primary, close and report failure evidence when independent cleanup fails twice', async () => {
        const result = await invoke('control-fail+close-reject+report-eisdir');
        expect(result.code).toBe(1); expect(result.summary.failure).toContain('CONTROLLED_PRIMARY_PAGE_FAILURE');
        expect(result.summary.cleanupErrors.join('\n')).toContain('CONTROLLED_CLOSE_FAILURE'); expect(result.summary.cleanupErrors.join('\n')).toContain('report write');
        expect(result.summary.retainedProfile).toBe(result.profiles[0].path); expect(result.profiles[0].existsAtCliClose).toBe(true);
    });
    it('reports profile removal failure after session closure without losing the primary failure', async () => {
        const result = await invoke('control-fail+remove-profile');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE'); expect(count(result, 'session-close')).toBe(1);
        expect(result.report.cleanupErrors.join('\n')).toContain('CONTROLLED_PROFILE_REMOVE_FAILURE'); expect(result.report.retainedProfile).toBe(result.profiles[0].path);
    });
    it('retains a replaced directory identity after close without deleting the foreign replacement', async () => {
        const result = await invoke('control-fail+ownership-swap');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE');
        const swap = result.events.find(event => event.kind === 'profile-ownership-swapped')!;
        expect(swap.replacement.symlink).toBe(false);
        expect(swap.replacement).not.toMatchObject(swap.original);
        expect(result.report.cleanupErrors.join('\n')).toContain('Temporary profile ownership changed');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(result.replacementSentinelAtCliClose).toBe('foreign replacement must survive');
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('keeps a profile when launch rejects without any exit receipt', async () => {
        const result = await invoke('launch-reject');
        primary(result, 'CONTROLLED_LAUNCH_REJECTION'); expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true); expect(count(result, 'session-close')).toBe(0);
    });
    for (const fault of ['partial-launch', 'partial-launch+report-eisdir']) {
        it(`keeps the profile of a real owned Node process after ${fault} until bounded handle teardown`, async () => {
            const result = await invoke(fault);
            expect(result.code).toBe(1); expect(result.actorAtCliClose).toMatchObject({alive: true, profileExists: true});
            expect((result.report || result.summary).retainedProfile).toBe(result.profiles[0].path);
            expect((result.report || result.summary).failure).toContain('CONTROLLED_LAUNCH_REJECTION'); expect(count(result, 'profile-remove')).toBe(0);
        });
    }
    it('deletes a profile only after the launcher receipt confirms its actual owned process was waited and gone', async () => {
        const result = await invoke('process-session+control-fail');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE'); removed(result);
        expect(result.actorAtCliClose).toMatchObject({alive: false, profileExists: false});
        expect(result.events.find(event => event.kind === 'process-exit-receipt')).toMatchObject({waited: true, gone: true});
        const operations = result.events.map(event => event.kind);
        expect(operations.indexOf('profile-remove')).toBeGreaterThan(operations.indexOf('process-exit-receipt'));
    });
    it('keeps the real owned process profile on rejected session close and then stops only that tracked handle', async () => {
        const result = await invoke('process-session+control-fail+close-reject');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE'); expect(result.actorAtCliClose).toMatchObject({alive: true, profileExists: true});
        expect(result.report.retainedProfile).toBe(result.profiles[0].path); expect(result.report.cleanupErrors.join('\n')).toContain('CONTROLLED_CLOSE_FAILURE');
    });
    for (const fault of ['cdp-load', 'cdp-load+cdp-detach']) {
        it(`detaches acquired install CDP and preserves the load error on ${fault}`, async () => {
            const result = await invoke(fault);
            primary(result, 'CONTROLLED_LOAD_FAILURE'); expect(count(result, 'cdp-detach')).toBe(1); expect(count(result, 'session-close')).toBe(1); removed(result);
            if (fault.includes('+')) expect(result.report.cleanupErrors.join('\n')).toContain('CONTROLLED_DETACH_FAILURE');
        });
    }
    it('records detach cleanup failure while continuing independent session and profile cleanup', async () => {
        const result = await invoke('cdp-detach+control-fail');
        primary(result, 'CONTROLLED_PRIMARY_PAGE_FAILURE'); expect(result.report.cleanupErrors.join('\n')).toContain('CONTROLLED_DETACH_FAILURE'); removed(result);
    });
    it('still detaches and closes when the load error is followed by actual report EISDIR', async () => {
        const result = await invoke('cdp-load+report-eisdir');
        expect(result.code).toBe(1); expect(result.summary.failure).toContain('CONTROLLED_LOAD_FAILURE');
        expect(count(result, 'cdp-detach')).toBe(1); expect(count(result, 'session-close')).toBe(1); removed(result);
    });
    for (const fault of ['interval-throw', 'interval-throw+close-reject']) {
        it(`retires its actual sampling interval before shutdown on ${fault}`, async () => {
            const result = await invoke(fault);
            primary(result, 'CONTROLLED_FRAGMENT_FAILURE'); expect(count(result, 'sampling-start')).toBe(1); expect(count(result, 'sampling-clear')).toBe(1);
            expect(result.events.find(event => event.kind === 'session-close')).toMatchObject({samplingActive: 0});
            if (fault.includes('+')) expect(result.report.cleanupErrors.join('\n')).toContain('CONTROLLED_CLOSE_FAILURE'); else removed(result);
        });
    }
    it('preserves all five real callback posts and finite sampling retirement on a normal callback return', async () => {
        const result = await invoke('interval-normal');
        expect(result.code).toBe(1); // controlled DOM has no translations; no false UI-pass claim
        expect(count(result, 'fragment-post')).toBe(5); expect(count(result, 'sampling-start')).toBe(1); expect(count(result, 'sampling-clear')).toBe(1);
        expect(result.report.samples.length).toBeGreaterThan(0); expect(result.report.checks).toHaveLength(5);
        expect(result.report.checks[0].pass).toBe(false); expect(result.report.failure).toBeUndefined();
        expect(result.events.find(event => event.kind === 'session-close')).toMatchObject({samplingActive: 0}); removed(result);
    }, 10000);
});
