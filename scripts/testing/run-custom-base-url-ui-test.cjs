'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
/**
 * @file scripts/testing/run-custom-base-url-ui-test.cjs
 * 文件职责：在隔离 Edge 中验证 issue #626 的自定义 Base URL、连接检查与 HTML 错误提示。
 * 主要内容：用本地 HTTP 夹具检查真实请求路径、模型和鉴权，验证保存重开、失败重试及窄屏提示。
 * 模块边界：只创建临时 profile，不读取用户配置，不访问真实模型；请求记录只保留断言结果和夹具路径。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-issue626-ui'));
const {chromium} = require(path.join(arg('playwright-root', ''), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {extensionDir, providerEvidence: 'local-http-fixture-with-real-extension-and-sdk', cases: [], requests: [], consoleErrors: []};
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-issue626-'));
let launchAttempted = false;
let launched;
let primaryError;
let page;
let rejectRequest = false;
let observeRequest;
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}); res.end(); return;
  }
  let raw = '';
  req.on('data', chunk => {raw += chunk;});
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const validRoute = /\/chat\/completions(?:\?|$)/.test(req.url) || req.url === '/custom-generate' || req.url === '/';
      const record = {path: req.url, model: body.model, stream: body.stream, authorized: req.headers.authorization === 'Bearer issue626-fixture-token', hasMessages: Array.isArray(body.messages), status: validRoute && !rejectRequest ? 200 : 404};
      report.requests.push(record);
      res.writeHead(record.status, {'content-type': record.status === 200 ? 'application/json' : 'text/html', 'access-control-allow-origin': '*'});
      res.end(record.status === 200
        ? JSON.stringify({id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{index: 0, message: {role: 'assistant', content: '连接成功'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}})
        : '<!DOCTYPE html><html><head><script>private-page-data</script></head><body>Not Found</body></html>');
      observeRequest?.(record);
    } catch (error) {res.writeHead(400); res.end('invalid fixture request'); observeRequest?.({error: error.message});}
  });
});

async function main() {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const host = `http://127.0.0.1:${server.address().port}`;
  launchAttempted = true;
  launched = await launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    viewport: {width: 1440, height: 1000}, timeout: 30000,
  });
  guardBrowserClose(launched, profileDir);
  Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
  const context = launched.context;
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${new URL(worker.url()).host}/options.html#settings-services`;
  async function open() {
    page = await newPageWithoutForeground(context);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    await page.goto(url);
    await page.locator('.service-catalog').waitFor();
  }
  async function select(name) {
    await page.locator('[data-service-section="custom"] [data-service-value]').filter({hasText: name}).click();
  }
  async function add(name, endpoint) {
    await page.getByTestId('custom-service-add').click();
    await page.getByTestId('custom-service-name').fill(name);
    await page.getByTestId('custom-service-endpoint').fill(endpoint);
    await page.getByTestId('custom-service-api-key').fill('issue626-fixture-token');
    await page.getByTestId('custom-service-model').fill('fixture-model');
    await page.getByTestId('custom-service-save').click();
    await page.getByTestId('custom-service-dialog').waitFor({state: 'hidden'});
    await select(name);
  }
  async function check(expectedPath, status = 200) {
    const before = report.requests.length;
    let timer;
    const observed = new Promise((resolve, reject) => {
      observeRequest = resolve;
      timer = setTimeout(() => reject(new Error('Connection check did not reach the fixture')), 30000);
    });
    try {
      await page.locator('.detail-hero [data-connection-test-button]').last().click();
      const record = await observed;
      assert.deepEqual(record, {path: expectedPath, model: 'fixture-model', stream: false, authorized: true, hasMessages: true, status});
      await page.locator(`[data-api-key-list] .api-key-state.is-${status === 200 ? 'success' : 'error'}`).waitFor({timeout: 30000});
      await page.locator('[data-api-key-list][data-api-key-busy="false"]').waitFor();
      assert.equal(report.requests.length, before + 1);
    } finally {clearTimeout(timer); observeRequest = undefined;}
  }
  async function screenshot(name) {
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation =>
        Number.isFinite(animation.effect?.getComputedTiming().iterations))
        .map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({path: path.join(artifactsDir, name)});
  }

  await open();
  const initialDefault = await page.locator('.service-catalog').getAttribute('data-default-service');
  const base = `${host}/zen/v1?tenant=a&tenant=b&sig=a%2Fb`;
  const normalized = '/zen/v1/chat/completions?tenant=a&tenant=b&sig=a%2Fb';
  await add('Issue 626 Zen', base);
  await check(normalized);
  report.cases.push('zen-base-url-query-model-auth');
  await page.close(); await open(); await select('Issue 626 Zen');
  assert.equal(await page.getByRole('textbox', {name: '自定义服务接口地址', exact: true}).inputValue(), base);
  await check(normalized);
  assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
  await screenshot('base-url-persisted.png');
  report.cases.push('close-reopen-keeps-base-url-and-default-service');

  for (const [name, input, expected] of [
    ['Go', '/zen/go/v1/', '/zen/go/v1/chat/completions'],
    ['Root', '', '/v1/chat/completions'],
    ['Complete', '/v1/chat/completions', '/v1/chat/completions'],
    ['Nonstandard', '/custom-generate', '/custom-generate'],
  ]) {
    await add(`Issue 626 ${name}`, `${host}${input}`);
    await check(expected);
    report.cases.push(`${name.toLowerCase()}-endpoint`);
  }

  await page.locator('[id$="tab-custom-request"]').click();
  const proxy = page.getByRole('textbox', {name: '代理地址', exact: true});
  await proxy.fill(`${host}/`);
  const key = page.locator('[data-api-key-list] .api-key-entry input').first();
  // 改变目的地址后现有凭据绑定会清空 Key；新目的地址需显式填写自己的测试凭据。
  await page.waitForFunction(() => document.querySelector('[data-api-key-list] .api-key-entry input')?.value === '');
  await key.fill('issue626-fixture-token');
  await check('/');
  report.cases.push('explicit-proxy-root-stays-exact');
  await proxy.fill('');
  await page.waitForFunction(() => document.querySelector('[data-api-key-list] .api-key-entry input')?.value === '');
  await key.fill('issue626-fixture-token');
  await check('/custom-generate');
  await page.locator('[id$="tab-translation"]').click();
  report.cases.push('clear-proxy-restores-custom-endpoint');

  rejectRequest = true;
  await check('/custom-generate', 404);
  await page.locator('.api-key-error-toggle').click();
  const errorText = await page.locator('.api-key-error').innerText();
  assert(errorText.includes('HTTP 404') && errorText.includes('HTML') && errorText.includes('Chat Completions'));
  assert(!errorText.includes('<html') && !errorText.includes('private-page-data'));
  report.errorMessage = errorText;
  await screenshot('html-404-guidance.png');
  rejectRequest = false;
  await check('/custom-generate');
  report.cases.push('html-404-clean-message-no-retry-and-manual-recovery');

  await page.setViewportSize({width: 390, height: 844});
  const directoryToggle = page.locator('.mobile-directory-toggle');
  if (await directoryToggle.isVisible() && await directoryToggle.getAttribute('aria-expanded') !== 'true') await directoryToggle.click();
  await page.getByTestId('custom-service-add').click();
  const dialog = page.getByTestId('custom-service-dialog');
  assert((await dialog.innerText()).includes('Base URL'));
  assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot('base-url-help-390.png');
  report.cases.push('390px-dialog-help-no-overflow');
  assert.equal(report.consoleErrors.length, 0);
  report.status = 'passed';
}
main().catch(async error => {
  primaryError = error;
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
  await page?.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {});
}).finally(async () => {
  const cleanupErrors = [];
  const cleanup = async action => {
    try {await action();} catch (error) {cleanupErrors.push(error);}
  };
  let browserClosed = false;
  await cleanup(async () => {
    if (launched) {await launched.close(); browserClosed = true;}
  });
  await cleanup(async () => {if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
  await cleanup(() => {
    if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
    else if (!launchAttempted) {
      // No browser launch was attempted; only remove an empty initial profile.
      try {fs.rmdirSync(profileDir);} catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
      }
    }
  });
  if (cleanupErrors.length) {
    report.status = 'failed';
    report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
  }
  await cleanup(() => {fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));});
  for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
  if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  console.log(JSON.stringify({status: report.status, cases: report.cases, error: report.error, artifactsDir}, null, 2));
}).catch(error => {console.error(error.stack || error); process.exitCode = 1;});
