#!/usr/bin/env node

// 这个脚本只使用临时 Edge profile 和真实 Alt+T 键盘手势，回归全文翻译的
// 识别、按钮特殊处理、富文本结构、动态节点、Shadow DOM 以及恢复流程。
// 传入 --verify-floating-ui 时，还会从 closed Shadow DOM 读取悬浮球透明度、
// 展开/收起、勾选标记几何与离屏任务下的进度面板显隐。
// 它不会连接用户正在使用的浏览器 profile，也不会通过 JS 合成键盘事件。

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function parseArgs(argv) {
  const args = {
    url: null,
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    timeout: 120000,
    // 当前 main 的默认服务是“免费翻译服务”，内部按微软、DeepLX、谷歌顺序回退；
    // --service 只用于断言已预置的隔离 profile 配置，不会偷偷修改服务选择。
    service: 'freeTranslation',
    // 仅在本次临时 profile 中写入服务，便于把“回退服务慢”和“全文机制问题”分开。
    // 不传此参数时，脚本不会修改任何配置。
    configureService: null,
    focusSafeHelper: null,
    verifyFloatingUi: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--background') continue;
    if (token === '--headed') {
      args.background = false;
      continue;
    }
    if (token === '--verify-floating-ui') {
      args.verifyFloatingUi = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    args[key] = value;
    index += 1;
  }
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout 必须为正数');
  if (!args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  if (args.service !== 'freeTranslation' || (args.configureService && args.configureService !== 'freeTranslation')) {
    throw new Error('全文本地 fixture 只允许 freeTranslation；真实 provider 必须使用显式 network matrix');
  }
  if (args.url) {
    const url = new URL(args.url);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error('全文本地 fixture 只允许 loopback URL；真实站点必须使用显式 network matrix');
    }
  }
  if (args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper，确保真实浏览器不抢占前台焦点');
  }
  if (args.focusSafeHelper) args.focusSafeHelper = path.resolve(args.focusSafeHelper);
  return args;
}

function createFixtureRequestHandler(html) {
  return (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (pathname !== '/unified-translation-fixture.html') {
      response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  };
}

function buildFixtureMicrosoftResponseBody(payload) {
  const texts = Array.isArray(payload) ? payload.map((value) => String(value)) : [];
  return JSON.stringify(texts.map((text) => ({
    translations: [{text: `测试译文：${text}`}],
  })));
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function startTranslationFixtureServer(unexpectedNetworkRequests = [], responseDelayMs = 0) {
  let requestCount = 0;
  let translatedItemCount = 0;
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'POST' && requestUrl.pathname === '/translate') {
      let payload = [];
      try {
        payload = JSON.parse(await readRequestBody(request));
      } catch {
        payload = [];
      }
      requestCount += 1;
      translatedItemCount += Array.isArray(payload) ? payload.length : 0;
      if (responseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
      }
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(buildFixtureMicrosoftResponseBody(payload));
      return;
    }
    if (requestUrl.pathname === '/blocked') {
      unexpectedNetworkRequests.push(requestUrl.searchParams.get('url') || 'unknown');
      response.writeHead(502, {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end('External network is disabled in the full-page fixture');
      return;
    }
    response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
    response.end('Not found');
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('无法取得全文翻译响应 fixture server 地址');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    translationUrl: `${baseUrl}/translate`,
    blockedUrl: `${baseUrl}/blocked`,
    requestCount: () => requestCount,
    translatedItemCount: () => translatedItemCount,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function installTranslationFixtureOnWorker(worker, fixtureUrls) {
  await worker.evaluate(({translationUrl, blockedUrl}) => {
    if (globalThis.__fluentReadFullPageFixtureFetchInstalled) return;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const requestUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const parsedUrl = new URL(requestUrl);
      const isMicrosoftTranslation = parsedUrl.hostname === 'edge.microsoft.com'
        && parsedUrl.pathname === '/translate/translatetext';
      if (isMicrosoftTranslation) {
        const redirectedInput = typeof Request !== 'undefined' && input instanceof Request
          ? new Request(translationUrl, input)
          : translationUrl;
        return nativeFetch(redirectedInput, init);
      }
      if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')
          && !['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
        return nativeFetch(`${blockedUrl}?url=${encodeURIComponent(requestUrl)}`, {method: 'GET'});
      }
      return nativeFetch(input, init);
    };
    globalThis.__fluentReadFullPageFixtureFetchInstalled = true;
  }, fixtureUrls);
}

function assertNoRuntimeErrors(runtimeErrors) {
  if (runtimeErrors.length > 0) {
    throw new Error(`全文翻译浏览器回归出现运行时错误：${JSON.stringify(runtimeErrors)}`);
  }
}

function assertDeterministicFixtureTraffic(fixtureTranslationRequestCount, unexpectedNetworkRequests) {
  if (fixtureTranslationRequestCount <= 0) {
    throw new Error('全文本地 fixture 未命中确定性微软翻译路由');
  }
  if (unexpectedNetworkRequests.length > 0) {
    throw new Error(`全文本地 fixture 尝试访问未授权网络：${JSON.stringify(unexpectedNetworkRequests)}`);
  }
}

async function startFixtureServer() {
  const fixturePath = path.resolve(__dirname, '../tests/fixtures/unified-translation-fixture.html');
  const html = fs.readFileSync(fixturePath);
  const server = http.createServer(createFixtureRequestHandler(html));
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('无法取得全文翻译 fixture server 地址');
  }
  return {
    url: `http://127.0.0.1:${address.port}/unified-translation-fixture.html`,
    isListening: () => server.listening,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const resolvedRoot = path.resolve(root);
    const loader = createRequire(path.join(resolvedRoot, '__fluentread_full_page_loader__.cjs'));
    return loader('playwright');
  }
}

function loadFocusSafeBrowser(helperPath) {
  if (!helperPath) throw new Error('必须传入 --focus-safe-helper，确保真实浏览器在后台隔离运行');
  if (!fs.existsSync(helperPath)) throw new Error(`找不到后台浏览器辅助脚本：${helperPath}`);
  const helper = require(helperPath);
  for (const name of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) {
    if (typeof helper[name] !== 'function') throw new Error(`后台浏览器辅助脚本缺少接口：${name}`);
  }
  return helper;
}

function assertDedicatedProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const home = os.homedir();
  const forbidden = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Microsoft Edge'),
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/microsoft-edge'),
  ];
  if (forbidden.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  })) {
    throw new Error(`拒绝使用日常浏览器 profile：${resolved}`);
  }
}

async function waitFor(page, predicate, timeout, description) {
  await page.waitForFunction(predicate, undefined, { timeout });
  if (description) return description;
}

async function readConfig(context, timeout, updates = null, createPage = () => context.newPage()) {
  const workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent('serviceworker', { timeout: Math.min(timeout, 30000) });
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('没有找到扩展 service worker');
  const popup = await createPage();
  try {
    await popup.goto(`chrome-extension://${match[1]}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const config = await popup.evaluate(async ({configUpdates, timeoutMs}) => {
      const parseRecord = (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        if (typeof value !== 'string') return {};
        try {
          const parsed = JSON.parse(value);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return {};
        }
      };
      const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message || '扩展后台消息失败'));
            return;
          }
          resolve(response);
        });
      });
      const readConfigRecord = async (key) => {
        const response = await sendRuntimeMessage({type: 'configStorageRead', key});
        if (response?.success !== true) throw new Error(response?.error || `后台配置读取失败：${key}`);
        return response.value ?? null;
      };
      const readCompleteConfig = async () => {
        const [storedConfig, localCredentials, sessionCredentials] = await Promise.all([
          readConfigRecord('local:config'),
          readConfigRecord('local:credentials'),
          readConfigRecord('session:credentials'),
        ]);
        const publicConfig = parseRecord(storedConfig);
        const credentialRecord = localCredentials && typeof localCredentials === 'object'
          ? localCredentials
          : sessionCredentials && typeof sessionCredentials === 'object'
            ? sessionCredentials
            : null;
        const credentials = credentialRecord ? {...credentialRecord} : {};
        delete credentials.schemaVersion;
        return {
          config: {...publicConfig, ...credentials},
          revision: publicConfig.__fluentConfigRevision,
        };
      };

      let current = await readCompleteConfig();
      if (!configUpdates || Object.keys(configUpdates).length === 0) return current.config;
      if (!Number.isSafeInteger(current.revision) || current.revision < 0) {
        throw new Error('后台配置没有有效 revision');
      }

      const clientId = `full-page-fixture:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      let response;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const nextConfig = {...current.config, ...configUpdates};
        for (const key of Object.keys(nextConfig)) {
          if (key.startsWith('__fluentConfig')) delete nextConfig[key];
        }
        response = await sendRuntimeMessage({
          type: 'persistConfig',
          config: nextConfig,
          clientId,
          sequence: attempt,
          baseRevision: current.revision,
        });
        if (response?.success === true) break;
        if (!String(response?.error || '').includes('配置已更新') || attempt === 3) {
          throw new Error(response?.error || '后台拒绝保存全文测试配置');
        }
        current = await readCompleteConfig();
        if (!Number.isSafeInteger(current.revision) || current.revision < 0) {
          throw new Error('配置冲突重试时后台 revision 无效');
        }
      }
      if (response?.success !== true || !Number.isSafeInteger(response.revision) || response.revision < 0) {
        throw new Error('后台没有确认全文测试配置写入');
      }

      const deadline = Date.now() + Math.min(timeoutMs, 10_000);
      do {
        current = await readCompleteConfig();
        const updatesApplied = Object.entries(configUpdates).every(([key, value]) => (
          JSON.stringify(current.config[key]) === JSON.stringify(value)
        ));
        if (current.revision >= response.revision && updatesApplied) return current.config;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      throw new Error('全文测试配置没有通过后台协议持久化');
    }, {configUpdates: updates, timeoutMs: timeout});
    return { extensionId: match[1], config };
  } finally {
    await popup.close();
  }
}

async function toggleFullPage(page, activatePage) {
  await activatePage(page);
  // 使用 Playwright 的真实 Alt/T 键序列，对应插件默认全文快捷键 Alt+T。
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
}

async function installShortcutDiagnostics(page) {
  await page.evaluate(() => {
    window.__fluentReadFullPageDebug = { keydowns: [], toggleEvents: 0 };
    document.addEventListener('keydown', (event) => {
      window.__fluentReadFullPageDebug.keydowns.push({
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
      });
    });
    document.addEventListener('fluentread-toggle-translation', () => {
      window.__fluentReadFullPageDebug.toggleEvents += 1;
    });
  });
}

async function readShortcutDiagnostics(page) {
  return page.evaluate(() => ({
    debug: window.__fluentReadFullPageDebug || null,
    bilingualCount: document.querySelectorAll('.fluent-read-bilingual-content').length,
    loadingCount: document.querySelectorAll('.fluent-read-loading').length,
    retryCount: document.querySelectorAll('.fluent-read-retry-wrapper').length,
    buttonTexts: {
      save: document.querySelector('#save-button')?.textContent?.trim() || '',
      cancel: document.querySelector('#cancel-button')?.textContent?.trim() || '',
    },
    targetStates: ['#paragraph-one', '#paragraph-two', '#model-description', '#save-button', '#cancel-button']
      .map((selector) => ({
        selector,
        bilingual: document.querySelector(selector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
        loading: document.querySelector(selector)?.querySelectorAll('.fluent-read-loading').length || 0,
      })),
    shadowState: (() => {
      const shadow = document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph');
      return { bilingual: shadow?.querySelectorAll('.fluent-read-bilingual-content').length || 0, loading: shadow?.querySelectorAll('.fluent-read-loading').length || 0 };
    })(),
  }));
}

function cdpAttribute(node, name) {
  const attributes = node?.attributes || [];
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1] || '';
  }
  return '';
}

function cdpChildren(node) {
  return [
    ...(node?.children || []),
    ...(node?.shadowRoots || []),
    ...(node?.contentDocument ? [node.contentDocument] : []),
  ];
}

function findCdpNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of cdpChildren(node)) {
    const match = findCdpNode(child, predicate);
    if (match) return match;
  }
  return null;
}

function hasCdpClass(node, className) {
  return cdpAttribute(node, 'class').split(/\s+/).includes(className);
}

function quadBounds(quad) {
  if (!Array.isArray(quad) || quad.length < 8) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

async function computedStyleValues(session, node, names) {
  if (!node) return {};
  const { computedStyle } = await session.send('CSS.getComputedStyleForNode', { nodeId: node.nodeId });
  return Object.fromEntries(computedStyle
    .filter((entry) => names.includes(entry.name))
    .map((entry) => [entry.name, entry.value]));
}

async function nodeBounds(session, node) {
  if (!node) return null;
  try {
    const { model } = await session.send('DOM.getBoxModel', { nodeId: node.nodeId });
    return quadBounds(model.border || model.content);
  } catch {
    return null;
  }
}

async function readFloatingUiState(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const floatingHost = findCdpNode(root, node => cdpAttribute(node, 'id') === 'fluent-read-floating-ball-container');
    const ball = findCdpNode(floatingHost, node => hasCdpClass(node, 'fr-floating-ball'));
    const main = findCdpNode(ball, node => hasCdpClass(node, 'floating-ball-main'));
    const translateTool = findCdpNode(ball, node => hasCdpClass(node, 'floating-ball-translate'));
    const mainCheck = findCdpNode(main, node => node !== main && hasCdpClass(node, 'check-mark'));
    const shortcutTooltip = findCdpNode(ball, node => hasCdpClass(node, 'shortcut-tooltip'));
    const progressHost = findCdpNode(root, node => cdpAttribute(node, 'id') === 'fluent-read-translation-status-container');
    const progressPanel = findCdpNode(progressHost, node => hasCdpClass(node, 'fr-translation-progress'));
    const progressCompactCheck = findCdpNode(progressPanel, node => hasCdpClass(node, 'fr-progress-compact-check'));
    const [mainStyle, toolStyle, mainBox, translateToolBox, checkBox] = await Promise.all([
      computedStyleValues(session, main, ['opacity', 'transform']),
      computedStyleValues(session, translateTool, ['opacity', 'visibility', 'display']),
      nodeBounds(session, main),
      nodeBounds(session, translateTool),
      nodeBounds(session, mainCheck),
    ]);
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const checkVisible = Boolean(checkBox &&
      checkBox.right > 0 && checkBox.left < viewport.width &&
      checkBox.bottom > 0 && checkBox.top < viewport.height);
    return {
      host: Boolean(floatingHost),
      ball: Boolean(ball),
      ballClass: cdpAttribute(ball, 'class'),
      position: cdpAttribute(ball, 'data-position'),
      expanded: hasCdpClass(ball, 'floating-ball-expanded'),
      translated: hasCdpClass(ball, 'is-translating'),
      mainOpacity: Number(mainStyle.opacity),
      mainTransform: mainStyle.transform || '',
      mainBox,
      translateToolBox,
      translateToolOpacity: Number(toolStyle.opacity),
      translateToolVisibility: toolStyle.visibility || '',
      translateToolDisplay: toolStyle.display || '',
      check: Boolean(mainCheck),
      checkBox,
      checkVisible,
      shortcutTooltip: Boolean(shortcutTooltip),
      progressHost: Boolean(progressHost),
      progressPanel: Boolean(progressPanel),
      progressPanelClass: cdpAttribute(progressPanel, 'class'),
      progressCompact: hasCdpClass(progressPanel, 'fr-compact'),
      progressCompactCheck: Boolean(progressCompactCheck),
      progress: progressPanel ? {
        running: Number(cdpAttribute(progressPanel, 'data-running')),
        remaining: Number(cdpAttribute(progressPanel, 'data-remaining')),
        queued: Number(cdpAttribute(progressPanel, 'data-queued')),
        offscreen: Number(cdpAttribute(progressPanel, 'data-offscreen')),
      } : null,
    };
  } finally {
    await session.detach().catch(() => {});
  }
}

async function waitForFloatingUiState(page, predicate, timeout, description) {
  const deadline = Date.now() + timeout;
  let state;
  while (Date.now() < deadline) {
    state = await readFloatingUiState(page);
    if (predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  throw new Error(`${description}：${JSON.stringify(state)}`);
}

async function assertNoAutomaticFloatingExpansion(page, durationMs = 160) {
  const deadline = Date.now() + durationMs;
  const samples = [];
  do {
    const state = await readFloatingUiState(page);
    samples.push({expanded: state.expanded, translated: state.translated, check: state.check, shortcutTooltip: state.shortcutTooltip});
    if (state.expanded || state.shortcutTooltip) {
      throw new Error(`全文快捷键不应自动展开悬浮球或弹提示：${JSON.stringify({state, samples})}`);
    }
    await page.waitForTimeout(20);
  } while (Date.now() < deadline);
  return samples;
}

function isCollapsedFloatingUiState(state, translated) {
  return Boolean(state.host && state.ball && !state.expanded && state.translated === translated &&
    Math.abs(state.mainOpacity - 0.52) <= 0.03 && state.translateToolOpacity === 0 &&
    state.check === translated && (!translated || state.checkVisible));
}

function assertCollapsedFloatingUi(state, translated, label) {
  if (!isCollapsedFloatingUiState(state, translated)) {
    throw new Error(`${label} 悬浮球没有保持低干扰收起状态：${JSON.stringify(state)}`);
  }
}

function isExpandedFloatingUiState(state) {
  return Boolean(state.expanded && Math.abs(state.mainOpacity - 1) <= 0.01 && state.translateToolOpacity === 1);
}

function assertExpandedFloatingUi(state, label) {
  if (!isExpandedFloatingUiState(state)) {
    throw new Error(`${label} 主动悬停后没有清晰展开：${JSON.stringify(state)}`);
  }
}

async function movePointerToFloatingMain(page, state) {
  const box = state.mainBox;
  if (!box) throw new Error(`无法取得悬浮球几何位置：${JSON.stringify(state)}`);
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const visibleLeft = Math.max(1, box.left);
  const visibleRight = Math.min(viewport.width - 1, box.right);
  const visibleTop = Math.max(1, box.top);
  const visibleBottom = Math.min(viewport.height - 1, box.bottom);
  if (visibleLeft >= visibleRight || visibleTop >= visibleBottom) {
    throw new Error(`悬浮球不在可交互视口内：${JSON.stringify({state, viewport})}`);
  }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 100, y: 100});
    await page.waitForTimeout(30);
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: (visibleLeft + visibleRight) / 2,
      y: (visibleTop + visibleBottom) / 2,
    });
  } finally {
    await session.detach().catch(() => {});
  }
}

async function clickFloatingTranslateTool(page, state) {
  const box = state.translateToolBox;
  if (!box) throw new Error(`无法取得全文翻译按钮几何位置：${JSON.stringify(state)}`);
  const x = (box.left + box.right) / 2;
  const y = (box.top + box.bottom) / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
    await session.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1});
    await session.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1});
  } finally {
    await session.detach().catch(() => {});
  }
}

async function pageState(page) {
  return page.evaluate(() => {
    const get = (selector) => document.querySelector(selector);
    const count = (selector) => get(selector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0;
    const clampState = (clampSelector, targetSelector) => {
      const clamp = get(clampSelector);
      const target = get(targetSelector);
      const wrapper = target?.querySelector('.fluent-read-bilingual-content');
      if (!clamp || !target) return null;
      const clampRect = clamp.getBoundingClientRect();
      const wrapperRect = wrapper?.getBoundingClientRect();
      return {
        bilingual: target.querySelectorAll('.fluent-read-bilingual-content').length,
        lineClamp: getComputedStyle(clamp).webkitLineClamp,
        inlineStyle: clamp.getAttribute('style'),
        clientHeight: clamp.clientHeight,
        scrollHeight: clamp.scrollHeight,
        wrapperVisible: Boolean(wrapperRect && wrapperRect.width > 0 && wrapperRect.height > 0 &&
          wrapperRect.top >= clampRect.top - 1 && wrapperRect.bottom <= clampRect.bottom + 1),
        translationText: wrapper?.textContent?.trim() || '',
      };
    };
    const shadowParagraph = get('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph');
    const button = get('#save-button');
    const cancelButton = get('#cancel-button');
    return {
      paragraphOne: count('#paragraph-one'),
      paragraphTwo: count('#paragraph-two'),
      paragraphTwoText: get('#paragraph-two')?.textContent?.trim() || '',
      heading: count('h1'),
      dynamic: count('#dynamic-paragraph'),
      staticClamp: clampState('#model-description-clamp', '#model-description'),
      dynamicClamp: clampState('#dynamic-model-description-clamp', '#dynamic-paragraph'),
      shadow: shadowParagraph?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      header: count('header'),
      nav: count('nav'),
      footer: count('footer'),
      buttonBilingualCount: button?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      buttonText: button?.textContent?.trim() || '',
      cancelButtonText: cancelButton?.textContent?.trim() || '',
      cancelButtonBilingualCount: cancelButton?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      buttonIconPresent: Boolean(button?.querySelector('[aria-hidden="true"]')),
      codePreserved: Boolean(get('#paragraph-one .fluent-read-bilingual-content code')?.textContent.includes('const value = 42')),
      linkPreserved: get('#paragraph-one .fluent-read-bilingual-content a')?.getAttribute('href') || null,
    };
  });
}

function assertTranslated(state, label) {
  if (state.paragraphOne !== 1 || state.paragraphTwo !== 1 || state.heading !== 1 || state.dynamic !== 1 || state.shadow !== 1) {
    throw new Error(`${label} 内容块翻译数量不正确：${JSON.stringify(state)}`);
  }
  if (!state.paragraphTwoText.includes('changed after full-page translation')) {
    throw new Error(`${label} 没有响应宿主页面的动态文本更新：${JSON.stringify(state)}`);
  }
  for (const [name, clamp] of [['static', state.staticClamp], ['dynamic', state.dynamicClamp]]) {
    if (!clamp || clamp.bilingual !== 1 || !clamp.wrapperVisible ||
        !/[\u3400-\u9fff]/u.test(clamp.translationText) ||
        !['none', 'unset'].includes(clamp.lineClamp)) {
      throw new Error(`${label} ${name} line-clamp 译文仍被裁剪：${JSON.stringify(clamp)}`);
    }
  }
  if (state.header !== 0 || state.nav !== 0 || state.footer !== 0) throw new Error(`${label} 导航/页脚被误翻译`);
  if (state.buttonBilingualCount !== 0 || state.cancelButtonBilingualCount !== 0 ||
      !/[\u3400-\u9fff]/u.test(state.buttonText) || !/[\u3400-\u9fff]/u.test(state.cancelButtonText) ||
      !state.buttonIconPresent) {
    throw new Error(`${label} 按钮没有按控件规则保留结构并替换文字：${JSON.stringify(state)}`);
  }
  if (!state.codePreserved || !['https://example.com', 'https://example.com/'].includes(state.linkPreserved)) {
    throw new Error(`${label} 富文本结构没有保留：${JSON.stringify(state)}`);
  }
}

function assertRestored(state) {
  if (state.paragraphOne || state.paragraphTwo || state.heading || state.dynamic || state.shadow) {
    throw new Error(`全文恢复后仍残留译文：${JSON.stringify(state)}`);
  }
  if (!state.paragraphTwoText.includes('changed after full-page translation')) {
    throw new Error(`全文恢复覆盖了宿主页面更新：${JSON.stringify(state)}`);
  }
  for (const [name, clamp] of [['static', state.staticClamp], ['dynamic', state.dynamicClamp]]) {
    if (!clamp || clamp.bilingual !== 0 || clamp.lineClamp !== '2' || clamp.inlineStyle !== null) {
      throw new Error(`全文恢复后 ${name} line-clamp 样式没有精确还原：${JSON.stringify(clamp)}`);
    }
  }
  if (state.buttonText !== '★Save changes' || state.cancelButtonText !== 'Cancel' ||
      !state.buttonIconPresent || state.buttonBilingualCount !== 0 || state.cancelButtonBilingualCount !== 0) {
    throw new Error(`按钮恢复不完整：${JSON.stringify(state)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDir = path.resolve(args.extensionDir);
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('插件 manifest.json 不存在');
  if (!fs.existsSync(args.browserPath)) throw new Error(`浏览器不存在：${args.browserPath}`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-full-page-'));
  assertDedicatedProfile(profileDir);
  const artifactsDir = args.artifactsDir ? path.resolve(args.artifactsDir) : null;
  if (artifactsDir) fs.mkdirSync(artifactsDir, { recursive: true });
  const { chromium } = loadPlaywright(args.playwrightRoot);
  const focusSafe = args.background ? loadFocusSafeBrowser(args.focusSafeHelper) : null;
  let context;
  let closeBrowser = async () => { if (context) await context.close().catch(() => {}); };
  let createIsolatedPage = () => context.newPage();
  let activateTestPage = async () => undefined;
  let launchMode = args.background ? null : 'playwright-headed';
  let focusPolicy = args.background ? null : 'foreground-authorized';
  let windowPlacement = args.background
    ? null
    : { mode: 'headed-explicit-foreground', windowState: 'normal', viewport: { width: 1280, height: 900 } };
  let fixtureServer = null;
  let translationFixtureServer = null;
  const unexpectedNetworkRequests = [];
  const workerFixtureInstallErrors = [];
  const pendingWorkerFixtureInstalls = new Set();
  try {
    // 默认回归必须自包含；只有显式 --url 才使用调用方提供的页面。
    if (!args.url) {
      fixtureServer = await startFixtureServer();
      args.url = fixtureServer.url;
    }
    const browserArgs = [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (args.background) {
      const browserSession = await focusSafe.launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath: args.browserPath,
        headless: false,
        background: true,
        browserArgs,
        viewport: { width: 1280, height: 900 },
        timeout: args.timeout,
      });
      context = browserSession.context;
      closeBrowser = browserSession.close;
      createIsolatedPage = () => focusSafe.newPageWithoutForeground(context, args.timeout);
      activateTestPage = page => focusSafe.activateExtensionTabWithoutForeground(context, page, args.timeout);
      launchMode = browserSession.launchMode;
      focusPolicy = browserSession.focusPolicy;
      windowPlacement = browserSession.windowPlacement;
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: args.browserPath,
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: browserArgs,
      });
    }
    translationFixtureServer = await startTranslationFixtureServer(
      unexpectedNetworkRequests,
      args.verifyFloatingUi ? 400 : 0,
    );
    const fixtureUrls = {
      translationUrl: translationFixtureServer.translationUrl,
      blockedUrl: translationFixtureServer.blockedUrl,
    };
    const scheduleWorkerFixtureInstall = (worker) => {
      if (!worker.url().startsWith('chrome-extension://')) return;
      const pending = installTranslationFixtureOnWorker(worker, fixtureUrls)
        .catch((error) => {
          workerFixtureInstallErrors.push(error.message);
        })
        .finally(() => pendingWorkerFixtureInstalls.delete(pending));
      pendingWorkerFixtureInstalls.add(pending);
    };
    // BrowserContext.route 无法拦截 MV3 service worker 的 fetch，因此把当前 worker
    // 和后续替换 worker 的微软请求直接改写到 loopback 确定性响应。
    context.on('serviceworker', scheduleWorkerFixtureInstall);
    const initialWorker = context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {
        predicate: (worker) => worker.url().startsWith('chrome-extension://'),
        timeout: Math.min(args.timeout, 30000),
      });
    await installTranslationFixtureOnWorker(initialWorker, fixtureUrls);

    // 页面网络仍由 BrowserContext fail-closed；worker 网络则由上面的 fetch 包装器
    // 改写到 /translate 或 /blocked，确保不会泄漏到真实 provider。
    await context.route('**/*', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const isNetworkRequest = requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:';
      const isLoopbackRequest = ['127.0.0.1', 'localhost', '::1'].includes(requestUrl.hostname);
      if (isNetworkRequest && !isLoopbackRequest) {
        unexpectedNetworkRequests.push(request.url());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const configUpdates = {};
    if (args.configureService) configUpdates.service = args.configureService;
    if (args.verifyFloatingUi) {
      Object.assign(configUpdates, {
        disableFloatingBall: false,
        translationProgressPanelEnabled: true,
        fullPageTranslationMode: 'viewport',
      });
    }
    if (Object.keys(configUpdates).length > 0) {
      await readConfig(context, args.timeout, configUpdates, createIsolatedPage);
    }
    const page = await createIsolatedPage();
    const networkEvents = [];
    const runtimeErrors = [];
    let omittedNetworkEvents = 0;
    const recordNetworkEvent = (event) => {
      if (networkEvents.length < 20) networkEvents.push(event);
      else omittedNetworkEvents += 1;
    };
    const recordFailedRequest = (request) => {
      if (/translate|translatetext|deeplx|google/i.test(request.url())) {
        recordNetworkEvent({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText || 'unknown' });
      }
    };
    const recordResponse = (response) => {
      if (/translate|translatetext|deeplx|google/i.test(response.url())) {
        recordNetworkEvent({ type: 'response', url: response.url(), status: response.status() });
      }
    };
    // 翻译请求由扩展 service worker 发出，BrowserContext 级监听比 page 级更完整。
    context.on('requestfailed', recordFailedRequest);
    context.on('response', recordResponse);
    page.on('requestfailed', recordFailedRequest);
    page.on('response', recordResponse);
    page.on('pageerror', (error) => {
      runtimeErrors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        runtimeErrors.push(`console: ${text}`);
        recordNetworkEvent({ type: 'console-error', text });
      }
    });
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: args.timeout });
    // 当前 main 默认关闭悬浮球，但悬浮/全文快捷键仍由 content script 独立监听；
    // 不能把“悬浮球是否挂载”当作扩展已加载的判据。
    await page.waitForTimeout(1000);
    const configResult = await readConfig(context, args.timeout, null, createIsolatedPage);
    if (configResult.config?.floatingBallHotkey !== 'Alt+T') throw new Error(`全文快捷键不是 Alt+T：${configResult.config?.floatingBallHotkey}`);
    if (configResult.config?.service !== args.service) throw new Error(`翻译服务不符：预期 ${args.service}，实际 ${configResult.config?.service}`);
    const floatingUiEvidence = args.verifyFloatingUi ? {} : null;
    if (args.verifyFloatingUi) {
      if (configResult.config?.disableFloatingBall !== false || configResult.config?.translationProgressPanelEnabled !== true ||
          configResult.config?.fullPageTranslationMode !== 'viewport') {
        throw new Error(`悬浮 UI 测试配置不正确：${JSON.stringify({
          disableFloatingBall: configResult.config?.disableFloatingBall,
          translationProgressPanelEnabled: configResult.config?.translationProgressPanelEnabled,
          fullPageTranslationMode: configResult.config?.fullPageTranslationMode,
        })}`);
      }
      await page.evaluate(() => {
        const fixture = document.createElement('section');
        fixture.id = 'floating-ui-offscreen-fixture';
        for (let index = 0; index < 60; index += 1) {
          const paragraph = document.createElement('p');
          paragraph.id = `floating-ui-offscreen-${index}`;
          paragraph.style.minHeight = '80px';
          paragraph.textContent = `Offscreen paragraph ${index} remains pending until the reader scrolls near this part of the document.`;
          fixture.appendChild(paragraph);
        }
        document.body.appendChild(fixture);
      });
      floatingUiEvidence.initial = await waitForFloatingUiState(
        page,
        state => state.progressHost && isCollapsedFloatingUiState(state, false),
        args.timeout,
        '等待低干扰悬浮球初始状态超时',
      );
      assertCollapsedFloatingUi(floatingUiEvidence.initial, false, '初始');
    }

    const initialClamp = await page.evaluate(() => {
      const clamp = document.querySelector('#model-description-clamp');
      return clamp ? {
        lineClamp: getComputedStyle(clamp).webkitLineClamp,
        clientHeight: clamp.clientHeight,
        scrollHeight: clamp.scrollHeight,
        inlineStyle: clamp.getAttribute('style'),
      } : null;
    });
    if (!initialClamp || initialClamp.lineClamp !== '2' || initialClamp.inlineStyle !== null ||
        initialClamp.scrollHeight <= initialClamp.clientHeight) {
      throw new Error(`line-clamp fixture 初始状态无效：${JSON.stringify(initialClamp)}`);
    }

    await installShortcutDiagnostics(page);
    await toggleFullPage(page, activateTestPage);
    if (args.verifyFloatingUi) {
      floatingUiEvidence.afterShortcutSamples = await assertNoAutomaticFloatingExpansion(page);
      floatingUiEvidence.progressDuringWork = await waitForFloatingUiState(
        page,
        state => Boolean(state.progressPanel && state.progress &&
          (state.progress.running > 0 || state.progress.queued > 0)),
        args.timeout,
        '等待实际翻译工作展开进度面板超时',
      );
    }
    try {
      await waitFor(page, () => document.querySelector('#paragraph-one .fluent-read-bilingual-content') &&
        document.querySelector('#model-description .fluent-read-bilingual-content') &&
        document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .fluent-read-bilingual-content') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
    } catch (error) {
      const diagnostics = await readShortcutDiagnostics(page);
      throw new Error(`${error.message}\n全文快捷键诊断：${JSON.stringify(diagnostics)}\n翻译请求诊断：${JSON.stringify({ events: networkEvents, omitted: omittedNetworkEvents })}`);
    }

    // 在会话已经启动后再插入节点，确认 MutationObserver 能把新内容纳入全文队列。
    await page.evaluate(() => {
      const container = document.querySelector('#dynamic-container');
      const clamp = document.createElement('div');
      clamp.id = 'dynamic-model-description-clamp';
      clamp.className = 'model-description-clamp';
      const paragraph = document.createElement('p');
      paragraph.id = 'dynamic-paragraph';
      paragraph.textContent = 'This virtualized model description is inserted after the full page session starts. Its translated text must expand the newly mounted two-line clamp instead of remaining hidden beneath the source content.';
      clamp.appendChild(paragraph);
      container.appendChild(clamp);
    });
    await waitFor(page, () => document.querySelector('#dynamic-paragraph .fluent-read-bilingual-content'), args.timeout);

    // React/Vue 页面可能在译文已插入后重建原文节点。确认全文观察器不会把
    // 这次宿主 characterData/childList mutation 当成插件自身写入而留下旧译文。
    await page.evaluate(() => {
      const paragraph = document.querySelector('#paragraph-two');
      if (paragraph) paragraph.textContent = 'The second paragraph changed after full-page translation.';
    });
    await waitFor(page, () => {
      const paragraph = document.querySelector('#paragraph-two');
      return paragraph?.textContent?.includes('changed after full-page translation') &&
        Boolean(paragraph.querySelector('.fluent-read-bilingual-content'));
    }, args.timeout);
    const translated = await pageState(page);
    assertTranslated(translated, '第一次全文翻译');
    if (args.verifyFloatingUi) {
      await page.waitForFunction(() => !document.querySelector('.fluent-read-loading'), undefined, {timeout: args.timeout});
      const offscreenState = await page.evaluate(() => ({
        lastTranslated: Boolean(document.querySelector('#floating-ui-offscreen-59 .fluent-read-bilingual-content')),
        translatedCount: document.querySelectorAll('#floating-ui-offscreen-fixture .fluent-read-bilingual-content').length,
      }));
      if (offscreenState.lastTranslated || offscreenState.translatedCount >= 60) {
        throw new Error(`离屏 fixture 没有保留待滚动候选：${JSON.stringify(offscreenState)}`);
      }
      floatingUiEvidence.translatedCollapsed = await waitForFloatingUiState(
        page,
        state => isCollapsedFloatingUiState(state, true) && !state.progressPanel,
        args.timeout,
        '等待全文翻译后的低干扰勾选状态超时',
      );
      assertCollapsedFloatingUi(floatingUiEvidence.translatedCollapsed, true, '全文翻译后');
      await activateTestPage(page);
      await movePointerToFloatingMain(page, floatingUiEvidence.translatedCollapsed);
      floatingUiEvidence.expandedOnHover = await waitForFloatingUiState(
        page,
        isExpandedFloatingUiState,
        Math.min(args.timeout, 15_000),
        '等待主动悬停展开悬浮球超时',
      );
      assertExpandedFloatingUi(floatingUiEvidence.expandedOnHover, '全文翻译后');
      await clickFloatingTranslateTool(page, floatingUiEvidence.expandedOnHover);
      await waitFor(page, () => !document.querySelector('.fluent-read-bilingual-content'), args.timeout);
      floatingUiEvidence.pointerRestored = await waitForFloatingUiState(
        page,
        state => isCollapsedFloatingUiState(state, false) && !state.progressPanel,
        args.timeout,
        '等待鼠标点击恢复后收起悬浮球超时',
      );
      assertCollapsedFloatingUi(floatingUiEvidence.pointerRestored, false, '鼠标点击恢复后');
      await toggleFullPage(page, activateTestPage);
      floatingUiEvidence.pointerRetranslateSamples = await assertNoAutomaticFloatingExpansion(page);
      await waitFor(page, () => document.querySelector('#paragraph-one .fluent-read-bilingual-content') &&
        document.querySelector('#model-description .fluent-read-bilingual-content') &&
        document.querySelector('#dynamic-paragraph .fluent-read-bilingual-content') &&
        document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .fluent-read-bilingual-content') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
      await page.waitForFunction(() => !document.querySelector('.fluent-read-loading'), undefined, {timeout: args.timeout});
      const offscreenStateAfterPointerCycle = await page.evaluate(() => ({
        lastTranslated: Boolean(document.querySelector('#floating-ui-offscreen-59 .fluent-read-bilingual-content')),
        translatedCount: document.querySelectorAll('#floating-ui-offscreen-fixture .fluent-read-bilingual-content').length,
      }));
      if (offscreenStateAfterPointerCycle.lastTranslated || offscreenStateAfterPointerCycle.translatedCount >= 60) {
        throw new Error(`鼠标恢复再翻译后离屏 fixture 状态不正确：${JSON.stringify(offscreenStateAfterPointerCycle)}`);
      }
      await page.evaluate(() => document.querySelector('#floating-ui-offscreen-59')?.scrollIntoView({block: 'center'}));
      floatingUiEvidence.progressAfterScroll = await waitForFloatingUiState(
        page,
        state => Boolean(state.progressPanel && state.progress &&
          (state.progress.running > 0 || state.progress.queued > 0)),
        args.timeout,
        '等待滚动后的离屏任务重新展开进度面板超时',
      );
      await page.waitForFunction(
        () => Boolean(document.querySelector('#floating-ui-offscreen-59 .fluent-read-bilingual-content')),
        undefined,
        {timeout: args.timeout},
      );
      await page.waitForFunction(() => !document.querySelector('.fluent-read-loading'), undefined, {timeout: args.timeout});
      await page.evaluate(() => window.scrollTo(0, 0));
      floatingUiEvidence.collapsedAfterScroll = await waitForFloatingUiState(
        page,
        state => isCollapsedFloatingUiState(state, true) && !state.progressPanel,
        args.timeout,
        '等待滚动批次完成后收起进度面板超时',
      );
      floatingUiEvidence.offscreen = {
        initial: offscreenState,
        afterPointerCycle: offscreenStateAfterPointerCycle,
        translatedAfterScroll: await page.evaluate(() => Boolean(
          document.querySelector('#floating-ui-offscreen-59 .fluent-read-bilingual-content'),
        )),
      };
    }
    if (artifactsDir) await page.screenshot({
      path: path.join(artifactsDir, 'full-page-translated.png'),
      fullPage: !args.verifyFloatingUi,
    });

    await toggleFullPage(page, activateTestPage);
    await waitFor(page, () => !document.querySelector('.fluent-read-bilingual-content'), args.timeout);
    const restored = await pageState(page);
    assertRestored(restored);
    if (args.verifyFloatingUi) {
      floatingUiEvidence.restored = await waitForFloatingUiState(
        page,
        state => isCollapsedFloatingUiState(state, false) && !state.progressPanel,
        args.timeout,
        '等待恢复原文后的悬浮状态超时',
      );
      assertCollapsedFloatingUi(floatingUiEvidence.restored, false, '恢复原文后');
    }
    if (artifactsDir) await page.screenshot({
      path: path.join(artifactsDir, 'full-page-restored.png'),
      fullPage: !args.verifyFloatingUi,
    });

    if (args.verifyFloatingUi) {
      await readConfig(context, args.timeout, {disableFloatingBall: true}, createIsolatedPage);
      floatingUiEvidence.progressOnlyInitial = await waitForFloatingUiState(
        page,
        state => !state.host && state.progressHost && !state.progressPanel,
        args.timeout,
        '等待仅进度面板配置生效超时',
      );
      await toggleFullPage(page, activateTestPage);
      floatingUiEvidence.progressOnlyDuringWork = await waitForFloatingUiState(
        page,
        state => Boolean(state.progressPanel && !state.progressCompact && state.progress &&
          (state.progress.running > 0 || state.progress.queued > 0)),
        args.timeout,
        '等待无悬浮球时展开实际进度面板超时',
      );
      await page.waitForFunction(
        () => Boolean(document.querySelector('#paragraph-one .fluent-read-bilingual-content')),
        undefined,
        {timeout: args.timeout},
      );
      await page.waitForFunction(() => !document.querySelector('.fluent-read-loading'), undefined, {timeout: args.timeout});
      floatingUiEvidence.progressOnlyCompact = await waitForFloatingUiState(
        page,
        state => Boolean(!state.host && state.progressCompact && state.progressCompactCheck &&
          state.progress && state.progress.running === 0 && state.progress.queued === 0 && state.progress.offscreen > 0),
        args.timeout,
        '等待离屏任务退化为淡勾选超时',
      );
      await toggleFullPage(page, activateTestPage);
      await waitFor(page, () => !document.querySelector('.fluent-read-bilingual-content'), args.timeout);
      floatingUiEvidence.progressOnlyRestored = await waitForFloatingUiState(
        page,
        state => !state.host && !state.progressPanel,
        args.timeout,
        '等待仅进度面板模式恢复原文超时',
      );
      await readConfig(context, args.timeout, {disableFloatingBall: false}, createIsolatedPage);
      floatingUiEvidence.remountedBeforeRetranslate = await waitForFloatingUiState(
        page,
        state => isCollapsedFloatingUiState(state, false),
        args.timeout,
        '等待重新启用悬浮球超时',
      );
    }

    await toggleFullPage(page, activateTestPage);
    await waitFor(page, () => document.querySelector('#paragraph-one .fluent-read-bilingual-content') &&
      document.querySelector('#model-description .fluent-read-bilingual-content') &&
      document.querySelector('#dynamic-paragraph .fluent-read-bilingual-content') &&
      document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .fluent-read-bilingual-content') &&
      /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
      /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
    const retranslated = await pageState(page);
    assertTranslated(retranslated, '再次全文翻译');
    if (args.verifyFloatingUi) {
      await page.waitForFunction(() => !document.querySelector('.fluent-read-loading'), undefined, {timeout: args.timeout});
      floatingUiEvidence.retranslated = await waitForFloatingUiState(
        page,
        state => isCollapsedFloatingUiState(state, true) && !state.progressPanel,
        args.timeout,
        '等待再次全文翻译后的悬浮状态超时',
      );
      assertCollapsedFloatingUi(floatingUiEvidence.retranslated, true, '再次全文翻译后');
    }
    if (artifactsDir) await page.screenshot({
      path: path.join(artifactsDir, 'full-page-retranslated.png'),
      fullPage: !args.verifyFloatingUi,
    });
    await Promise.allSettled([...pendingWorkerFixtureInstalls]);
    if (workerFixtureInstallErrors.length > 0) {
      throw new Error(`替换 service worker 安装全文翻译 fixture 失败：${JSON.stringify(workerFixtureInstallErrors)}`);
    }
    assertNoRuntimeErrors(runtimeErrors);
    const fixtureTranslationRequestCount = translationFixtureServer.requestCount();
    const fixtureTranslationItemCount = translationFixtureServer.translatedItemCount();
    assertDeterministicFixtureTraffic(fixtureTranslationRequestCount, unexpectedNetworkRequests);

    const evidence = {
      ok: true,
      windowMode: args.background ? 'background-screen-off' : 'headed-isolated',
      launchMode,
      focusPolicy,
      windowPlacement,
      profileDir,
      url: args.url,
      extensionId: configResult.extensionId,
      config: {
        floatingBallHotkey: configResult.config.floatingBallHotkey,
        service: configResult.config.service,
        display: configResult.config.display,
        disableFloatingBall: configResult.config.disableFloatingBall,
        translationProgressPanelEnabled: configResult.config.translationProgressPanelEnabled,
        fullPageTranslationMode: configResult.config.fullPageTranslationMode,
      },
      fixtureTranslationRequestCount,
      fixtureTranslationItemCount,
      unexpectedNetworkRequests,
      translated,
      restored,
      retranslated,
      floatingUi: floatingUiEvidence,
      consoleErrors: runtimeErrors,
      screenshots: artifactsDir ? [
        path.join(artifactsDir, 'full-page-translated.png'),
        path.join(artifactsDir, 'full-page-restored.png'),
        path.join(artifactsDir, 'full-page-retranslated.png'),
      ] : [],
    };
    if (artifactsDir) {
      fs.writeFileSync(path.join(artifactsDir, 'report.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await closeBrowser();
    await translationFixtureServer?.close().catch(() => {});
    await fixtureServer?.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertDeterministicFixtureTraffic,
  assertNoRuntimeErrors,
  buildFixtureMicrosoftResponseBody,
  createFixtureRequestHandler,
  parseArgs,
  startFixtureServer,
  startTranslationFixtureServer,
};
