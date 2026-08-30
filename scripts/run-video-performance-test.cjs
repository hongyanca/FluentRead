#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadPlaywright(root) {
  try { return require('playwright'); } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_video_performance_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

function readArg(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function parseArgs(argv, env = process.env) {
  const args = {
    extensionDir: readArg(argv, 'extension-dir', '.output/chrome-mv3'),
    playwrightRoot: readArg(argv, 'playwright-root', env.PLAYWRIGHT_ROOT),
    url: readArg(argv, 'url', 'https://www.youtube.com/watch?v=dqONk48l5vY'),
    browserPath: readArg(argv, 'browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    focusSafeHelper: readArg(argv, 'focus-safe-helper', env.FLUENTREAD_FOCUS_SAFE_HELPER || ''),
    background: !argv.includes('--headed'),
  };
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root 或设置 PLAYWRIGHT_ROOT');
  if (args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper 或设置 FLUENTREAD_FOCUS_SAFE_HELPER');
  }
  args.extensionDir = path.resolve(args.extensionDir);
  if (args.focusSafeHelper) args.focusSafeHelper = path.resolve(args.focusSafeHelper);
  return args;
}

function loadFocusSafeBrowser(helperPath) {
  if (!fs.existsSync(helperPath)) throw new Error(`找不到后台浏览器辅助脚本：${helperPath}`);
  const helper = require(helperPath);
  for (const name of [
    'launchFocusSafePersistentContext',
    'newPageWithoutForeground',
    'activateExtensionTabWithoutForeground',
  ]) {
    if (typeof helper[name] !== 'function') throw new Error(`后台浏览器辅助脚本缺少接口：${name}`);
  }
  return helper;
}

function assertDedicatedTemporaryProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝使用非临时浏览器 profile：${resolved}`);
  }
}

function metricsMap(payload) {
  return new Map((payload.metrics || []).map((metric) => [metric.name, metric.value]));
}

async function measurePage(chromium, { label, extensionDir, url, browserPath, background, focusSafe }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `fluentread-video-performance-${label}-`));
  assertDedicatedTemporaryProfile(profileDir);
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (extensionDir) {
    args.push(`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`);
  }

  let context;
  let closeBrowser = async () => { if (context) await context.close().catch(() => undefined); };
  let createIsolatedPage;
  let activateTestPage = async () => undefined;
  let launchMode;
  let focusPolicy;
  let windowPlacement;
  try {
    if (background) {
      const browserSession = await focusSafe.launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath,
        headless: false,
        background: true,
        browserArgs: args,
        viewport: { width: 1280, height: 900 },
      });
      context = browserSession.context;
      closeBrowser = browserSession.close;
      createIsolatedPage = () => focusSafe.newPageWithoutForeground(context);
      launchMode = browserSession.launchMode;
      focusPolicy = browserSession.focusPolicy;
      windowPlacement = browserSession.windowPlacement;
      if (extensionDir) {
        activateTestPage = page => focusSafe.activateExtensionTabWithoutForeground(context, page);
      }
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: browserPath,
        headless: false,
        args,
        viewport: { width: 1280, height: 900 },
      });
      closeBrowser = () => context.close();
      createIsolatedPage = () => context.newPage();
      launchMode = 'playwright-headed';
      focusPolicy = 'foreground-authorized';
      windowPlacement = { mode: 'headed-explicit-foreground', windowState: 'normal', viewport: { width: 1280, height: 900 } };
    }

    const page = await createIsolatedPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message || String(error)));
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
    await activateTestPage(page);
    await page.waitForTimeout(5000);
    const before = metricsMap(await client.send('Performance.getMetrics'));
    const wallStart = before.get('Timestamp') || 0;
    await page.waitForTimeout(8000);
    const after = metricsMap(await client.send('Performance.getMetrics'));
    const wallSeconds = Math.max(0, (after.get('Timestamp') || 0) - wallStart);
    const taskSeconds = Math.max(0, (after.get('TaskDuration') || 0) - (before.get('TaskDuration') || 0));
    const scriptSeconds = Math.max(0, (after.get('ScriptDuration') || 0) - (before.get('ScriptDuration') || 0));
    const layoutSeconds = Math.max(0, (after.get('LayoutDuration') || 0) - (before.get('LayoutDuration') || 0));

    return {
      label,
      wallSeconds: Number(wallSeconds.toFixed(2)),
      taskSeconds: Number(taskSeconds.toFixed(2)),
      taskShare: Number((wallSeconds > 0 ? taskSeconds / wallSeconds : 0).toFixed(3)),
      scriptSeconds: Number(scriptSeconds.toFixed(2)),
      layoutSeconds: Number(layoutSeconds.toFixed(2)),
      extensionButtonPresent: Boolean(await page.locator('#fluent-read-video-subtitle-button').count()),
      pageErrorCount: pageErrors.length,
      launchMode,
      focusPolicy,
      windowPlacement,
    };
  } finally {
    await closeBrowser();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {extensionDir, playwrightRoot, url, browserPath} = args;
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);
  if (!fs.existsSync(browserPath)) throw new Error(`找不到浏览器：${browserPath}`);

  const { chromium } = loadPlaywright(playwrightRoot);
  const focusSafe = args.background ? loadFocusSafeBrowser(args.focusSafeHelper) : null;
  const enabled = await measurePage(chromium, {
    label: 'extension-on', extensionDir, url, browserPath, background: args.background, focusSafe,
  });
  const baseline = await measurePage(chromium, {
    label: 'extension-off', extensionDir: null, url, browserPath, background: args.background, focusSafe,
  });
  console.log(JSON.stringify({
    ok: enabled.pageErrorCount === 0 && baseline.pageErrorCount === 0,
    url,
    enabled,
    baseline,
    taskShareDelta: Number((enabled.taskShare - baseline.taskShare).toFixed(3)),
    launchMode: enabled.launchMode,
    focusPolicy: enabled.focusPolicy,
    windowPlacement: enabled.windowPlacement,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {parseArgs};
