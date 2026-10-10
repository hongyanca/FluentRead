'use strict';
/**
 * @file scripts/testing/run-service-group-navigation-test.cjs
 * 文件职责：在真实生产扩展中验证翻译服务目录的分组收起与顶部分组导航。
 * 主要内容：检查导航与目录分组一一对应并随滚动同步高亮；分组收起后隐藏服务且不影响其他分组；点击导航会展开并定位已收起的分组；搜索时展开匹配分组并保持导航稳定，搜索中点击导航回到完整目录；从其他页面直达某项服务、回到本页或在搜索结果里点击已选中的服务时展开其所在分组；窄屏加载后放宽窗口时导航仍指向当前分组；平板宽度无横向溢出，窄屏隐藏导航并保留目录内的分组收起。
 * 模块边界：只使用临时 Edge profile 和不抢焦点 helper，不修改默认服务、不请求任何翻译服务，也不代表 Firefox 实机表现；目录顺序与免费翻译候选归 run-service-catalog-ui-test.cjs。
 */
const fs = require('node:fs');
const path = require('node:path');
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-service-group-navigation'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
const assert = (value, message) => { if (!value) throw new Error(message); };
const timeout = 30000;
const sections = ['machine-services', 'cloud-services', 'ai-providers', 'ai-platforms'];
async function main() {
  const report = {ok: false, extensionDir, scope: '翻译服务目录的分组收起与顶部分组导航', cases: [], screenshots: [], consoleErrors: [], cleanupErrors: []};
  let launched, profileDir, profileIdentity;
  let launchAttempted = false;
  try {
    fs.mkdirSync(artifactsDir, {recursive: true});
    profileDir = fs.mkdtempSync('/private/tmp/fr-service-group-navigation-');
    profileIdentity = fs.lstatSync(profileDir);
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({
      chromium, profileDir, timeout, background: true, headless: false,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      displayTarget: arg('display', 'secondary'), viewport: {width: 1440, height: 1000},
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout});
    const page = await newPageWithoutForeground(context, timeout);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    const origin = `chrome-extension://${worker.url().split('/')[2]}`;
    const catalog = page.locator('.service-catalog');
    const link = id => catalog.locator(`[data-service-group-link="${id}"]`);
    const toggle = id => catalog.locator(`[data-service-section="${id}"] h4 button`);
    const search = catalog.locator('.catalog-search input');
    const read = () => page.evaluate(() => {
      const scroller = document.querySelector('.service-groups');
      const navigation = document.querySelector('.service-group-navigation');
      return {
        links: [...navigation.querySelectorAll('button')].map(button => ({id: button.dataset.serviceGroupLink, label: button.textContent.trim()})),
        navigationVisible: navigation.getClientRects().length > 0,
        current: navigation.querySelector('[aria-current]')?.dataset.serviceGroupLink || '',
        query: document.querySelector('.catalog-search input').value,
        scrolled: scroller.scrollTop > 0,
        atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        groups: Object.fromEntries([...scroller.querySelectorAll('[data-service-section]')].map(section => [section.dataset.serviceSection, {
          label: section.querySelector('h4 span').textContent.trim(),
          expanded: section.querySelector('h4 button').getAttribute('aria-expanded') === 'true',
          toggleDisabled: section.querySelector('h4 button').disabled,
          offset: Math.round(section.getBoundingClientRect().top - scroller.getBoundingClientRect().top),
          services: [...section.querySelectorAll('[data-service-value]')].filter(item => item.getClientRects().length).length,
        }])),
      };
    });
    async function expect(name, predicate, screenshot = false) {
      const deadline = Date.now() + 5000;
      let state = await read();
      while (!predicate(state) && Date.now() < deadline) {
        await page.waitForTimeout(100);
        state = await read();
      }
      report.cases.push({name, state});
      assert(predicate(state), `${name}: ${JSON.stringify(state)}`);
      if (screenshot) {
        // 平滑滚动结束后再截图。
        await page.waitForTimeout(500);
        const target = path.join(artifactsDir, `${screenshot}.png`);
        await page.screenshot({path: target});
        report.screenshots.push(target);
      }
      return state;
    }
    const atTop = (state, id) => Math.abs(state.groups[id].offset) <= 2;
    // 用户自己操作过目录后，高亮只由滚动位置决定。
    const followsScroll = state => {
      const ids = Object.keys(state.groups);
      const expected = state.scrolled && state.atEnd ? ids[ids.length - 1] : ids.filter(id => state.groups[id].offset <= 8).pop() || ids[0];
      return state.current === expected;
    };

    await page.goto(`${origin}/options.html#settings-services`, {waitUntil: 'domcontentloaded'});
    await catalog.waitFor({state: 'visible', timeout});
    const initial = await expect('目录初始全部展开，导航指向首个分组', state => state.navigationVisible && state.current === sections[0]
      && JSON.stringify(state.links.map(item => item.id)) === JSON.stringify(sections)
      && state.links.every(item => item.label === state.groups[item.id]?.label)
      && sections.every(id => state.groups[id].expanded && state.groups[id].services > 0), 'initial');
    const serviceCount = id => initial.groups[id].services;

    await catalog.locator('.service-groups').hover();
    await page.mouse.wheel(0, initial.groups['cloud-services'].offset + 40);
    await expect('滚动目录后导航同步到当前分组', state => state.current === 'cloud-services');
    await page.mouse.wheel(0, -10000);
    await expect('滚回顶部后导航回到首个分组', state => state.current === sections[0] && atTop(state, sections[0]));

    await toggle('machine-services').click();
    await toggle('cloud-services').click();
    await expect('收起分组只隐藏自己的服务', state => !state.groups['machine-services'].expanded && !state.groups['cloud-services'].expanded
      && state.groups['machine-services'].services === 0 && state.groups['cloud-services'].services === 0
      && state.groups['ai-providers'].expanded && state.groups['ai-providers'].services === serviceCount('ai-providers')
      && state.groups['ai-platforms'].services === serviceCount('ai-platforms'), 'collapsed');

    await link('cloud-services').click();
    await expect('点击导航展开并定位已收起的分组', state => state.current === 'cloud-services' && state.groups['cloud-services'].expanded
      && state.groups['cloud-services'].services === serviceCount('cloud-services') && atTop(state, 'cloud-services')
      && !state.groups['machine-services'].expanded, 'jump-to-collapsed');
    await link('ai-platforms').click();
    await expect('点击导航定位到末尾分组', state => state.current === 'ai-platforms' && (atTop(state, 'ai-platforms') || state.atEnd));

    await search.fill('微软翻译');
    await expect('搜索展开已收起分组中的匹配服务并保持导航', state => Object.keys(state.groups).length === 1
      && state.groups['machine-services'].expanded && state.groups['machine-services'].toggleDisabled
      && state.groups['machine-services'].services === 1 && state.links.length === sections.length && state.current === 'machine-services', 'searching');
    await link('ai-providers').click();
    await expect('搜索中点击导航回到完整目录并定位', state => state.query === '' && Object.keys(state.groups).length === sections.length
      && state.current === 'ai-providers' && atTop(state, 'ai-providers')
      && !state.groups['machine-services'].expanded && !state.groups['machine-services'].toggleDisabled);

    // 通用设置的“配置服务”把编辑目标换回默认服务；它所在的分组即使已收起也要展开。
    await catalog.locator('[data-service-value="deepseek"]').click();
    await page.waitForFunction(() => document.querySelector('.service-catalog')?.getAttribute('data-editing-service') === 'deepseek', null, {timeout});
    await page.locator('nav button[data-section="settings-general"]').click();
    await page.getByRole('button', {name: '配置服务', exact: true}).first().click();
    await catalog.waitFor({state: 'visible', timeout});
    await page.waitForFunction(() => document.querySelector('.service-catalog')?.getAttribute('data-editing-service') === 'freeTranslation', null, {timeout});
    await expect('直达某项服务时展开其所在分组', state => state.groups['machine-services'].expanded
      && state.groups['machine-services'].services === serviceCount('machine-services') && followsScroll(state));

    // 再次直达同一项服务时编辑目标没有变化，回到本页仍要看得到它。
    await toggle('machine-services').scrollIntoViewIfNeeded();
    await toggle('machine-services').click();
    await expect('收起正在配置的服务所在分组', state => !state.groups['machine-services'].expanded);
    await page.locator('nav button[data-section="settings-general"]').click();
    await page.getByRole('button', {name: '配置服务', exact: true}).first().click();
    await catalog.waitFor({state: 'visible', timeout});
    await expect('回到本页时展开正在配置的服务所在分组', state => state.groups['machine-services'].expanded
      && state.groups['machine-services'].services === serviceCount('machine-services') && followsScroll(state));

    // 在搜索结果里点击已选中的服务，清空搜索后它所在的分组保持展开。
    await toggle('machine-services').click();
    await search.fill('免费翻译服务');
    await catalog.locator('[data-service-value="freeTranslation"]').click();
    await search.fill('');
    await expect('点击已选中的服务会展开其所在分组', state => Object.keys(state.groups).length === sections.length
      && state.groups['machine-services'].expanded && state.groups['machine-services'].services === serviceCount('machine-services'));

    await page.setViewportSize({width: 820, height: 900});
    await expect('平板宽度保留导航且无横向溢出', state => state.navigationVisible && !state.horizontalOverflow, 'tablet');
    await page.setViewportSize({width: 390, height: 844});
    await expect('窄屏隐藏导航且无横向溢出', state => !state.navigationVisible && !state.horizontalOverflow);
    await catalog.locator('.mobile-directory-toggle').click();
    await toggle('machine-services').click();
    await expect('窄屏目录内仍可收起分组', state => !state.groups['machine-services'].expanded
      && state.groups['machine-services'].services === 0 && !state.horizontalOverflow, 'mobile-directory');

    // 窄屏加载时目录处于隐藏状态；放宽到桌面宽度后导航要立即指向当前分组。
    await page.reload({waitUntil: 'domcontentloaded'});
    await catalog.waitFor({state: 'visible', timeout});
    await page.setViewportSize({width: 1440, height: 1000});
    await expect('窄屏加载后放宽窗口时导航仍有当前分组', state => state.navigationVisible && state.current === sections[0] && followsScroll(state));

    assert(report.consoleErrors.length === 0, '浏览器控制台存在异常');
    report.ok = true;
  } catch (error) {
    report.error = error?.stack || String(error);
  } finally {
    // 未取得会话时，启动可能已部分完成；没有成功关闭的回执就保留 profile。
    let closed = !launchAttempted;
    if (launched) {
      try { await launched.close(); closed = true; }
      catch (error) { report.cleanupErrors.push(`session close: ${error?.stack || String(error)}`); }
    }
    if (profileDir) {
      if (closed && profileIdentity) {
        try {
          const current = fs.lstatSync(profileDir);
          assert(!current.isSymbolicLink() && current.ino === profileIdentity.ino && current.dev === profileIdentity.dev,
            'Temporary profile ownership changed');
          fs.rmSync(profileDir, {recursive: true, force: true});
          report.profileRemoved = true;
        } catch (error) {
          report.cleanupErrors.push(`profile removal: ${error?.stack || String(error)}`);
          report.retainedProfile = profileDir;
        }
      } else report.retainedProfile = profileDir;
    }
    if (report.cleanupErrors.length) report.ok = false;
    // 报告最后写入，写失败不跳过独立清理，也不覆盖最先发生的异常。
    try { fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2)); }
    catch (error) {
      report.cleanupErrors.push(`report write: ${error?.stack || String(error)}`);
      report.ok = false;
      console.error(error?.stack || String(error));
    }
  }
  console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, error: report.error,
    cleanupErrors: report.cleanupErrors, retainedProfile: report.retainedProfile, artifactsDir}));
  if (!report.ok) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
