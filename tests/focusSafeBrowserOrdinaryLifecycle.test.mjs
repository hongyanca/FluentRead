/**
 * @file tests/focusSafeBrowserOrdinaryLifecycle.test.mjs
 * 验证公开普通 Playwright session 的返回前生命周期：通过 SDK/page.evaluate
 * 端口注入居中错误，使用真实 parent-owned Node actor 的 FD、interval 和退出
 * 回执验证资源回收。只使用 SDK 替身，不启动浏览器、osascript 或前台窗口。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as nativeFs from 'node:fs';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {Script} from 'node:vm';

const helperPath = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/testing/focus-safe-browser.cjs');
const realRequire = createRequire(helperPath);
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

const ownedActorSource = "'use strict';\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst directory = process.argv[1];\nconst fd = fs.openSync(path.join(directory, 'held-fd'), 'a');\nlet ticks = 0;\nlet finishing = false;\nconst interval = setInterval(() => { fs.writeSync(fd, '.'); ticks += 1; }, 10);\nconst deadline = setTimeout(() => finish('fixture-deadline'), 20000);\nfunction finish(reason) {\n  if (finishing) return;\n  finishing = true;\n  clearInterval(interval);\n  clearTimeout(deadline);\n  const stoppedAt = ticks;\n  fs.closeSync(fd);\n  let fdClosed = false;\n  try { fs.fstatSync(fd); } catch (error) { fdClosed = error.code === 'EBADF'; }\n  setTimeout(() => {\n    const receipt = {kind: 'released', pid: process.pid, reason, fdClosed, timerStopped: ticks === stoppedAt, ticks};\n    fs.writeFileSync(path.join(directory, 'resource-receipt.json'), JSON.stringify(receipt));\n    process.send(receipt, () => { if (process.connected) process.disconnect(); });\n  }, 40);\n}\nprocess.on('message', value => { if (value === 'release') finish('parent-release'); });\nprocess.send({kind: 'ready', pid: process.pid});\n";

async function bounded(promise, label, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function startOwnedActor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fluentread-ordinary-lifecycle-'));
  const child = spawn(process.execPath, ['-e', ownedActorSource, directory], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  let releaseReceipt;
  let didExit = false;
  let releaseTask;
  let readyResolve, readyReject;
  const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  const closed = new Promise(resolveClosed => child.once('close', (code, signal) => resolveClosed({code, signal})));
  child.on('message', message => {
    if (message.kind === 'ready') readyResolve(message);
    if (message.kind === 'released') releaseReceipt = message;
  });
  child.on('error', error => readyReject(error));
  child.once('exit', () => { didExit = true; readyReject(new Error('Actor exited before ready: ' + stderr)); });
  const owner = {
    child, directory,
    get didExit() { return didExit; },
    async release() {
      releaseTask ||= (async () => {
        if (!didExit && child.connected) {
          await new Promise((resolveSend, rejectSend) => child.send('release', error => error ? rejectSend(error) : resolveSend()));
        }
        const exit = await bounded(closed, 'Owned actor close');
        assert.equal(exit.code, 0, stderr);
        assert.equal(exit.signal, null);
        assert.ok(releaseReceipt, 'Actor release receipt must arrive before ChildProcess close');
        assert.equal(releaseReceipt.pid, child.pid);
        assert.equal(releaseReceipt.reason, 'parent-release');
        assert.equal(releaseReceipt.fdClosed, true);
        assert.equal(releaseReceipt.timerStopped, true);
        assert.ok(releaseReceipt.ticks > 0, 'The real interval must have written through the open FD');
        assert.equal(didExit, true);
        const saved = JSON.parse(await readFile(join(directory, 'resource-receipt.json'), 'utf8'));
        assert.deepEqual(saved, releaseReceipt);
        return releaseReceipt;
      })();
      return releaseTask;
    },
  };
  t.after(async () => {
    // Only this parent-owned fixture is removed, after actual close/FD/timer proof.
    await owner.release();
    await rm(directory, {recursive: true, force: true});
  });
  const message = await bounded(ready, 'Owned actor ready');
  assert.equal(message.pid, child.pid);
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
  await bounded((async () => {
    while ((await stat(join(directory, 'held-fd'))).size === 0) await delay(10);
  })(), 'Owned actor first real FD write');
  return owner;
}

async function assertLive(owner) {
  assert.equal(owner.didExit, false);
  assert.equal(owner.child.exitCode, null);
  assert.equal(owner.child.connected, true);
  const before = (await stat(join(owner.directory, 'held-fd'))).size;
  await delay(60);
  const after = (await stat(join(owner.directory, 'held-fd'))).size;
  assert.ok(after > before, 'The retained actual actor must still hold and write its FD with its interval');
}

function loadPublicHelper(t) {
  const stats = {guardCalls: 0, processActions: 0, filesystemMutations: 0, execCalls: 0, activeTimers: new Set()};
  const forbiddenProcessAction = () => { stats.processActions += 1; throw new Error('Ordinary context must not use process actions'); };
  const forbiddenFilesystemMutation = () => { stats.filesystemMutations += 1; throw new Error('Helper must retain the ordinary profile'); };
  const fsPort = {...nativeFs};
  for (const name of ['rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'writeFileSync']) fsPort[name] = forbiddenFilesystemMutation;
  const execFile = () => { throw new Error('Native execFile must not run'); };
  execFile[promisify.custom] = async (file, args) => {
    stats.execCalls += 1;
    assert.equal(file, '/usr/bin/osascript');
    assert.ok(args.some(value => String(value).includes('NSScreen.screens')));
    // SDK success case screen-query port only; no native program is executed.
    const main = {x: 0, y: 0, width: 1600, height: 1000};
    return {stdout: JSON.stringify({main, screens: [{index: 0, frame: main, visible: main, isMain: true}]}), stderr: ''};
  };
  const injectedRequire = specifier => {
    if (specifier === './owned-browser-close.cjs') return {guardBrowserClose() {
      stats.guardCalls += 1;
      throw new Error('Ordinary persistent context must not be auto-guarded');
    }};
    if (specifier === 'node:child_process') return {execFile};
    if (specifier === 'node:fs') return fsPort;
    return realRequire(specifier);
  };
  const module = {exports: {}};
  const trackedSetTimeout = (callback, milliseconds) => {
    const handle = setTimeout(() => { stats.activeTimers.delete(handle); callback(); }, milliseconds);
    stats.activeTimers.add(handle);
    return handle;
  };
  const trackedClearTimeout = handle => { clearTimeout(handle); stats.activeTimers.delete(handle); };
  t.after(() => {
    const outstanding = stats.activeTimers.size;
    for (const handle of stats.activeTimers) clearTimeout(handle);
    stats.activeTimers.clear();
    assert.equal(outstanding, 0, 'Helper cleanup deadline must be cleared on every outcome');
  });
  new Script(nativeFs.readFileSync(helperPath, 'utf8'), {filename: helperPath}).runInNewContext({
    module, exports: module.exports, require: injectedRequire, console,
    process: {platform: process.platform, kill: forbiddenProcessAction, exit: forbiddenProcessAction, on: forbiddenProcessAction, once: forbiddenProcessAction, off: forbiddenProcessAction},
    setTimeout: trackedSetTimeout, clearTimeout: trackedClearTimeout,
  });
  return {api: module.exports, stats};
}

function sdkPorts(owner, {centeringError, nullBrowser = false, close = () => owner.release()} = {}) {
  const calls = {launch: 0, close: 0, evaluate: 0, browser: 0, windowBounds: 0};
  const page = {async evaluate() {
    calls.evaluate += 1;
    if (centeringError) throw centeringError;
    return {screen: {left: 0, top: 0, width: 1600, height: 1000}, outerWidth: 1280, outerHeight: 900};
  }};
  const browser = {async newBrowserCDPSession() { return {
    async send(method) {
      if (method === 'Browser.getWindowForTarget') return {windowId: 1};
      assert.equal(method, 'Browser.setWindowBounds');
      calls.windowBounds += 1;
      return {};
    }, async detach() {},
  }; }};
  const context = {
    pages: () => [page],
    async newPage() { throw new Error('Existing SDK page should be used'); },
    async newCDPSession(requestedPage) {
      assert.equal(requestedPage, page);
      return {async send(method) { assert.equal(method, 'Target.getTargetInfo'); return {targetInfo: {targetId: 'sdk-page-target'}}; }, async detach() {}};
    },
    browser() { calls.browser += 1; return nullBrowser ? null : browser; },
    close() { calls.close += 1; return close(); },
  };
  const chromium = {async launchPersistentContext(profileDir) {
    calls.launch += 1;
    assert.equal(profileDir, owner.directory);
    return context;
  }};
  return {chromium, context, calls};
}

function launch(api, sdk, owner, headless = false) {
  // SDK port invocation only: no real headed browser or foreground operation.
  return api.launchFocusSafePersistentContext({chromium: sdk.chromium, profileDir: owner.directory,
    browserPath: process.execPath, background: false, headless, viewport: {width: 1280, height: 900}});
}

async function rejection(action) {
  try { await action(); } catch (error) { return error; }
  assert.fail('Expected the public launch operation to reject');
}

function assertOrdinaryPorts(stats) {
  assert.equal(stats.guardCalls, 0);
  assert.equal(stats.processActions, 0);
  assert.equal(stats.filesystemMutations, 0);
  assert.equal(stats.activeTimers.size, 0);
}

function assertPrimaryAndClose(error, originalError, closeError) {
  assert.notEqual(closeError, originalError, 'Cleanup error must be independently preserved');
  assert.equal(error.name, 'AggregateError');
  assert.equal(error.cause, originalError);
  assert.equal(error.errors.length, 2);
  assert.equal(error.errors[0], originalError);
  assert.equal(error.errors[1], closeError);
}

const options = {timeout: 10000, concurrency: false};

test('normal headless context.browser() null still closes its owned FD/timer actor', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const sdk = sdkPorts(owner, {nullBrowser: true});
  assert.equal(sdk.context.browser(), null);
  sdk.calls.browser = 0;
  const session = await launch(api, sdk, owner, true);
  assert.equal(session.context, sdk.context);
  assert.equal(session.launchMode, 'playwright-headless');
  assert.equal(session.focusPolicy, 'headless');
  assert.equal(session.windowPlacement, null);
  assert.equal(session.closeBrowserConnection, undefined);
  assert.equal(session.useGuardedClose, undefined);
  assert.equal(sdk.calls.evaluate, 0);
  assert.equal(sdk.calls.browser, 0);
  await session.close();
  assert.equal(sdk.calls.close, 1);
  assert.equal(owner.didExit, true);
  assert.equal(nativeFs.existsSync(owner.directory), true);
  assertOrdinaryPorts(stats);
});

test('normal headed SDK success preserves centering metadata and direct context.close', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const sdk = sdkPorts(owner);
  const session = await launch(api, sdk, owner);
  assert.equal(session.context, sdk.context);
  assert.equal(session.launchMode, 'playwright-headed');
  assert.equal(session.focusPolicy, 'foreground-authorized');
  assert.equal(session.windowPlacement.mode, 'headed-centered');
  assert.equal(session.windowPlacement.centered, true);
  assert.equal(sdk.calls.evaluate, 1);
  assert.equal(sdk.calls.windowBounds, 1);
  assert.equal(sdk.calls.close, 0);
  await session.close();
  assert.equal(sdk.calls.close, 1);
  assert.equal(owner.didExit, true);
  assertOrdinaryPorts(stats);
});

test('centering error survives fulfilled close after actual actor FD/timer release', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const originalError = new Error('Injected page.evaluate centering failure');
  const sdk = sdkPorts(owner, {centeringError: originalError, nullBrowser: true});
  const error = await rejection(() => launch(api, sdk, owner));
  assert.equal(error, originalError);
  assert.equal(sdk.calls.evaluate, 1);
  assert.equal(sdk.calls.close, 1);
  assert.equal(sdk.calls.browser, 0);
  assert.equal(owner.didExit, true);
  assert.equal(nativeFs.existsSync(owner.directory), true);
  assertOrdinaryPorts(stats);
});

test('centering and rejected close retain independent errors even after actor release', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const originalError = new Error('Injected centering failure');
  const closeError = new Error('Injected close rejection');
  const sdk = sdkPorts(owner, {centeringError: originalError, close: async () => { await owner.release(); throw closeError; }});
  const error = await rejection(() => launch(api, sdk, owner));
  assertPrimaryAndClose(error, originalError, closeError);
  assert.equal(sdk.calls.close, 1);
  assert.equal(owner.didExit, true);
  assert.equal(nativeFs.existsSync(owner.directory), true);
  assertOrdinaryPorts(stats);
});

test('synchronous close throw retains primary and leaves actual live actor for its parent', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const originalError = new Error('Injected centering failure');
  const closeError = new Error('Injected synchronous close failure');
  const sdk = sdkPorts(owner, {centeringError: originalError, close: () => { throw closeError; }});
  const error = await rejection(() => launch(api, sdk, owner));
  assertPrimaryAndClose(error, originalError, closeError);
  assert.equal(sdk.calls.close, 1);
  await assertLive(owner);
  assertOrdinaryPorts(stats);
  await owner.release();
  assert.equal(owner.didExit, true);
});

test('bounded close timeout preserves primary while actor is live; late fulfillment reclaims it', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const originalError = new Error('Injected centering failure');
  let continueClose;
  const gate = new Promise(resolveGate => { continueClose = resolveGate; });
  const closeTask = gate.then(() => owner.release());
  const sdk = sdkPorts(owner, {centeringError: originalError, close: () => closeTask});
  const error = await rejection(() => launch(api, sdk, owner));
  assertPrimaryAndClose(error, originalError, error.errors[1]);
  assert.equal(error.errors[1].code, 'CONTEXT_CLOSE_TIMEOUT');
  assert.equal(sdk.calls.close, 1);
  await assertLive(owner);
  assertOrdinaryPorts(stats);
  continueClose();
  await closeTask;
  assert.equal(owner.didExit, true);
  assert.equal(error.cause, originalError);
  assert.equal(error.errors[0], originalError);
});

test('late close rejection after timeout cannot replace primary or leak an unhandled rejection', options, async t => {
  const owner = await startOwnedActor(t);
  const {api, stats} = loadPublicHelper(t);
  const originalError = new Error('Injected centering failure');
  const lateCloseError = new Error('Injected late close rejection');
  const unhandled = [];
  const observeUnhandled = error => { unhandled.push(error); };
  process.on('unhandledRejection', observeUnhandled);
  t.after(() => { process.off('unhandledRejection', observeUnhandled); });
  let continueClose;
  const gate = new Promise(resolveGate => { continueClose = resolveGate; });
  const closeTask = gate.then(async () => { await owner.release(); throw lateCloseError; });
  const sdk = sdkPorts(owner, {centeringError: originalError, close: () => closeTask});
  const error = await rejection(() => launch(api, sdk, owner));
  assertPrimaryAndClose(error, originalError, error.errors[1]);
  const timeoutError = error.errors[1];
  assert.equal(timeoutError.code, 'CONTEXT_CLOSE_TIMEOUT');
  await assertLive(owner);
  assertOrdinaryPorts(stats);
  continueClose();
  await owner.release();
  await delay(30);
  assert.deepEqual(unhandled, []);
  assert.equal(error.cause, originalError);
  assert.equal(error.errors[0], originalError);
  assert.equal(error.errors[1], timeoutError);
  assert.equal(owner.didExit, true);
});
