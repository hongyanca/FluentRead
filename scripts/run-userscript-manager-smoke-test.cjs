#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

function parseArgs(argv) {
  if (argv[0] === '--') argv = argv.slice(1);
  const args = {
    timeout: 60000,
    installMode: 'file',
    installLabel: '从文件安装',
    saveLabel: '保存并关闭',
    installedLabel: '脚本已安装。',
    settingsMode: 'compact',
  };
  const names = new Set([
    'artifact', 'managerExtension', 'browserPath', 'playwrightRoot',
    'focusSafeHelper', 'artifactsDir', 'timeout', 'installMode',
    'installLabel', 'saveLabel', 'installedLabel',
    'settingsMode',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const key = token?.startsWith('--')
      ? token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      : '';
    const value = argv[index + 1];
    if (!names.has(key) || !value || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${token || '<missing>'}`);
    }
    args[key] = value;
  }
  for (const key of ['artifact', 'managerExtension', 'browserPath', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
    if (!args[key]) throw new Error(`Required argument: --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    args[key] = path.resolve(args[key]);
  }
  args.timeout = Number(args.timeout);
  if (!Number.isSafeInteger(args.timeout) || args.timeout < 1000) throw new Error('--timeout must be at least 1000 ms');
  if (!['file', 'url'].includes(args.installMode)) throw new Error('--install-mode must be file or url');
  if (!['compact', 'full'].includes(args.settingsMode)) throw new Error('--settings-mode must be compact or full');
  return args;
}

function requirePlaywright(root) {
  try {
    return require('playwright');
  } catch {
    return createRequire(path.join(root, '__fluentread_manager_loader__.cjs'))('playwright');
  }
}

function requireFocusSafeHelper(helperPath) {
  const helper = require(helperPath);
  for (const method of ['launchFocusSafePersistentContext', 'newPageWithoutForeground']) {
    if (typeof helper[method] !== 'function') throw new Error(`Focus-safe helper lacks ${method}`);
  }
  return helper;
}

function readUserscriptMetadata(source) {
  if (!source.startsWith('// ==UserScript==\n')) throw new Error('Artifact lacks userscript metadata');
  const version = source.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
  const requires = [...source.matchAll(/^\/\/ @require\s+(\S+)$/gm)].map((match) => match[1]);
  if (requires.some((url) => !url.startsWith('https://')
    && !/^http:\/\/127\.0\.0\.1:\d+\/fluentread-(?:vendor|data)\.v1\.js$/u.test(url))) {
    throw new Error('Unsupported userscript @require URL in manager smoke test');
  }
  if (!version) throw new Error('Artifact lacks a version declaration');
  return {version, requires};
}

function managerName(extensionPath, manifest) {
  const key = /^__MSG_(.+)__$/.exec(manifest.name)?.[1];
  if (!key) return manifest.name;
  const localePath = path.join(extensionPath, '_locales', manifest.default_locale, 'messages.json');
  if (!fs.existsSync(localePath)) return manifest.name;
  const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
  return messages[key]?.message || manifest.name;
}

async function startFixture(artifactBytes) {
  const original = 'FluentRead keeps the original paragraph and adds a safe bilingual translation.';
  const adjacent = 'This adjacent paragraph must stay untouched during hover translation.';
  const server = http.createServer((request, response) => {
    if (request.url === '/candidate.user.js') {
      response.writeHead(200, {'content-type': 'application/javascript; charset=utf-8'});
      response.end(artifactBytes);
      return;
    }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluentRead manager smoke</title></head><body><main><h1>FluentRead manager smoke</h1><p id="target">${original}</p><p id="adjacent">${adjacent}</p></main></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    original,
    adjacent,
    url: `http://127.0.0.1:${server.address().port}/fixture`,
    installUrl: `http://127.0.0.1:${server.address().port}/candidate.user.js`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withSettingsShadow(page, callback, values = []) {
  const cdp = await page.context().newCDPSession(page);
  let objectId;
  try {
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
    const find = (node) => {
      const attributes = node.attributes || [];
      if (attributes.includes('id')
        && attributes[attributes.indexOf('id') + 1] === 'fluent-read-userscript-settings-container') return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    const shadow = find(root)?.shadowRoots?.[0];
    if (!shadow) throw new Error('Settings closed Shadow DOM was not found by browser inspection');
    const resolved = await cdp.send('DOM.resolveNode', {nodeId: shadow.nodeId});
    objectId = resolved.object.objectId;
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: callback.toString(),
      arguments: values.map((value) => ({value})),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } finally {
    if (objectId) await cdp.send('Runtime.releaseObject', {objectId}).catch(() => {});
    await cdp.detach();
  }
}

async function readFloatingBallSetting(page) {
  return withSettingsShadow(page, function () {
    const label = [...this.querySelectorAll('label.toggle')]
      .find((item) => item.textContent.includes('显示全文翻译悬浮球'));
    const input = label?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error('Floating ball setting was not found');
    return input.checked;
  });
}

async function saveFloatingBallSetting(page, enabled, timeout) {
  const before = await withSettingsShadow(page, function (nextValue) {
    const label = [...this.querySelectorAll('label.toggle')]
      .find((item) => item.textContent.includes('显示全文翻译悬浮球'));
    const input = label?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error('Floating ball setting was not found');
    const previous = input.checked;
    if (previous !== nextValue) input.click();
    const save = this.querySelector('footer button.primary');
    if (!save || save.disabled) throw new Error('Settings save button is not ready');
    save.click();
    return previous;
  }, [enabled]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const status = await withSettingsShadow(page, function () {
      return this.querySelector('footer .status')?.textContent || '';
    });
    if (status.includes('设置已保存')) return {before, status};
    if (status.includes('保存失败')) throw new Error(`Settings save failed: ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Settings did not report a completed save');
}

async function hoverToggle(page, expected, timeout) {
  const box = await page.locator('#target').boundingBox();
  if (!box) throw new Error('Hover target is not visible');
  const x = box.x + Math.min(Math.max(box.width * .35, 10), box.width - 10);
  const y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  await page.waitForFunction((count) =>
    document.querySelectorAll('#target .fluent-read-bilingual-content').length === count,
  expected, {timeout});
  return page.evaluate(() => ({
    count: document.querySelectorAll('#target .fluent-read-bilingual-content').length,
    original: document.querySelector('#target')?.firstChild?.textContent,
    translation: document.querySelector('#target .fluent-read-bilingual-content')?.textContent || '',
    adjacent: document.querySelector('#adjacent')?.textContent,
    adjacentTranslations: document.querySelectorAll('#adjacent .fluent-read-bilingual-content').length,
    url: location.href,
  }));
}

async function fullPageToggle(page, expected, timeout) {
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
  await page.waitForFunction((count) => ['#target', '#adjacent'].every((selector) =>
    document.querySelectorAll(`${selector} .fluent-read-bilingual-content`).length === count),
  expected, {timeout});
  return page.evaluate(() => ({
    count: document.querySelectorAll('#target .fluent-read-bilingual-content').length,
    original: document.querySelector('#target')?.firstChild?.textContent,
    translation: document.querySelector('#target .fluent-read-bilingual-content')?.textContent || '',
    adjacentCount: document.querySelectorAll('#adjacent .fluent-read-bilingual-content').length,
    adjacentOriginal: document.querySelector('#adjacent')?.firstChild?.textContent,
    adjacentTranslation: document.querySelector('#adjacent .fluent-read-bilingual-content')?.textContent || '',
    url: location.href,
  }));
}

async function readHostDexie(page) {
  return page.evaluate(() => {
    const value = window[Symbol.for('Dexie')];
    return {
      semVer: value?.semVer,
      owner: value?.owner,
      sameInstance: value === window.__fluentReadHostDexieBeforeInjection,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['artifact', 'managerExtension', 'browserPath', 'focusSafeHelper']) {
    if (!fs.existsSync(args[key])) throw new Error(`Missing ${key}: ${args[key]}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(args.managerExtension, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('This smoke test expects a Manifest V3 userscript manager');
  const artifactBytes = fs.readFileSync(args.artifact);
  const metadata = readUserscriptMetadata(artifactBytes.toString('utf8'));
  const {chromium} = requirePlaywright(args.playwrightRoot);
  const focusSafe = requireFocusSafeHelper(args.focusSafeHelper);
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-userscript-manager-'));
  let session;
  let fixture;
  const evidence = {
    manager: `${managerName(args.managerExtension, manifest)} ${manifest.version}`,
    userscriptVersion: metadata.version,
    browserPath: args.browserPath,
    artifact: args.artifact,
    installMode: args.installMode,
    requires: metadata.requires,
    responses: [],
    requestFailures: [],
    consoleErrors: [],
  };
  try {
    fixture = await startFixture(artifactBytes);
    session = await focusSafe.launchFocusSafePersistentContext({
      chromium,
      profileDir: profile,
      browserPath: args.browserPath,
      headless: false,
      background: true,
      browserArgs: [
        '--no-first-run',
        '--no-default-browser-check',
        `--disable-extensions-except=${args.managerExtension}`,
        `--load-extension=${args.managerExtension}`,
      ],
      viewport: {width: 1280, height: 900},
      timeout: args.timeout,
    });
    evidence.launchMode = session.launchMode;
    if (evidence.launchMode !== 'macos-background-cdp') throw new Error('Browser did not use focus-safe background CDP launch');
    const context = session.context;
    await context.addInitScript(() => {
      if (location.pathname !== '/fixture') return;
      const hostDexie = Object.freeze({semVer: '4.4.4', owner: 'host-page-fixture'});
      Object.defineProperty(window, '__fluentReadHostDexieBeforeInjection', {value: hostDexie});
      window[Symbol.for('Dexie')] = hostDexie;
    });
    const requested = new Set(metadata.requires);
    const successfulRequires = new Set();
    context.on('response', (response) => {
      if (!requested.has(response.url())) return;
      evidence.responses.push({url: response.url(), status: response.status()});
    });
    context.on('requestfinished', (request) => {
      if (!requested.has(request.url())) return;
      void request.response().then((response) => {
        if (response && response.status() >= 200 && response.status() < 400) successfulRequires.add(request.url());
      }).catch((error) => {
        evidence.requestFailures.push({url: request.url(), error: error.message});
      });
    });
    context.on('requestfailed', (request) => {
      if (requested.has(request.url())) evidence.requestFailures.push({url: request.url(), error: request.failure()?.errorText});
    });
    const isManagerWorker = (worker) => worker.url().endsWith('/sw.js');
    const worker = context.serviceWorkers().find(isManagerWorker)
      || await context.waitForEvent('serviceworker', {predicate: isManagerWorker, timeout: args.timeout});
    const managerId = new URL(worker.url()).host;
    evidence.managerId = managerId;
    const managerPage = await focusSafe.newPageWithoutForeground(context, args.timeout);
    await managerPage.goto(`chrome://extensions/?id=${managerId}`, {waitUntil: 'domcontentloaded'});
    const permission = managerPage.locator('extensions-detail-view extensions-toggle-row#allow-user-scripts');
    await permission.waitFor({state: 'visible', timeout: args.timeout});
    if (await permission.getAttribute('checked') === null) await permission.locator('cr-toggle').click();
    if (await permission.getAttribute('checked') === null) throw new Error('User scripts permission did not enable');

    const installStartedAt = Date.now();
    if (args.installMode === 'file') {
      await managerPage.goto(`chrome-extension://${managerId}/options/index.html`, {waitUntil: 'domcontentloaded'});
      const [chooser] = await Promise.all([
        managerPage.waitForEvent('filechooser', {timeout: args.timeout}),
        managerPage.getByText(args.installLabel, {exact: true}).click(),
      ]);
      await chooser.setFiles(args.artifact);
      await managerPage.getByText(args.saveLabel, {exact: true}).click();
      await managerPage.getByText('FluentRead-流畅阅读', {exact: false}).first().waitFor({timeout: args.timeout});
    } else {
      // Opening a .user.js URL follows the same confirmation path as a public script link.
      // Violentmonkey redirects the navigation, which may reject the original goto promise.
      try {
        await managerPage.goto(fixture.installUrl, {waitUntil: 'domcontentloaded'});
      } catch (error) {
        if (!managerPage.url().includes('/confirm/index.html')) throw error;
      }
      await managerPage.waitForURL(/\/confirm\/index\.html/, {timeout: args.timeout});
      await managerPage.locator('button#confirm').click({timeout: args.timeout});
      await managerPage.getByText(args.installedLabel, {exact: false}).waitFor({timeout: args.timeout});
      await managerPage.goto(`chrome-extension://${managerId}/options/index.html`, {waitUntil: 'domcontentloaded'});
      await managerPage.waitForFunction((version) => {
        const text = document.body.innerText;
        return text.includes('FluentRead-流畅阅读') && text.includes(version);
      }, metadata.version, {timeout: args.timeout});
      evidence.dashboardRegistered = true;
    }
    // The editor can close while Violentmonkey is still downloading @require files.
    // A new tab opened in that interval can receive the entry before Vue is available.
    while (successfulRequires.size < requested.size && Date.now() - installStartedAt < args.timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    evidence.requireReadyMs = Date.now() - installStartedAt;
    if (successfulRequires.size < requested.size) throw new Error('Script manager did not finish @require downloads');
    evidence.managerInstalled = true;

    const page = await focusSafe.newPageWithoutForeground(context, args.timeout);
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => evidence.consoleErrors.push((error.stack || error.message).slice(0, 600)));
    await page.goto(fixture.url, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => Boolean(
      document.querySelector('#fluent-read-page-styles')
      && document.querySelector('#fluent-read-floating-ball-container')
    ), undefined, {timeout: args.timeout});
    evidence.initial = await page.evaluate(() => ({
      url: location.href,
      original: document.querySelector('#target')?.textContent,
      pageVue: typeof window.Vue,
      pageElementPlus: typeof window.ElementPlus,
      pageVendor: typeof window.FluentReadUserscriptVendor,
    }));
    evidence.hostDexieBefore = await readHostDexie(page);
    if (evidence.hostDexieBefore.semVer !== '4.4.4'
      || evidence.hostDexieBefore.owner !== 'host-page-fixture'
      || !evidence.hostDexieBefore.sameInstance) {
      throw new Error(`Userscript changed the host Dexie singleton: ${JSON.stringify(evidence.hostDexieBefore)}`);
    }
    evidence.desktopScreenshot = path.join(args.artifactsDir, 'desktop.png');
    evidence.mobileScreenshot = path.join(args.artifactsDir, 'mobile.png');
    await page.screenshot({path: evidence.desktopScreenshot});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: evidence.mobileScreenshot});
    await page.setViewportSize({width: 1280, height: 900});

    evidence.hover = [];
    for (const count of [1, 0, 1, 0]) {
      const state = await hoverToggle(page, count, args.timeout);
      evidence.hover.push(state);
      if (state.count !== count || state.original !== fixture.original
        || state.adjacent !== fixture.adjacent || state.adjacentTranslations !== 0
        || state.url !== fixture.url || (count === 1 && !/[\u3400-\u9fff]/u.test(state.translation))) {
        throw new Error(`Manager-backed hover translation failed: ${JSON.stringify(state)}`);
      }
    }
    evidence.hostDexieAfterHover = await readHostDexie(page);
    if (!evidence.hostDexieAfterHover.sameInstance) throw new Error('Hover translation replaced the host Dexie singleton');

    if (args.settingsMode === 'full') {
      // A trusted click invokes the installed manager's GM.openInTab path.
      // Directly navigating to the hash would miss a broken settings entry.
      await page.evaluate(() => {
        const trigger = document.createElement('button');
        trigger.id = 'fluentread-test-open-settings';
        trigger.textContent = 'Open FluentRead settings';
        trigger.addEventListener('click', () => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
        document.body.appendChild(trigger);
      });
      const openedPage = context.waitForEvent('page', {timeout: args.timeout});
      await page.locator('#fluentread-test-open-settings').click();
      const settingsPage = await openedPage;
      await settingsPage.waitForURL(/#fluentread-userscript-settings(?:\/|$)/, {timeout: args.timeout});
      evidence.settingsTabUrl = settingsPage.url();
      if (!evidence.settingsTabUrl.startsWith(fixture.url)) throw new Error('Settings tab opened outside the current fixture origin');
      await page.evaluate(() => document.querySelector('#fluentread-test-open-settings')?.remove());
      settingsPage.on('console', (message) => {
        if (message.type() === 'error') evidence.consoleErrors.push(`settings: ${message.text().slice(0, 300)}`);
      });
      settingsPage.on('pageerror', (error) => evidence.consoleErrors.push(`settings: ${error.message.slice(0, 300)}`));
      await settingsPage.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
      evidence.settings = await withSettingsShadow(settingsPage, function () {
        return {
          fullOptions: Boolean(this.querySelector('.settings-app button[data-section="settings-services"]')),
          closedShadow: this.host.shadowRoot === null,
        };
      });
      evidence.settings.pageIsolation = await settingsPage.evaluate(() => ({
        floatingBall: document.querySelectorAll('#fluent-read-floating-ball-container').length,
        contentStyles: document.querySelectorAll('#fluent-read-page-styles').length,
        rootClass: document.documentElement.className,
        rootStyle: document.documentElement.getAttribute('style'),
      }));
      if (!evidence.settings.fullOptions || !evidence.settings.closedShadow
        || evidence.settings.pageIsolation.floatingBall || evidence.settings.pageIsolation.contentStyles
        || evidence.settings.pageIsolation.rootClass || evidence.settings.pageIsolation.rootStyle) {
        throw new Error(`Manager-backed full Options isolation failed: ${JSON.stringify(evidence.settings)}`);
      }
      await withSettingsShadow(settingsPage, function () {
        this.querySelector('button[data-section="settings-video"]')?.click();
      });
      const unavailableStartedAt = Date.now();
      while (Date.now() - unavailableStartedAt < args.timeout) {
        evidence.settings.videoUnavailable = await withSettingsShadow(settingsPage, function () {
          const notice = this.querySelector('#settings-video.userscript-unavailable');
          return Boolean(notice?.textContent?.includes('油猴脚本暂不支持此功能'))
            && !notice.querySelector('input, button, [role="switch"]');
        });
        if (evidence.settings.videoUnavailable) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!evidence.settings.videoUnavailable) throw new Error('Manager-backed video section still exposes unsupported controls');
      await withSettingsShadow(settingsPage, function () {
        this.querySelector('button[data-section="settings-general"]')?.click();
      });
      const generalStartedAt = Date.now();
      while (Date.now() - generalStartedAt < args.timeout) {
        const generalReady = await withSettingsShadow(settingsPage, function () {
          return Boolean(this.querySelector('[role="radiogroup"][aria-label="界面主题"] button'));
        });
        if (generalReady) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await withSettingsShadow(settingsPage, function () {
        const dark = [...this.querySelectorAll('[role="radiogroup"][aria-label="界面主题"] button')]
          .find((button) => button.textContent.trim() === '暗色主题');
        if (!dark) throw new Error('Full Options theme control was not found');
        dark.click();
      });
      await settingsPage.waitForFunction(() => document.querySelector('#fluent-read-userscript-settings-container') !== null);
      const startedAt = Date.now();
      while (Date.now() - startedAt < args.timeout) {
        const dark = await withSettingsShadow(settingsPage, function () { return this.host.classList.contains('dark'); });
        if (dark) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await settingsPage.waitForTimeout(350);
      await settingsPage.reload({waitUntil: 'domcontentloaded'});
      await settingsPage.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
      await settingsPage.waitForFunction(() => document.querySelector('#fluent-read-userscript-settings-container') !== null);
      await settingsPage.waitForTimeout(250);
      evidence.settings.persistedTheme = await withSettingsShadow(settingsPage, function () {
        return [...this.querySelectorAll('[role="radiogroup"][aria-label="界面主题"] button')]
          .find((button) => button.textContent.trim() === '暗色主题')?.getAttribute('aria-checked');
      });
      if (evidence.settings.persistedTheme !== 'true') throw new Error('Full Options theme did not persist across manager-backed reload');
      const readFloatingBallSwitch = () => withSettingsShadow(settingsPage, function () {
        const control = this.querySelector('[role="switch"][aria-label="全文翻译悬浮球"]');
        if (!control) throw new Error('Full Options floating ball switch was not found');
        return control.getAttribute('aria-checked') === 'true';
      });
      const waitForFloatingBallSwitch = async (expected) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < args.timeout) {
          try {
            if (await readFloatingBallSwitch() === expected) return;
          } catch {
            // The closed Shadow UI can attach before the Vue control mounts.
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Full Options floating ball switch did not reach ${expected}`);
      };
      const setFloatingBallSwitch = async (enabled) => {
        await withSettingsShadow(settingsPage, function (nextValue) {
          const control = this.querySelector('[role="switch"][aria-label="全文翻译悬浮球"]');
          if (!control) throw new Error('Full Options floating ball switch was not found');
          if ((control.getAttribute('aria-checked') === 'true') !== nextValue) control.click();
        }, [enabled]);
        const startedAt = Date.now();
        while (Date.now() - startedAt < args.timeout) {
          // Userscript GM storage refreshes when the source tab regains focus.
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          const visible = await page.locator('#fluent-read-floating-ball-container').count() > 0;
          if (visible === enabled) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Full Options floating ball change did not reach the source page: ${enabled}`);
      };
      evidence.settings.floatingBallInitiallyEnabled = await readFloatingBallSwitch();
      if (!evidence.settings.floatingBallInitiallyEnabled) throw new Error('Floating ball started disabled in the full Options smoke');
      await setFloatingBallSwitch(false);
      await settingsPage.reload({waitUntil: 'domcontentloaded'});
      await settingsPage.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
      await waitForFloatingBallSwitch(false);
      evidence.settings.floatingBallDisabledAfterReload = await readFloatingBallSwitch();
      if (evidence.settings.floatingBallDisabledAfterReload) throw new Error('Full Options floating ball disable did not persist');
      await setFloatingBallSwitch(true);
      await settingsPage.reload({waitUntil: 'domcontentloaded'});
      await settingsPage.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
      await waitForFloatingBallSwitch(true);
      evidence.settings.floatingBallReenabledAfterReload = await readFloatingBallSwitch();
      if (!evidence.settings.floatingBallReenabledAfterReload) throw new Error('Full Options floating ball reenable did not persist');
      evidence.settings.themePreservedAfterFloatingBall = await withSettingsShadow(settingsPage, function () {
        const selected = [...this.querySelectorAll('[role="radiogroup"][aria-label="界面主题"] button')]
          .find((button) => button.textContent.trim() === '暗色主题');
        return this.host.classList.contains('dark') && selected?.getAttribute('aria-checked') === 'true';
      });
      if (!evidence.settings.themePreservedAfterFloatingBall) throw new Error('Floating ball edits overwrote the saved theme');
      evidence.settingsScreenshot = path.join(args.artifactsDir, 'full-options.png');
      await settingsPage.screenshot({path: evidence.settingsScreenshot});
      await settingsPage.close();

      const toggle = (expected) => fullPageToggle(page, expected, args.timeout);
      evidence.translated = await toggle(1);
      evidence.restored = await toggle(0);
      evidence.retranslated = await toggle(1);
      if (evidence.translated.original !== fixture.original || evidence.restored.original !== fixture.original
        || evidence.retranslated.original !== fixture.original
        || [evidence.translated, evidence.restored, evidence.retranslated].some((state, index) =>
          state.adjacentOriginal !== fixture.adjacent || state.adjacentCount !== [1, 0, 1][index])
        || !/[\u3400-\u9fff]/u.test(evidence.retranslated.translation)
        || !/[\u3400-\u9fff]/u.test(evidence.retranslated.adjacentTranslation)
        || evidence.consoleErrors.length || evidence.requestFailures.length) {
        throw new Error('Manager-backed translation or restore failed after full Options use');
      }
      evidence.windowPlacement = session.windowPlacement;
      evidence.focusPolicy = session.focusPolicy;
      if (evidence.windowPlacement?.browserFrontmost !== false
        || evidence.focusPolicy !== 'launchservices-no-foreground') throw new Error('Browser focus isolation failed');
      evidence.status = 'passed';
      console.log(`Verified full Options userscript ${metadata.version} in ${evidence.manager}; evidence: ${args.artifactsDir}`);
      return;
    }

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    await page.waitForFunction(() => Boolean(document.querySelector('#fluent-read-userscript-settings-container')), undefined, {timeout: args.timeout});
    evidence.settings = await page.evaluate(() => ({
      open: Boolean(document.querySelector('#fluent-read-userscript-settings-container')),
      closedShadow: document.querySelector('#fluent-read-userscript-settings-container')?.shadowRoot === null,
    }));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-close-settings')));

    const toggle = (expected) => fullPageToggle(page, expected, args.timeout);
    evidence.translated = await toggle(1);
    evidence.translatedScreenshot = path.join(args.artifactsDir, 'translated.png');
    await page.screenshot({path: evidence.translatedScreenshot});
    evidence.restored = await toggle(0);
    evidence.retranslated = await toggle(1);

    // Exercise the actual manager-backed GM storage, not just a simulated API.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    await page.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
    evidence.persistence = {initial: await readFloatingBallSetting(page)};
    if (!evidence.persistence.initial) throw new Error('Floating ball was disabled before persistence test');
    evidence.persistence.disabled = await saveFloatingBallSetting(page, false, args.timeout);
    await page.locator('#fluent-read-floating-ball-container').waitFor({state: 'detached', timeout: args.timeout});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => Boolean(document.querySelector('#fluent-read-page-styles')), undefined, {timeout: args.timeout});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    await page.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
    evidence.persistence.afterReload = await readFloatingBallSetting(page);
    evidence.hostDexieAfterReload = await readHostDexie(page);
    if (!evidence.hostDexieAfterReload.sameInstance) throw new Error('Reload replaced the host Dexie singleton');
    if (evidence.persistence.afterReload || await page.locator('#fluent-read-floating-ball-container').count()) {
      throw new Error('Floating ball preference was lost after reloading the userscript page');
    }
    evidence.persistence.reenabled = await saveFloatingBallSetting(page, true, args.timeout);
    await page.locator('#fluent-read-floating-ball-container').waitFor({state: 'attached', timeout: args.timeout});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-close-settings')));
    evidence.windowPlacement = session.windowPlacement;
    evidence.focusPolicy = session.focusPolicy;

    for (const url of metadata.requires) {
      if (!successfulRequires.has(url)) throw new Error(`@require did not return success: ${url}`);
    }
    if (evidence.requestFailures.length || evidence.consoleErrors.length) throw new Error('Network or console errors occurred');
    if (evidence.initial.original !== fixture.original) throw new Error('Initial source text changed');
    if (evidence.initial.pageVue !== 'undefined' || evidence.initial.pageElementPlus !== 'undefined'
      || evidence.initial.pageVendor !== 'undefined') {
      throw new Error('Userscript leaked library globals into the host page');
    }
    if (!evidence.settings.open || !evidence.settings.closedShadow) throw new Error('Settings did not open in a closed Shadow DOM');
    if ([evidence.translated, evidence.restored, evidence.retranslated].some((state, index) =>
      state.original !== fixture.original || state.adjacentOriginal !== fixture.adjacent
      || state.count !== [1, 0, 1][index] || state.adjacentCount !== [1, 0, 1][index]
      || state.url !== fixture.url)) throw new Error('Translation altered the original page');
    if (!/[\u3400-\u9fff]/u.test(evidence.translated.translation)
      || !/[\u3400-\u9fff]/u.test(evidence.translated.adjacentTranslation)
      || !/[\u3400-\u9fff]/u.test(evidence.retranslated.translation)
      || !/[\u3400-\u9fff]/u.test(evidence.retranslated.adjacentTranslation)) {
      throw new Error('Translation did not produce Chinese text');
    }
    if (evidence.windowPlacement?.mode !== 'background-visible-no-focus'
      || evidence.windowPlacement.browserFrontmost !== false
      || evidence.focusPolicy !== 'launchservices-no-foreground') throw new Error('Browser focus isolation failed');
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(args.artifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
    try {
      if (session) await session.close();
    } finally {
      if (fixture) await fixture.close();
      fs.rmSync(profile, {recursive: true, force: true});
    }
  }
  console.log(`Verified userscript ${metadata.version} in ${evidence.manager}; evidence: ${args.artifactsDir}`);
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {parseArgs, readUserscriptMetadata};
