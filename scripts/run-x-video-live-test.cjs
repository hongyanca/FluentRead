#!/usr/bin/env node

/*
 * Focus-safe live X video UI regression. This intentionally does not prepare or
 * start a local ASR model: it validates player discovery, ownership, controls,
 * menu geometry, and config-off cleanup against public X pages.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

const PROFILE_URL = 'https://x.com/cerebras';
const STATUS_URL = 'https://x.com/cerebras/status/2089870131291943228';
const DEFAULT_BROWSER = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function fail(message) { throw new Error(message); }

function readArgs(argv) {
  const result = {
    extensionDir: process.env.FLUENTREAD_EXTENSION_DIR || '',
    artifactsDir: '/private/tmp/x-video-live-proof',
    playwrightRoot: process.env.PLAYWRIGHT_ROOT || '',
    focusSafeHelper: process.env.FLUENTREAD_FOCUS_SAFE_HELPER || '',
    browserPath: process.env.FLUENTREAD_BROWSER_PATH || DEFAULT_BROWSER,
    extensionInstall: process.env.FLUENTREAD_EXTENSION_INSTALL || 'cdp',
    background: true,
    timeout: 30_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--headed') { result.background = false; continue; }
    if (!token.startsWith('--')) fail(`无法识别参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`参数缺少值：${token}`);
    if (key === 'timeout') result.timeout = Number(value);
    else result[key] = value;
    index += 1;
  }
  if (!result.extensionDir) fail('必须传入 --extension-dir');
  if (!result.playwrightRoot) fail('必须传入 --playwright-root');
  if (result.background && !result.focusSafeHelper) fail('后台模式必须传入 --focus-safe-helper');
  if (result.extensionInstall !== 'cdp' && result.extensionInstall !== 'flags') fail('--extension-install 必须是 cdp 或 flags');
  result.extensionDir = path.resolve(result.extensionDir);
  result.artifactsDir = path.resolve(result.artifactsDir);
  if (result.focusSafeHelper) result.focusSafeHelper = path.resolve(result.focusSafeHelper);
  if (!Number.isFinite(result.timeout) || result.timeout < 5_000) fail('--timeout 必须至少为 5000 毫秒');
  if (result.background && !fs.existsSync(result.focusSafeHelper)) fail(`找不到 focus-safe helper：${result.focusSafeHelper}`);
  if (!fs.existsSync(result.extensionDir)) fail(`找不到扩展构建：${result.extensionDir}`);
  if (!fs.existsSync(result.browserPath)) fail(`找不到浏览器：${result.browserPath}`);
  return result;
}

function loadPlaywright(root) {
  try { return require('playwright'); } catch (error) {
    const loader = createRequire(path.join(path.resolve(root), '__fluentread_x_video_live_test__.cjs'));
    return loader('playwright');
  }
}

function loadFocusSafe(helperPath) {
  const helper = require(helperPath);
  for (const name of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) {
    if (typeof helper[name] !== 'function') fail(`focus-safe helper 缺少 ${name}`);
  }
  return helper;
}

function rectValue(rect) {
  return rect ? {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height} : null;
}

async function screenshotAndDom(page, artifactsDir, phase, report) {
  if (!page || page.isClosed()) return;
  const png = path.join(artifactsDir, `${phase}.png`);
  const html = path.join(artifactsDir, `${phase}.html`);
  try {
    await page.screenshot({path: png});
    await fs.promises.writeFile(html, await page.content());
    report.evidence.push({phase, screenshot: png, dom: html});
  } catch (error) {
    report.evidenceErrors.push(`${phase}: ${error.stack || error}`);
  }
}

async function readPageState(page) {
  return page.evaluate(() => {
    const rectData = rect => rect ? {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height} : null;
    const videos = [...document.querySelectorAll('video')].map((video, index) => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return {
        index,
        src: video.currentSrc || video.src || '',
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState,
        rect: {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height},
        display: style.display,
        visibility: style.visibility,
      };
    });
    const button = document.querySelector('#fluent-read-video-subtitle-button');
    const player = button?.closest('.fluent-read-video-player-host') || button?.closest('#movie_player, .html5-video-player, [data-testid="videoPlayer"]') || null;
    const menu = document.querySelector('#fluent-read-video-subtitle-menu');
    const fallback = player?.querySelector('.fluent-read-video-controls') || null;
    const parent = button?.parentElement || null;
    const parentChain = button ? (() => {
      const chain = [];
      let current = button.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        chain.push({tag: current.tagName, id: current.id, className: typeof current.className === 'string' ? current.className : ''});
      }
      return chain;
    })() : [];
    const visible = element => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const videosWithGeometry = videos.filter(video => video.rect.width > 0 && video.rect.height > 0);
    const selectedVideo = player ? [...player.querySelectorAll('video')].find(video => video.currentSrc || video.src) : null;
    const hostAnchor = selectedVideo?.closest('article')?.querySelector('a[href*="/status/"]') || null;
    const hostAnchorRect = hostAnchor?.getBoundingClientRect() || null;
    let hostAnchorCenterHit = '';
    let hostAnchorCenterHref = '';
    if (hostAnchorRect && hostAnchorRect.width > 0 && hostAnchorRect.height > 0) {
      const hit = document.elementFromPoint(hostAnchorRect.left + hostAnchorRect.width / 2, hostAnchorRect.top + hostAnchorRect.height / 2);
      hostAnchorCenterHit = hit?.tagName || '';
      hostAnchorCenterHref = hit?.closest('a')?.getAttribute('href') || '';
    }
    return {
      url: location.href,
      title: document.title,
      visibilityState: document.visibilityState,
      bodyText: (document.body?.innerText || '').slice(0, 500),
      loginSignals: document.querySelectorAll('input[type="password"], a[href*="/login"], [data-testid*="login" i], [data-testid*="signup" i]').length,
      videoCount: videos.length,
      videos,
      playerVideoIndex: player ? [...document.querySelectorAll('video')].indexOf(player.querySelector('video')) : -1,
      videosWithGeometry: videosWithGeometry.length,
      button: button ? {
        connected: button.isConnected,
        disabled: button.disabled,
        rect: rectData(button.getBoundingClientRect()),
        parentTag: parent?.tagName || '',
        parentClass: typeof parent?.className === 'string' ? parent.className : '',
        playerClass: typeof player?.className === 'string' ? player.className : '',
        active: player?.getAttribute('data-fluent-read-video-active') || '',
        fullscreen: player?.getAttribute('data-fluent-read-video-fullscreen') || '',
        progress: button.getAttribute('data-fluent-read-video-progress'),
        visible: visible(button),
        parentChain,
      } : null,
      fallback: fallback ? {
        connected: fallback.isConnected,
        rect: rectData(fallback.getBoundingClientRect()),
        visible: visible(fallback),
        parentClass: typeof fallback.parentElement?.className === 'string' ? fallback.parentElement.className : '',
      } : null,
      menu: menu ? {
        connected: menu.isConnected,
        hidden: menu.hidden,
        rect: rectData(menu.getBoundingClientRect()),
        visible: visible(menu),
        parentId: menu.parentElement?.id || '',
        parentClass: typeof menu.parentElement?.className === 'string' ? menu.parentElement.className : '',
        buttonSamePlayer: Boolean(menu.parentElement && player && menu.parentElement === player),
      } : null,
      fullscreenElement: document.fullscreenElement?.tagName || '',
      hostAnchor: hostAnchor ? {
        href: hostAnchor.getAttribute('href') || '',
        rect: rectData(hostAnchorRect),
        centerHit: hostAnchorCenterHit,
        centerHitHref: hostAnchorCenterHref,
        centerHitFluentRead: Boolean(hostAnchorCenterHref && !hostAnchorCenterHref.includes('/status/')),
      } : null,
    };
  });
}

function classifyBlocking(state) {
  const text = `${state.title || ''} ${state.bodyText || ''}`.toLowerCase();
  return state.loginSignals > 0 || /login|sign in|log in|验证码|登录|加入 x/.test(text)
    || /\/login(?:[/?#]|$)/i.test(state.url);
}

async function waitForVideo(page, timeout) {
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(video => {
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }), null, {timeout});
}

async function pickVisibleVideo(page) {
  const index = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('video')].map((video, index) => {
      const rect = video.getBoundingClientRect();
      const visibleArea = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left))
        * Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
      return {index, visibleArea, area: rect.width * rect.height, duration: Number.isFinite(video.duration) ? video.duration : 0, src: video.currentSrc || video.src};
    }).filter(candidate => candidate.area > 0);
    // Main media can load after a reply GIF. Prefer what the user is actually
    // looking at instead of scrolling to a loaded but off-screen reply.
    candidates.sort((left, right) => right.visibleArea - left.visibleArea || Number(Boolean(right.src)) - Number(Boolean(left.src)) || right.duration - left.duration || right.area - left.area);
    return candidates[0]?.index ?? -1;
  });
  return index >= 0 ? page.locator('video').nth(index) : null;
}

async function hoverVisibleVideo(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const video = await pickVisibleVideo(page);
    if (!video) return null;
    try {
      await video.scrollIntoViewIfNeeded({timeout: 10_000});
      // Public X players may put a link or an unnamed overlay above the video.
      // Move the real pointer to its visible center: hovering <video> itself
      // would wait for that legitimate overlay to stop intercepting events.
      const point = await video.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return rect.width > 0 && rect.height > 0 && document.elementFromPoint(x, y)
          ? {x, y, videoIndex: [...document.querySelectorAll('video')].indexOf(element)} : null;
      });
      if (!point) continue;
      await page.mouse.move(point.x, point.y);
      return {videoIndex: point.videoIndex};
    } catch {
      await page.waitForTimeout(500);
    }
  }
  return null;
}

async function persistPluginState(control, enabled) {
  return control.evaluate(async nextEnabled => {
    const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!response?.success) throw new Error(`configStorageRead failed: ${JSON.stringify(response)}`);
    const current = typeof response.value === 'string' ? JSON.parse(response.value) : response.value || {};
    return chrome.runtime.sendMessage({
      type: 'persistConfig',
      clientId: 'x-video-live-ui-regression',
      sequence: Date.now(),
      config: {
        ...current,
        on: nextEnabled,
        videoTranslationEnabled: true,
        videoSubtitleVisible: true,
        videoSubtitleDisplayMode: 'bilingual',
      },
      ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {}),
    });
  }, enabled);
}

async function inspectControls(page, report, phase) {
  const state = await readPageState(page);
  report.phases[phase] = state;
  if (state.button) {
    const parent = state.button.parentClass || '';
    state.controls = {
      native: /ytp-right-controls|settings|control/i.test(parent),
      fallback: /fluent-read-video-controls/.test(parent),
      hierarchy: state.button.parentChain,
    };
  }
  return state;
}

async function inspectMenu(page, report, phase) {
  const button = page.locator('#fluent-read-video-subtitle-button');
  if (await button.count() !== 1) {
    report.phases[phase] = await inspectControls(page, report, phase);
    report.phases[phase].menuAttempt = 'button-unavailable';
    return report.phases[phase];
  }
  await button.hover({timeout: 10_000});
  await button.click({timeout: 10_000});
  const menu = page.locator('#fluent-read-video-subtitle-menu');
  try {
    await menu.waitFor({state: 'visible', timeout: 5_000});
  } catch {
    await button.click({timeout: 10_000});
    await menu.waitFor({state: 'visible', timeout: 5_000});
  }
  return inspectControls(page, report, phase);
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  const playwright = loadPlaywright(options.playwrightRoot);
  const focusSafe = options.background ? loadFocusSafe(options.focusSafeHelper) : null;
  fs.mkdirSync(options.artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-x-video-live-'));
  const report = {
    success: false,
    blocked: [],
    extensionDir: options.extensionDir,
    browserPath: options.browserPath,
    profileMode: 'temporary-auto-cleaned',
    profileDir,
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    urls: {profile: PROFILE_URL, status: STATUS_URL},
    phases: {},
    evidence: [],
    evidenceErrors: [],
    pageErrors: [],
    consoleErrors: [],
    assertions: {},
  };
  let session;
  let control;
  let page;
  try {
    session = await (options.background
      ? focusSafe.launchFocusSafePersistentContext({
        chromium: playwright.chromium,
        profileDir,
        browserPath: options.browserPath,
        headless: false,
        background: true,
        displayTarget: 'secondary',
        viewport: {width: 1280, height: 900},
        browserArgs: [
          '--no-first-run', '--no-default-browser-check',
          ...(options.extensionInstall === 'cdp'
            ? ['--enable-unsafe-extension-debugging']
            : [`--disable-extensions-except=${options.extensionDir}`, `--load-extension=${options.extensionDir}`]),
        ],
        timeout: options.timeout,
      })
      : playwright.chromium.launchPersistentContext(profileDir, {
        executablePath: options.browserPath,
        headless: false,
        viewport: {width: 1280, height: 900},
        args: [
          '--no-first-run', '--no-default-browser-check',
          ...(options.extensionInstall === 'cdp'
            ? ['--enable-unsafe-extension-debugging']
            : [`--disable-extensions-except=${options.extensionDir}`, `--load-extension=${options.extensionDir}`]),
        ],
      }));
    const context = session.context || session;
    report.launchMode = session.launchMode || 'playwright-headed';
    report.focusPolicy = session.focusPolicy || 'foreground-authorized';
    report.windowPlacement = session.windowPlacement || {mode: 'headed-explicit-foreground', windowState: 'normal', viewport: {width: 1280, height: 900}};
    if (options.background && report.windowPlacement.browserFrontmost !== false) fail(`focus-safe 窗口前台状态异常：${JSON.stringify(report.windowPlacement)}`);

    let extensionId = '';
    if (options.extensionInstall === 'cdp') {
      const extensionSession = await context.browser().newBrowserCDPSession();
      const loaded = await extensionSession.send('Extensions.loadUnpacked', {path: options.extensionDir});
      extensionId = loaded.id;
      await extensionSession.detach();
    }
    const workerPredicate = candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/`);
    const workers = context.serviceWorkers().filter(worker => extensionId ? workerPredicate(worker) : worker.url().startsWith('chrome-extension://'));
    const worker = workers[0] || await context.waitForEvent('serviceworker', {predicate: extensionId ? workerPredicate : undefined, timeout: options.timeout});
    extensionId ||= new URL(worker.url()).host;
    report.extensionId = extensionId;
    report.extensionInstall = options.extensionInstall;
    const newPage = () => options.background ? focusSafe.newPageWithoutForeground(context, options.timeout) : context.newPage();
    const activationContext = {serviceWorkers: () => [worker]};
    const activate = tab => options.background ? focusSafe.activateExtensionTabWithoutForeground(activationContext, tab, options.timeout) : undefined;

    control = await newPage();
    let configPort = control;
    try {
      await control.goto(`chrome-extension://${extensionId}/options.html`, {waitUntil: 'domcontentloaded', timeout: options.timeout});
    } catch (error) {
      report.controlPageError = error.message;
      await control.close().catch(() => undefined);
      control = null;
      configPort = worker;
      report.configControl = 'service-worker-fallback';
    }
    await persistPluginState(configPort, true);

    page = await newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message || String(error)));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });

    await page.goto(PROFILE_URL, {waitUntil: 'domcontentloaded', timeout: 45_000}).catch(error => { report.profileNavigationError = error.message; });
    await activate(page);
    await page.waitForTimeout(2_000);
    const profileInitial = await inspectControls(page, report, 'profile-initial');
    report.profileLoginPromptObserved = classifyBlocking(profileInitial);
    try { await waitForVideo(page, 12_000); } catch (error) { report.profileVideoWaitError = error.message; }
    const profileVideo = await pickVisibleVideo(page);
    if (profileVideo) {
      report.profileHoverTarget = await hoverVisibleVideo(page);
      if (!report.profileHoverTarget) report.profileVideoHoverError = '三次重试后仍未能将鼠标移入可见视频';
      await page.waitForTimeout(900);
      const hovered = await inspectControls(page, report, 'profile-hover');
      report.assertions.profileVideoHoverEntry = Boolean(hovered.button?.connected);
      report.assertions.profileHostLinkObserved = Boolean(hovered.hostAnchor);
      report.assertions.profileHostLinkNormal = Boolean(hovered.hostAnchor && !hovered.hostAnchor.centerHitFluentRead);
      await screenshotAndDom(page, options.artifactsDir, 'profile-hover', report);

      await page.mouse.move(2, 2);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.waitForTimeout(700);
      const lostHover = await inspectControls(page, report, 'profile-lost-hover');
      report.assertions.fallbackHiddenAfterLostHover = !lostHover.fallback || !lostHover.fallback.visible;
      await screenshotAndDom(page, options.artifactsDir, 'profile-lost-hover', report);
    } else {
      report.blocked.push({phase: 'profile', reason: classifyBlocking(profileInitial) ? 'login-or-site-block' : 'no-visible-video'});
      await screenshotAndDom(page, options.artifactsDir, 'profile-no-video', report);
    }

    await page.goto(STATUS_URL, {waitUntil: 'domcontentloaded', timeout: 45_000}).catch(error => { report.statusNavigationError = error.message; });
    await activate(page);
    await page.waitForTimeout(2_000);
    const statusInitial = await inspectControls(page, report, 'status-initial');
    report.statusLoginPromptObserved = classifyBlocking(statusInitial);
    try { await waitForVideo(page, 12_000); } catch (error) { report.statusVideoWaitError = error.message; }
    const statusVideo = await pickVisibleVideo(page);
    if (!statusVideo) {
      report.blocked.push({phase: 'status', reason: classifyBlocking(statusInitial) ? 'login-or-site-block' : 'no-visible-video'});
      await screenshotAndDom(page, options.artifactsDir, 'status-no-video', report);
    } else {
      report.statusHoverTarget = await hoverVisibleVideo(page);
      if (!report.statusHoverTarget) report.statusVideoHoverError = '三次重试后仍未能将鼠标移入可见视频';
      await page.waitForTimeout(900);
      const statusHover = await inspectControls(page, report, 'status-hover');
      report.assertions.statusEntryPresent = Boolean(statusHover.button?.connected);
      report.assertions.nativeControlsOrFallback = Boolean(statusHover.controls);
      report.assertions.statusHostLinkObserved = Boolean(statusHover.hostAnchor);
      report.assertions.statusHostLinkNormal = Boolean(statusHover.hostAnchor && !statusHover.hostAnchor.centerHitFluentRead);
      await screenshotAndDom(page, options.artifactsDir, 'status-hover', report);

      const menuState = await inspectMenu(page, report, 'status-menu');
      report.assertions.menuVisible = Boolean(menuState.menu?.visible);
      report.assertions.menuSamePlayer = Boolean(menuState.menu?.buttonSamePlayer);
      report.assertions.menuOwnsHoveredVideo = Boolean(report.statusHoverTarget && menuState.playerVideoIndex === report.statusHoverTarget.videoIndex);
      await screenshotAndDom(page, options.artifactsDir, 'status-menu', report);

      const fullscreenControl = page.locator('[aria-label*="Full screen" i]:visible, [aria-label*="Fullscreen" i]:visible, [aria-label*="全屏"]:visible');
      if (await fullscreenControl.count()) {
        try {
          await fullscreenControl.first().click({timeout: 10_000});
          await page.waitForFunction(() => Boolean(document.fullscreenElement), null, {timeout: 5_000});
          const fullscreenState = await inspectControls(page, report, 'status-fullscreen');
          report.assertions.fullscreenSelectedVideo = Boolean(fullscreenState.fullscreenElement);
          report.assertions.fullscreenMenuSamePlayer = Boolean(fullscreenState.menu?.buttonSamePlayer);
          await screenshotAndDom(page, options.artifactsDir, 'status-fullscreen', report);
        } catch (error) {
          report.fullscreenError = error.message;
          await screenshotAndDom(page, options.artifactsDir, 'status-fullscreen-failed', report);
        }
      } else {
        report.fullscreen = 'native-control-unavailable';
      }
      const statusButton = page.locator('#fluent-read-video-subtitle-button');
      if (await statusButton.count()) {
        await statusButton.click({timeout: 10_000}).catch(() => undefined);
        await page.mouse.move(2, 2);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await page.waitForTimeout(700);
        const statusIdle = await inspectControls(page, report, 'status-lost-hover-focus');
        report.assertions.statusFallbackHiddenAfterLostHover = !statusIdle.fallback || !statusIdle.fallback.visible;
        await screenshotAndDom(page, options.artifactsDir, 'status-lost-hover-focus', report);
      }
    }

    await persistPluginState(configPort, false);
    await page.waitForTimeout(1_200);
    const configOff = await inspectControls(page, report, 'config-off');
    report.assertions.globalConfigOffRemovesIcon = !configOff.button;
    await screenshotAndDom(page, options.artifactsDir, 'config-off', report);

    const required = [
      'statusEntryPresent',
      'menuVisible',
      'menuSamePlayer',
      'menuOwnsHoveredVideo',
      'globalConfigOffRemovesIcon',
    ];
    report.success = required.every(key => report.assertions[key] === true) && report.blocked.length === 0;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page) await screenshotAndDom(page, options.artifactsDir, 'failure', report);
  } finally {
    report.reportPath = path.join(options.artifactsDir, 'report.json');
    await fs.promises.writeFile(report.reportPath, JSON.stringify(report, null, 2));
    if (session?.close) await session.close().catch(() => undefined);
    else if (session) await session.close().catch(() => undefined);
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
  process.stdout.write(`${JSON.stringify({
    success: report.success,
    blocked: report.blocked,
    assertions: report.assertions,
    launchMode: report.launchMode,
    focusPolicy: report.focusPolicy,
    browserFrontmost: report.windowPlacement?.browserFrontmost,
    reportPath: report.reportPath,
    evidence: report.evidence,
    error: report.error ? String(report.error).split('\n')[0] : undefined,
  })}\n`);
  if (!report.success) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

module.exports = {readArgs, classifyBlocking};
