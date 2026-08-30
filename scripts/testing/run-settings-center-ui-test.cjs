'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = path.resolve(argument('playwright-root', ''));
// 统一回归 runner 使用 --focus-safe-helper；旧的 --focus-helper 仅保留为本脚本的兼容别名。
const focusHelper = path.resolve(argument('focus-safe-helper', argument('focus-helper', '')));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-settings-center-ui'));
const browserPath = argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const timeout = Number(argument('timeout', '30000'));
const expectedNavigation = [
  ['settings-general', '通用设置'],
  ['settings-services', '翻译服务'],
  ['settings-translation', '翻译设置'],
  ['settings-image-translation', '图片与圈选翻译'],
  ['settings-video', '视频字幕翻译'],
  ['settings-sites', '网站规则'],
  ['settings-translation-center', '翻译中心'],
  ['settings-model-usage', '模型用量'],
  ['settings-vocabulary', '单词本'],
  ['settings-advanced', '高级选项'],
  ['settings-data', '配置管理'],
  ['settings-about', '关于流畅阅读'],
];
const expectedNavigationGroups = [
  ['基础配置', ['settings-general', 'settings-services', 'settings-translation']],
  ['专项翻译', ['settings-image-translation', 'settings-video', 'settings-sites']],
  ['工具与学习', ['settings-translation-center', 'settings-model-usage', 'settings-vocabulary']],
  ['系统与数据', ['settings-advanced', 'settings-data', 'settings-about']],
];
const expectedGeneralGroups = ['选择翻译服务', '译文显示', '网页辅助'];
const expectedTranslationGroups = ['鼠标悬浮翻译', '划词翻译', '输入框翻译', '全文翻译'];
const configDatabaseName = 'FluentReadConfiguration';
const expectedEncryptedRecordKeys = [
  'local:config',
  'local:configHistory',
  'local:configAutoBackups',
  'local:credentials',
];
const legacyLocalStorageKeys = [
  'config', 'local:config',
  'configHistory', 'local:configHistory',
  'configAutoBackups', 'local:configAutoBackups',
  'credentials', 'local:credentials',
  'fluentReadImageOcrLanguages', 'local:fluentReadImageOcrLanguages',
];
const legacySessionStorageKeys = ['credentials', 'session:credentials'];
const legacyMigrationSentinels = {
  token: 'legacy-session-openai-token-sensitive-sentinel',
  appid: 'legacy-session-appid-sensitive-sentinel',
  key: 'legacy-session-key-sensitive-sentinel',
  userRole: 'legacy-user-role-sensitive-sentinel {{text}}',
  systemRole: 'legacy-system-role-sensitive-sentinel',
};

if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`扩展产物不存在：${extensionDir}`);
if (!fs.existsSync(focusHelper)) throw new Error(`防抢焦点 helper 不存在：${focusHelper}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {
  launchFocusSafePersistentContext,
  newPageWithoutForeground,
} = require(focusHelper);

async function screenshot(page, file) {
  const target = path.join(artifactsDir, file);
  await page.screenshot({path: target, fullPage: false});
  return target;
}

async function seedModelUsageFixture(page) {
  return page.evaluate(async () => {
    const now = Date.now();
    const localDay = daysAgo => {
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      date.setHours(12, 0, 0, 0);
      return date.getTime();
    };
    const base = {
      schemaVersion: 1,
      durationMs: 420,
      purpose: 'translation',
      outcome: 'success',
      usageAvailability: 'reported',
      statusCode: 200,
    };
    const events = [
      {...base, id: 'ui-kimi-today', startedAt: now - 1000, serviceId: 'moonshot', configuredModel: 'kimi-k2.6', actualModel: 'kimi-k2.6', model: 'kimi-k2.6', inputTokens: 120, outputTokens: 80, totalTokens: 200, cachedInputTokens: 20},
      {...base, id: 'ui-kimi-yesterday', startedAt: localDay(1), serviceId: 'moonshot', configuredModel: 'kimi-k2.6', actualModel: 'kimi-k2.6', model: 'kimi-k2.6', inputTokens: 180, outputTokens: 120, totalTokens: 300},
      {...base, id: 'ui-openai-five-days', startedAt: localDay(5), serviceId: 'openai', configuredModel: 'gpt-5.6-luna', actualModel: 'gpt-5.6-luna', model: 'gpt-5.6-luna', inputTokens: 100, outputTokens: 50, totalTokens: 150},
      {...base, id: 'ui-kimi-ten-days', startedAt: localDay(10), serviceId: 'moonshot', configuredModel: 'kimi-k3', actualModel: 'kimi-k3', model: 'kimi-k3', inputTokens: 420, outputTokens: 180, totalTokens: 600},
      {...base, id: 'ui-kimi-unreported', startedAt: now - 500, serviceId: 'moonshot', configuredModel: 'kimi-k2.6', actualModel: 'kimi-k2.6', model: 'kimi-k2.6', usageAvailability: 'unreported'},
      {...base, id: 'ui-deepseek-error', startedAt: now - 250, serviceId: 'deepseek', configuredModel: 'deepseek-chat', actualModel: 'deepseek-chat', model: 'deepseek-chat', outcome: 'error', usageAvailability: 'unreported', statusCode: 429},
    ];

    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('FluentReadModelUsage');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('events')) throw new Error('模型用量 events 表未创建');
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('events', 'readwrite');
        const store = transaction.objectStore('events');
        store.clear();
        for (const event of events) store.put(event);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    return {
      eventCount: events.length,
      allTokens: 1250,
      kimiTokens: 1100,
      kimiK2Tokens: 500,
      todayKimiTokens: 200,
      allAverageInput: 205,
      allAverageOutput: 108,
      todayKimiAverageInput: 120,
      todayKimiAverageOutput: 80,
    };
  });
}

async function appendModelUsageRefreshEvent(page) {
  return page.evaluate(async () => {
    const event = {
      schemaVersion: 1,
      id: 'ui-return-refresh',
      startedAt: Date.now() - 100,
      durationMs: 360,
      serviceId: 'openai',
      configuredModel: 'gpt-5.6-luna',
      actualModel: 'gpt-5.6-luna',
      model: 'gpt-5.6-luna',
      purpose: 'translation',
      outcome: 'success',
      usageAvailability: 'reported',
      statusCode: 200,
      inputTokens: 30,
      outputTokens: 20,
      totalTokens: 50,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('FluentReadModelUsage');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('events', 'readwrite');
        transaction.objectStore('events').put(event);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    return {deltaTokens: event.totalTokens};
  });
}

async function chooseDifferentSelectOption(page, ariaLabel) {
  const input = page.locator(`input[aria-label="${ariaLabel}"]`);
  await input.waitFor({state: 'visible', timeout});
  const wrapper = input.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " el-select__wrapper ")][1]');
  const selectedLabel = wrapper.locator('.el-select__placeholder');
  const before = (await selectedLabel.textContent())?.trim();
  await wrapper.click();
  const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item:not(.is-disabled)');
  await options.first().waitFor({state: 'visible', timeout});
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if ((await option.textContent())?.trim() !== before) {
      await option.click();
      await page.waitForFunction(
        ({label, previous}) => document.querySelector(`input[aria-label="${label}"]`)
          ?.closest('.el-select__wrapper')
          ?.querySelector('.el-select__placeholder')
          ?.textContent?.trim() !== previous,
        {label: ariaLabel, previous: before},
        {timeout},
      );
      const after = (await selectedLabel.textContent())?.trim();
      if (after === before) throw new Error(`${ariaLabel} 未切换到其他选项`);
      return {before, after};
    }
  }
  throw new Error(`${ariaLabel} 没有可切换的选项`);
}

async function selectElementPlusOption(page, ariaLabel, optionText) {
  const input = page.locator(`input[aria-label="${ariaLabel}"]`);
  await input.waitFor({state: 'visible', timeout});
  const wrapper = input.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " el-select__wrapper ")][1]');
  await wrapper.click();
  const option = page.locator('.el-select-dropdown:visible .el-select-dropdown__item:not(.is-disabled)')
    .filter({hasText: optionText})
    .first();
  await option.waitFor({state: 'visible', timeout});
  await option.evaluate(element => element.click());
  try {
    await page.waitForFunction(({label, expected}) => {
      const inputElement = [...document.querySelectorAll('input[aria-label]')]
        .find(element => element.getAttribute('aria-label') === label);
      const selectWrapper = inputElement?.closest('.el-select__wrapper');
      const displayed = selectWrapper?.querySelector('.el-select__selected-item, .el-select__placeholder');
      return displayed?.textContent?.trim() === expected
        || selectWrapper?.textContent?.trim() === expected;
    }, {label: ariaLabel, expected: optionText}, {timeout});
  } catch (error) {
    const state = await wrapper.evaluate(element => ({
      text: element.textContent?.trim(),
      html: element.innerHTML,
      inputs: [...element.querySelectorAll('input')].map(input => ({
        value: input.value,
        ariaLabel: input.getAttribute('aria-label'),
      })),
    }));
    throw new Error(`${ariaLabel} 选择后状态异常：${JSON.stringify(state)}；${error instanceof Error ? error.message : String(error)}`);
  }
  await page.keyboard.press('Escape');
  await page.locator('.el-select-dropdown:visible').waitFor({state: 'hidden', timeout});
}

function assertExportContainsAllUserConfiguration(value) {
  const credentialFields = [
    'token', 'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
    'tencentSecretId', 'tencentSecretKey', 'extra',
  ];
  for (const field of credentialFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`导出配置缺少专用凭据字段：${field}`);
    }
  }
  for (const field of ['system_role', 'user_role', 'model', 'customModel', 'customBody', 'proxy']) {
    if (!value[field] || typeof value[field] !== 'object' || Array.isArray(value[field])) {
      throw new Error(`导出配置缺少完整用户映射：${field}`);
    }
  }
  for (const field of ['count', 'persistCredentials', '__fluentConfigRevision', '__fluentCountOperations']) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`导出配置包含不可迁移运行字段：${field}`);
    }
  }
}

function assertImportedSentinels(value, sentinels) {
  const expected = {
    token: value.token?.openai,
    ak: value.ak,
    sk: value.sk,
    appid: value.appid,
    key: value.key,
    youdaoAppKey: value.youdaoAppKey,
    youdaoAppSecret: value.youdaoAppSecret,
    tencentSecretId: value.tencentSecretId,
    tencentSecretKey: value.tencentSecretKey,
    extra: value.extra?.indexedDbProof,
    userRole: value.user_role?.openai,
    systemRole: value.system_role?.openai,
    proxy: value.proxy?.openai,
    customBody: value.customBody?.openai,
  };
  for (const [field, sentinel] of Object.entries(sentinels)) {
    if (expected[field] !== sentinel) {
      throw new Error(`重载后的导出配置未保留 ${field}：${JSON.stringify(expected[field])}`);
    }
  }
}

async function inspectEncryptedConfigurationStorage(page, sentinels, expectedRecordKeys = expectedEncryptedRecordKeys) {
  const snapshot = await page.evaluate(async ({databaseName}) => {
    const requestResult = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
    });
    const database = await requestResult(indexedDB.open(databaseName));
    let records;
    try {
      const transaction = database.transaction('records', 'readonly');
      records = await requestResult(transaction.objectStore('records').getAll());
    } finally {
      database.close();
    }
    const local = await chrome.storage.local.get(null);
    let session = {};
    let sessionSupported = true;
    try {
      session = await chrome.storage.session.get(null);
    } catch {
      sessionSupported = false;
    }
    return {records, local, session, sessionSupported};
  }, {databaseName: configDatabaseName});

  const rawRecords = JSON.stringify(snapshot.records);
  for (const sentinel of Object.values(sentinels)) {
    if (rawRecords.includes(sentinel)) throw new Error(`IndexedDB 原始记录泄露明文：${sentinel}`);
  }
  const recordKeys = snapshot.records.map(record => record.key).sort();
  for (const key of expectedRecordKeys) {
    if (!recordKeys.includes(key)) throw new Error(`加密配置数据库缺少记录：${key}`);
  }
  if (recordKeys.includes('session:credentials')) {
    throw new Error('旧 session:credentials 迁移后仍残留在加密配置数据库');
  }
  for (const record of snapshot.records) {
    const payload = record?.payload;
    if (payload?.format !== 'fluentread-config'
      || payload?.version !== 1
      || payload?.algorithm !== 'AES-GCM'
      || typeof payload?.iv !== 'string'
      || typeof payload?.ciphertext !== 'string'
      || 'value' in record) {
      throw new Error(`IndexedDB 配置记录不是受支持的密文 envelope：${record?.key}`);
    }
  }
  const localKeys = Object.keys(snapshot.local).sort();
  const sessionKeys = Object.keys(snapshot.session).sort();
  const retainedLegacyLocal = legacyLocalStorageKeys.filter(key => localKeys.includes(key));
  const retainedLegacySession = legacySessionStorageKeys.filter(key => sessionKeys.includes(key));
  if (retainedLegacyLocal.length || retainedLegacySession.length) {
    throw new Error(`旧配置键未清理：${JSON.stringify({retainedLegacyLocal, retainedLegacySession})}`);
  }
  const sessionMaterialKeys = sessionKeys.filter(key => (
    key === 'configIndexedDbKeyMaterial' || key === 'session:configIndexedDbKeyMaterial'
  ));
  // 升级旧 session 凭据时可能短暂生成一份随机会话材料；Chrome 也可能在
  // runtime.reload 时直接清除它。它不是凭据权威记录，因此只禁止重复残留，
  // 不把“必须存在”或“必须不存在”当成持久化正确性的前提。
  if (sessionMaterialKeys.length > 1) {
    throw new Error(`会话密钥材料出现重复别名：${JSON.stringify(sessionKeys)}`);
  }
  return {
    databaseName: configDatabaseName,
    recordKeys,
    encryptedEnvelopeCount: snapshot.records.length,
    localStorageKeys: localKeys,
    sessionStorageKeys: sessionKeys,
    sessionMaterialKeys,
    plaintextSentinelsAbsent: true,
    legacyKeysAbsent: true,
  };
}

async function seedLegacyStorageAndReloadExtension(page, context, extensionOrigin, timeout) {
  const legacySources = await page.evaluate(async ({databaseName, sentinels}) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('删除配置数据库失败'));
      request.onblocked = () => reject(new Error('配置数据库仍被旧后台连接占用'));
    });

    const localKeys = [
      'config', 'local:config',
      'configHistory', 'local:configHistory',
      'configAutoBackups', 'local:configAutoBackups',
      'credentials', 'local:credentials',
      'fluentReadImageOcrLanguages', 'local:fluentReadImageOcrLanguages',
    ];
    const sessionKeys = [
      'credentials', 'session:credentials',
      'configIndexedDbKeyMaterial', 'session:configIndexedDbKeyMaterial',
    ];
    await chrome.storage.local.remove(localKeys);
    await chrome.storage.session.remove(sessionKeys);
    await chrome.storage.local.set({
      config: JSON.stringify({
        on: true,
        service: 'freeTranslation',
        display: 1,
        from: 'auto',
        to: 'zh-Hans',
        persistCredentials: true,
        token: {openai: 'legacy-embedded-token-must-lose-precedence'},
        appid: 'legacy-embedded-appid-must-lose-precedence',
        key: 'legacy-embedded-key-must-lose-precedence',
        user_role: {openai: sentinels.userRole},
        system_role: {openai: sentinels.systemRole},
      }),
      credentials: {
        token: {openai: sentinels.token},
        appid: sentinels.appid,
        key: sentinels.key,
      },
    });
    const localBeforeReload = await chrome.storage.local.get(null);
    const sessionBeforeReload = await chrome.storage.session.get(null);
    setTimeout(() => chrome.runtime.reload(), 50);
    return {
      localKeys: Object.keys(localBeforeReload).sort(),
      sessionKeys: Object.keys(sessionBeforeReload).sort(),
      configStoredAsJsonString: typeof localBeforeReload.config === 'string',
    };
  }, {databaseName: configDatabaseName, sentinels: legacyMigrationSentinels});

  await new Promise(resolve => setTimeout(resolve, 750));
  if (!page.isClosed()) await page.close().catch(() => undefined);
  let migratedPage;
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    migratedPage = await newPageWithoutForeground(context, timeout);
    try {
      await migratedPage.goto(`${extensionOrigin}/options.html#settings-general`, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      await migratedPage.locator('.settings-app').waitFor({state: 'visible', timeout});
      return {page: migratedPage, legacySources};
    } catch (error) {
      lastError = error;
      await migratedPage.close().catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error(`扩展重载后设置页不可用：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-settings-center-profile-'));
  const errors = [];
  const report = {
    extensionDir,
    artifactsDir,
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    navigation: [],
    responsive: [],
    defaultServiceCard: {responsive: []},
    informationArchitecture: {},
    assertions: {},
    consoleErrors: errors,
    screenshots: [],
  };
  let launched;
  try {
    launched = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: {width: 1440, height: 1000},
      timeout,
    });
    report.launchMode = launched.launchMode;
    report.focusPolicy = launched.focusPolicy;
    report.windowPlacement = launched.windowPlacement;
    const {context} = launched;
    let workers = context.serviceWorkers().filter(worker => worker.url().startsWith('chrome-extension://'));
    if (workers.length === 0) workers = [await context.waitForEvent('serviceworker', {timeout})];
    const extensionId = new URL(workers[0].url()).host;
    const extensionOrigin = `chrome-extension://${extensionId}`;
    const attachPageDiagnostics = targetPage => {
      targetPage.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
      targetPage.on('console', message => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
    };
    let page = await newPageWithoutForeground(context, timeout);
    attachPageDiagnostics(page);
    await page.goto(`${extensionOrigin}/options.html#settings-general`, {waitUntil: 'domcontentloaded', timeout});
    await page.locator('.settings-app').waitFor({state: 'visible', timeout});
    await page.setViewportSize({width: 1440, height: 1000});

    const migration = await seedLegacyStorageAndReloadExtension(page, context, extensionOrigin, timeout);
    page = migration.page;
    attachPageDiagnostics(page);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.locator('button[data-section="settings-data"]').click();
    await page.getByRole('heading', {name: '最近修改', exact: true}).waitFor({state: 'visible', timeout});
    await page.getByRole('heading', {name: '定时备份', exact: true}).waitFor({state: 'visible', timeout});
    const migratedRecordKeys = ['local:config', 'local:configAutoBackups', 'local:credentials'];
    await page.waitForFunction(async ({databaseName, expectedKeys}) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const keys = await new Promise((resolve, reject) => {
          const request = database.transaction('records', 'readonly').objectStore('records').getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return expectedKeys.every(key => keys.includes(key));
      } finally {
        database.close();
      }
    }, {databaseName: configDatabaseName, expectedKeys: migratedRecordKeys}, {timeout});
    report.legacyMigration = {
      ...migration.legacySources,
      ...(await inspectEncryptedConfigurationStorage(page, legacyMigrationSentinels, migratedRecordKeys)),
      legacyPersistentCredentialsMigratedAfterExtensionReload: true,
      legacySessionRecordAbsent: true,
    };
    await page.locator('button[data-section="settings-general"]').click();

    const navButtons = page.locator('nav[aria-label="设置分类"] button');
    const navCount = await navButtons.count();
    if (navCount !== expectedNavigation.length) throw new Error(`导航数量异常：${navCount}`);
    const ids = await navButtons.evaluateAll(buttons => buttons.map(button => button.dataset.section));
    if (new Set(ids).size !== ids.length) throw new Error('导航 section id 重复');
    const navigationContract = await navButtons.evaluateAll(buttons => buttons.map(button => [
      button.dataset.section,
      button.querySelector('strong')?.textContent?.trim(),
    ]));
    if (JSON.stringify(navigationContract) !== JSON.stringify(expectedNavigation)) {
      throw new Error(`导航顺序或名称异常：${JSON.stringify(navigationContract)}`);
    }
    report.informationArchitecture.navigation = navigationContract;
    const navigationGroupContract = await page.locator('nav[aria-label="设置分类"] .nav-group').evaluateAll(groups => groups.map(group => [
      group.querySelector('.nav-group-label')?.textContent?.trim(),
      [...group.querySelectorAll('button[data-section]')].map(button => button.dataset.section),
    ]));
    if (JSON.stringify(navigationGroupContract) !== JSON.stringify(expectedNavigationGroups)) {
      throw new Error(`导航分组异常：${JSON.stringify(navigationGroupContract)}`);
    }
    report.informationArchitecture.navigationGroups = navigationGroupContract;

    for (let index = 0; index < navCount; index += 1) {
      const button = navButtons.nth(index);
      const id = await button.getAttribute('data-section');
      const label = (await button.locator('strong').textContent())?.trim();
      await button.click();
      const activeButtons = page.locator('nav[aria-label="设置分类"] button[aria-current="page"]');
      if (await activeButtons.count() !== 1 || await activeButtons.first().getAttribute('data-section') !== id) {
        throw new Error(`${id} 导航激活状态异常`);
      }
      const anchor = page.locator(`#${id}`);
      if (await anchor.count() !== 1 || !await anchor.isVisible()) throw new Error(`页面锚点不可见：${id}`);
      const visiblePageHeadings = await page.locator('.topbar h1:visible').count();
      if (visiblePageHeadings !== 1) throw new Error(`${id} 页面级标题数量异常：${visiblePageHeadings}`);
      if (await page.locator('.card-intro:visible').count() !== 0) throw new Error(`${id} 仍有重复 card intro`);
      const metrics = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (metrics.horizontalOverflow) throw new Error(`${id} 出现横向滚动：${JSON.stringify(metrics)}`);
      const file = `settings-${String(index + 1).padStart(2, '0')}-${id}.png`;
      report.screenshots.push(await screenshot(page, file));
      report.navigation.push({id, label, title: (await page.locator('.topbar h1').textContent())?.trim(), metrics});
    }
    report.assertions.navigation = true;
    report.assertions.singlePageIntro = true;
    report.assertions.noLegacyIntros = await page.locator('.video-settings-hero, .image-ocr-kicker, .site-rules-kicker').count() === 0;
    if (!report.assertions.noLegacyIntros) throw new Error('仍存在旧的重复介绍元素');

    await page.locator('button[data-section="settings-model-usage"]').click();
    await page.locator('#settings-model-usage').waitFor({state: 'visible', timeout});
    await page.waitForFunction(() => document.querySelector('#settings-model-usage .usage-state-card, #settings-model-usage .usage-summary-grid'), undefined, {timeout});
    const modelUsageFixture = await seedModelUsageFixture(page);
    await page.reload({waitUntil: 'domcontentloaded', timeout});
    await page.locator('#settings-model-usage').waitFor({state: 'visible', timeout});
    const usageTokenValue = () => page.locator('#settings-model-usage .usage-token-card .usage-card-heading strong').textContent()
      .then(value => Number(String(value || '').replace(/[^0-9]/g, '')));
    await page.waitForFunction(expected => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === expected;
    }, modelUsageFixture.allTokens, {timeout});
    const filterPlaceholders = await page.locator('#settings-model-usage .usage-select-shell .el-select__placeholder').allTextContents();
    if (JSON.stringify(filterPlaceholders.map(value => value.trim())) !== JSON.stringify(['全部 AI 服务', '全部模型'])) {
      throw new Error(`模型用量筛选占位文字异常：${JSON.stringify(filterPlaceholders)}`);
    }
    const filterPlaceholderMetrics = await page.locator('#settings-model-usage .usage-select-shell .el-select__placeholder').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim(),
        opacity: style.opacity,
        visibility: style.visibility,
        display: style.display,
        color: style.color,
        width: rect.width,
        height: rect.height,
        parentOpacity: getComputedStyle(element.parentElement || element).opacity,
      };
    }));
    if (filterPlaceholderMetrics.some(metric => metric.width <= 0 || metric.height <= 0 || metric.opacity === '0' || metric.visibility !== 'visible')) {
      throw new Error('模型用量筛选占位文字不可见：' + JSON.stringify(filterPlaceholderMetrics));
    }
    await page.locator('#settings-model-usage .usage-select-shell').first().click();
    const openFilterDropdown = page.locator('.el-select-dropdown:visible').first();
    await openFilterDropdown.waitFor({state: 'visible', timeout});
    const filterDropdownMetrics = await openFilterDropdown.evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        width: rect.width,
        height: rect.height,
      };
    });
    if (filterDropdownMetrics.width <= 0 || filterDropdownMetrics.height <= 0) {
      throw new Error('模型用量筛选下拉框展开尺寸异常：' + JSON.stringify(filterDropdownMetrics));
    }
    report.screenshots.push(await screenshot(page, 'settings-model-usage-filter-open.png'));
    await page.keyboard.press('Escape');
    await openFilterDropdown.waitFor({state: 'hidden', timeout});
    const allAverageValues = (await page.locator('#settings-model-usage .usage-average-value strong').allTextContents())
      .map(value => value.trim());
    if (JSON.stringify(allAverageValues) !== JSON.stringify([
      String(modelUsageFixture.allAverageInput),
      String(modelUsageFixture.allAverageOutput),
    ])) {
      throw new Error(`全部范围的平均输入输出异常：${JSON.stringify(allAverageValues)}`);
    }
    const breakdownHeaders = (await page.locator('#settings-model-usage .usage-breakdown-heading > *').allTextContents())
      .map(value => value.trim());
    if (JSON.stringify(breakdownHeaders) !== JSON.stringify(['服务 / 模型', '输入', '输出', '次数', '总计'])) {
      throw new Error('模型用量分布列异常：' + JSON.stringify(breakdownHeaders));
    }
    const breakdownTotals = (await page.locator('#settings-model-usage .usage-breakdown-total').allTextContents())
      .map(value => value.trim());
    if (JSON.stringify(breakdownTotals) !== JSON.stringify(['600', '500', '150', '0'])) {
      throw new Error('模型用量分布排序异常：' + JSON.stringify(breakdownTotals));
    }
    const breakdownRequests = (await page.locator('#settings-model-usage .usage-breakdown-requests').allTextContents())
      .map(value => value.trim());
    if (JSON.stringify(breakdownRequests) !== JSON.stringify(['1', '3', '1', '1'])) {
      throw new Error('模型用量请求次数列异常：' + JSON.stringify(breakdownRequests));
    }
    await page.getByRole('button', {name: '按输入排序', exact: true}).click();
    const breakdownSortedByInput = (await page.locator('#settings-model-usage .usage-breakdown-value').evaluateAll(elements => elements
      .filter((_, index) => index % 4 === 0)
      .map(element => element.textContent?.trim())))
      .every((value, index, values) => index === 0 || Number(values[index - 1]) >= Number(value));
    if (!breakdownSortedByInput) throw new Error('模型用量没有按输入 Token 降序排列');
    await page.getByRole('button', {name: '按输出排序', exact: true}).click();
    const outputValues = (await page.locator('#settings-model-usage .usage-breakdown-list > button .usage-breakdown-value').evaluateAll(elements => elements
      .filter((_, index) => index % 4 === 1)
      .map(element => element.textContent?.trim())));
    if (JSON.stringify(outputValues) !== JSON.stringify(['200', '180', '50', '0'])) {
      throw new Error('模型用量没有按输出 Token 降序排列：' + JSON.stringify(outputValues));
    }
    await page.getByRole('button', {name: '按次数排序', exact: true}).click();
    const requestsSortedByCount = (await page.locator('#settings-model-usage .usage-breakdown-requests').allTextContents())
      .map(value => value.trim());
    if (JSON.stringify(requestsSortedByCount) !== JSON.stringify(['3', '1', '1', '1'])) {
      throw new Error('模型用量没有按请求次数降序排列：' + JSON.stringify(requestsSortedByCount));
    }
    await page.getByRole('button', {name: '按总计排序', exact: true}).click();
    await selectElementPlusOption(page, '模型用量服务', '月之暗面/Kimi');
    await page.waitForFunction(expected => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === expected;
    }, modelUsageFixture.kimiTokens, {timeout});
    await selectElementPlusOption(page, '模型用量模型', 'kimi-k2.6');
    await page.waitForFunction(expected => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === expected;
    }, modelUsageFixture.kimiK2Tokens, {timeout});
    const usageRangeGroup = page.getByRole('radiogroup', {name: '模型用量时间范围'});
    const usageThirtyDayRadio = usageRangeGroup.getByRole('radio', {name: '30 天', exact: true});
    await usageThirtyDayRadio.focus();
    await usageThirtyDayRadio.press('Home');
    await page.waitForFunction(() => {
      const group = document.querySelector('[role="radiogroup"][aria-label="模型用量时间范围"]');
      const selected = group?.querySelector('[role="radio"][aria-checked="true"]');
      return selected?.textContent?.trim() === '今日'
        && selected === document.activeElement
        && group?.querySelectorAll('[role="radio"][tabindex="0"]').length === 1;
    }, undefined, {timeout});
    await page.waitForFunction(expected => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === expected;
    }, modelUsageFixture.todayKimiTokens, {timeout});
    const todayAverageValues = (await page.locator('#settings-model-usage .usage-average-value strong').allTextContents())
      .map(value => value.trim());
    if (JSON.stringify(todayAverageValues) !== JSON.stringify([
      String(modelUsageFixture.todayKimiAverageInput),
      String(modelUsageFixture.todayKimiAverageOutput),
    ])) {
      throw new Error(`今日范围的平均输入输出异常：${JSON.stringify(todayAverageValues)}`);
    }
    const usageRequestCount = Number((await page.locator('#settings-model-usage .usage-compact-card').first().locator('strong').textContent())?.replace(/[^0-9]/g, '') || 0);
    if (usageRequestCount !== 2) throw new Error(`Kimi 今日请求数异常：${usageRequestCount}`);
    const coverageNotice = (await page.locator('#settings-model-usage .usage-coverage-note').textContent())?.replace(/\s+/g, ' ').trim();
    if (!coverageNotice?.includes('50%')) throw new Error(`Token 上报覆盖率异常：${coverageNotice}`);
    await page.getByRole('button', {name: '清除统计', exact: true}).click();
    const resetDialog = page.getByRole('alertdialog', {name: '清除本机模型用量？'});
    await resetDialog.waitFor({state: 'visible', timeout});
    if (!await resetDialog.getByText(/不会删除 API Key、翻译设置、缓存或配置历史/).isVisible()) {
      throw new Error('模型用量重置没有明确隔离其他本地数据');
    }
    const resetCancelButton = resetDialog.getByRole('button', {name: '取消', exact: true});
    const resetConfirmButton = resetDialog.getByRole('button', {name: '确认清除统计', exact: true});
    if (!await resetCancelButton.evaluate(button => button === document.activeElement)) {
      throw new Error('模型用量重置对话框没有将初始焦点放在安全的取消按钮');
    }
    if (await page.locator('.settings-app').getAttribute('inert') === null) {
      throw new Error('模型用量重置对话框打开时背景设置仍可交互');
    }
    await resetCancelButton.press('Shift+Tab');
    if (!await resetConfirmButton.evaluate(button => button === document.activeElement)) {
      throw new Error('模型用量重置对话框没有向后闭环焦点');
    }
    await resetConfirmButton.press('Tab');
    if (!await resetCancelButton.evaluate(button => button === document.activeElement)) {
      throw new Error('模型用量重置对话框没有向前闭环焦点');
    }
    await resetCancelButton.click();
    await resetDialog.waitFor({state: 'hidden', timeout});
    if (await page.locator('.settings-app').getAttribute('inert') !== null) {
      throw new Error('模型用量重置对话框关闭后背景仍被锁定');
    }
    if (!await page.getByRole('button', {name: '清除统计', exact: true}).evaluate(button => button === document.activeElement)) {
      throw new Error('模型用量重置对话框关闭后没有恢复触发按钮焦点');
    }
    if (await usageTokenValue() !== modelUsageFixture.todayKimiTokens) throw new Error('取消清除后统计发生变化');

    await selectElementPlusOption(page, '模型用量服务', 'DeepSeek');
    await selectElementPlusOption(page, '模型用量模型', 'deepseek-chat');
    await page.waitForFunction(() => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === 0
        && document.querySelector('#settings-model-usage .usage-compact-card')?.textContent?.includes('1');
    }, undefined, {timeout});
    if (await page.locator('#settings-model-usage .usage-ratio').count() !== 0) {
      throw new Error('零 Token 请求仍显示了虚假的输入输出比例');
    }
    if (!await page.getByText('尚无已报告的输入 / 输出 Token', {exact: true}).isVisible()) {
      throw new Error('零 Token 请求没有显示未报告说明');
    }
    const zeroTokenBreakdownWidth = await page.locator('#settings-model-usage .usage-breakdown-copy i b').first().evaluate(bar => bar.style.width);
    if (zeroTokenBreakdownWidth !== '0%') {
      throw new Error(`零 Token 分布行仍显示了虚假长度：${zeroTokenBreakdownWidth}`);
    }
    await selectElementPlusOption(page, '模型用量服务', '全部 AI 服务');
    await selectElementPlusOption(page, '模型用量模型', '全部模型');
    await usageRangeGroup.getByRole('radio', {name: '30 天', exact: true}).click();
    await page.waitForFunction(expected => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === expected;
    }, modelUsageFixture.allTokens, {timeout});
    report.modelUsage = {
      ...modelUsageFixture,
      filteredProvider: 'moonshot',
      filteredModel: 'kimi-k2.6',
      todayRequestCount: usageRequestCount,
      allAverageInput: modelUsageFixture.allAverageInput,
      allAverageOutput: modelUsageFixture.allAverageOutput,
      todayAverageInput: modelUsageFixture.todayKimiAverageInput,
      todayAverageOutput: modelUsageFixture.todayKimiAverageOutput,
      breakdownHeaders,
      breakdownTotals,
      breakdownRequests,
      breakdownSortedByInput,
      breakdownSortedByOutput: true,
      breakdownSortedByRequests: true,
      breakdownSortedByTotal: true,
      filterPlaceholderMetrics,
      filterDropdownMetrics,
      tokenCoverage: coverageNotice,
      resetCancelPreserved: true,
      rangeKeyboard: true,
      resetFocusLoop: true,
      zeroTokenEncoding: true,
    };
    report.screenshots.push(await screenshot(page, 'settings-model-usage-seeded.png'));
    report.assertions.modelUsageFilters = true;
    report.assertions.modelUsageResetIsolation = true;
    report.assertions.modelUsageRangeKeyboard = true;
    report.assertions.modelUsageResetFocus = true;
    report.assertions.modelUsageZeroTokenEncoding = true;

    await page.locator('button[data-section="settings-general"]').click();
    const refreshEvent = await appendModelUsageRefreshEvent(page);
    await page.locator('button[data-section="settings-model-usage"]').click();
    const refreshedTokenTotal = modelUsageFixture.allTokens + refreshEvent.deltaTokens;
    await page.waitForFunction(expected => {
      const text = document.querySelector('#settings-model-usage .usage-token-card .usage-card-heading strong')?.textContent || '';
      return Number(text.replace(/[^0-9]/g, '')) === expected;
    }, refreshedTokenTotal, {timeout});
    report.modelUsage.returnRefreshTokens = refreshedTokenTotal;
    report.assertions.modelUsageReturnRefresh = true;
    await page.locator('button[data-section="settings-general"]').click();
    const themeGroup = page.getByRole('radiogroup', {name: '界面主题'});
    const initialThemeRadio = themeGroup.locator('[role="radio"][aria-checked="true"]');
    await initialThemeRadio.focus();
    await initialThemeRadio.press('ArrowRight');
    await page.waitForTimeout(50);
    const keyboardSelectedTheme = themeGroup.locator('[role="radio"][aria-checked="true"]');
    if (await keyboardSelectedTheme.count() !== 1 || !await keyboardSelectedTheme.evaluate(element => element === document.activeElement)) {
      throw new Error('分段选择器没有用方向键切换并移动焦点');
    }
    await themeGroup.getByRole('radio', {name: '暗色主题', exact: true}).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, {timeout});
    const darkColors = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
      surface: getComputedStyle(document.querySelector('.settings-group-body')).backgroundColor,
    }));
    const isDarkColor = value => {
      const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
      return channels.length === 3 && channels.reduce((sum, channel) => sum + channel, 0) / 3 < 90;
    };
    if (!Object.values(darkColors).every(isDarkColor)) throw new Error(`暗色主题表面仍为亮色：${JSON.stringify(darkColors)}`);
    report.screenshots.push(await screenshot(page, 'settings-dark-general.png'));
    await page.locator('button[data-section="settings-services"]').click();
    report.screenshots.push(await screenshot(page, 'settings-dark-services.png'));
    await page.locator('button[data-section="settings-translation"]').click();
    report.screenshots.push(await screenshot(page, 'settings-dark-translation.png'));
    await page.locator('button[data-section="settings-model-usage"]').click();
    const usageDarkSurface = await page.locator('#settings-model-usage .usage-card').first().evaluate(card => getComputedStyle(card).backgroundColor);
    if (!isDarkColor(usageDarkSurface)) throw new Error(`模型用量暗色卡片仍为亮色：${usageDarkSurface}`);
    report.screenshots.push(await screenshot(page, 'settings-dark-model-usage.png'));
    await page.locator('button[data-section="settings-data"]').click();
    report.screenshots.push(await screenshot(page, 'settings-dark-data.png'));
    await page.locator('button[data-section="settings-general"]').click();
    await themeGroup.getByRole('radio', {name: '亮色主题', exact: true}).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, {timeout});
    report.assertions.segmentedKeyboard = true;
    report.assertions.darkTheme = true;

    const generalSection = page.locator('#settings-general');
    const generalGroups = (await page.locator('.settings-section:visible .settings-group-heading h2').allTextContents())
      .map(title => title.trim());
    if (JSON.stringify(generalGroups) !== JSON.stringify(expectedGeneralGroups)) {
      throw new Error(`通用设置分组异常：${JSON.stringify(generalGroups)}`);
    }
    report.informationArchitecture.generalGroups = generalGroups;

    const defaultServiceCard = generalSection.getByTestId('default-translation-service-card');
    await defaultServiceCard.waitFor({state: 'visible', timeout});
    const defaultServiceMetrics = await defaultServiceCard.evaluate(card => {
      const item = card.closest('.settings-item');
      const label = item?.querySelector('.settings-item-copy strong');
      const description = item?.querySelector('.settings-item-copy small');
      const icon = card.querySelector('.service-brand-icon');
      const selected = card.querySelector('.el-select__placeholder');
      const cardStyle = getComputedStyle(card);
      const iconRect = icon?.getBoundingClientRect();
      const selectRect = card.querySelector('.el-select')?.getBoundingClientRect();
      return {
        defaultService: card.getAttribute('data-default-service'),
        label: label?.textContent?.trim(),
        description: description?.textContent?.trim(),
        selectedService: selected?.textContent?.trim(),
        backgroundImage: cardStyle.backgroundImage,
        controlShadow: cardStyle.boxShadow,
        controlDisplay: cardStyle.display,
        iconWidth: iconRect?.width || 0,
        selectWidth: selectRect?.width || 0,
      };
    });
    if (!defaultServiceMetrics.defaultService
      || defaultServiceMetrics.label !== '默认网页翻译服务'
      || defaultServiceMetrics.description !== '全文、悬浮和划词翻译默认使用此服务。'
      || !defaultServiceMetrics.selectedService
      || defaultServiceMetrics.backgroundImage !== 'none'
      || defaultServiceMetrics.controlShadow !== 'none'
      || defaultServiceMetrics.controlDisplay !== 'grid'
      || defaultServiceMetrics.iconWidth < 39
      || defaultServiceMetrics.selectWidth < 180) {
      throw new Error(`默认翻译服务没有融入标准设置行：${JSON.stringify(defaultServiceMetrics)}`);
    }
    report.defaultServiceCard.desktop = defaultServiceMetrics;
    report.screenshots.push(await screenshot(page, 'settings-default-service-light.png'));
    report.assertions.defaultServiceHarmonious = true;

    const aiContextSwitch = page.getByRole('switch', {name: 'AI 智能上下文', exact: true});
    if (await aiContextSwitch.count() !== 1) throw new Error('通用设置没有唯一的 AI 智能上下文开关');
    if (await aiContextSwitch.isDisabled()) throw new Error('机器翻译作为默认服务时，AI 智能上下文开关不可操作');
    const aiContextControl = aiContextSwitch.locator('..');
    if (!await aiContextControl.isVisible()) throw new Error('AI 智能上下文开关没有可见的交互控件');
    const aiContextBefore = await aiContextSwitch.getAttribute('aria-checked');
    if (!['true', 'false'].includes(aiContextBefore)) throw new Error(`AI 智能上下文开关状态异常：${aiContextBefore}`);
    await aiContextControl.click();
    await page.waitForFunction(
      previous => document.querySelector('[aria-label="AI 智能上下文"]')
        ?.getAttribute('aria-checked') !== previous,
      aiContextBefore,
      {timeout},
    );
    const aiContextAfter = await aiContextSwitch.getAttribute('aria-checked');
    await aiContextControl.click();
    await page.waitForFunction(
      expected => document.querySelector('[aria-label="AI 智能上下文"]')
        ?.getAttribute('aria-checked') === expected,
      aiContextBefore,
      {timeout},
    );
    const aiContextRestored = await aiContextSwitch.getAttribute('aria-checked');

    await page.locator('button[data-section="settings-services"]').click();
    const servicesSection = page.locator('#settings-services');
    const serviceCatalog = servicesSection.locator('.service-catalog');
    await serviceCatalog.waitFor({state: 'visible', timeout});
    const serviceOnlyMetrics = {
      catalogCount: await serviceCatalog.count(),
      defaultCardCount: await servicesSection.getByTestId('default-translation-service-card').count(),
      defaultSelectCount: await servicesSection.locator('[aria-label="默认网页翻译服务"]').count(),
      settingsGroupCount: await servicesSection.locator('.settings-group').count(),
      defaultService: await serviceCatalog.getAttribute('data-default-service'),
    };
    if (serviceOnlyMetrics.catalogCount !== 1
      || serviceOnlyMetrics.defaultCardCount !== 0
      || serviceOnlyMetrics.defaultSelectCount !== 0
      || serviceOnlyMetrics.settingsGroupCount !== 0
      || serviceOnlyMetrics.defaultService !== defaultServiceMetrics.defaultService) {
      throw new Error(`翻译服务页不是纯服务目录：${JSON.stringify(serviceOnlyMetrics)}`);
    }
    const defaultServiceItem = serviceCatalog.locator(
      `.service-item[data-service-value="${defaultServiceMetrics.defaultService}"]`,
    );
    if (await defaultServiceItem.count() !== 1) throw new Error('服务目录没有显示当前默认服务');
    const defaultServiceKind = (await defaultServiceItem.locator('.service-copy small').textContent())?.trim();
    if (defaultServiceKind !== '机器翻译') {
      throw new Error(`AI 上下文开关用例没有运行在机器默认服务下：${defaultServiceKind}`);
    }
    report.informationArchitecture.services = serviceOnlyMetrics;
    report.informationArchitecture.machineDefaultAiContext = {
      defaultService: defaultServiceMetrics.defaultService,
      serviceKind: defaultServiceKind,
      before: aiContextBefore,
      after: aiContextAfter,
      restored: aiContextRestored,
    };
    report.assertions.servicesCatalogOnly = true;
    report.assertions.machineDefaultAiContextOperable = true;

    await page.locator('button[data-section="settings-translation"]').click();
    const translationSection = page.locator('#settings-translation');
    await translationSection.waitFor({state: 'visible', timeout});
    const translationGroups = (await page.locator('.settings-section:visible .settings-group-heading h2').allTextContents())
      .map(title => title.trim());
    if (JSON.stringify(translationGroups) !== JSON.stringify(expectedTranslationGroups)) {
      throw new Error(`翻译设置分组顺序异常：${JSON.stringify(translationGroups)}`);
    }
    report.informationArchitecture.translationGroups = translationGroups;
    report.assertions.translationGroupOrder = true;

    await page.locator('button[data-section="settings-general"]').click();
    const targetChange = await chooseDifferentSelectOption(page, '默认目标语言');
    await page.waitForTimeout(500);
    await page.locator('button[data-section="settings-data"]').click();
    await page.getByRole('heading', {name: '最近修改', exact: true}).waitFor({state: 'visible', timeout});
    await page.getByRole('heading', {name: '定时备份', exact: true}).waitFor({state: 'visible', timeout});
    const recentEntries = page.locator('#settings-data .version-panel').nth(0).locator('.version-entry');
    const backupEntries = page.locator('#settings-data .version-panel').nth(1).locator('.version-entry');
    if (await recentEntries.count() < 1 || await backupEntries.count() < 1) throw new Error('最近修改或定时备份没有建立基线');
    await backupEntries.first().click();
    const previewDialog = page.locator('.config-preview-dialog:visible');
    await previewDialog.waitFor({state: 'visible', timeout});
    const diffCount = await previewDialog.locator('.diff-item').count();
    if (diffCount < 1) throw new Error('配置版本详情没有显示与当前配置的差异');
    const restoreButton = previewDialog.getByRole('button', {name: '恢复此版本', exact: true});
    if (await restoreButton.isDisabled()) throw new Error('存在差异时恢复按钮仍不可用');
    await page.waitForTimeout(250);
    report.screenshots.push(await screenshot(page, 'settings-config-version-preview.png'));
    await restoreButton.click();
    const restoreConfirm = page.locator('.el-message-box:visible');
    await restoreConfirm.waitFor({state: 'visible', timeout});
    await restoreConfirm.getByRole('button', {name: '恢复', exact: true}).click();
    await previewDialog.waitFor({state: 'hidden', timeout});

    await page.locator('button[data-section="settings-general"]').click();
    const targetInput = page.locator('input[aria-label="默认目标语言"]');
    await targetInput.waitFor({state: 'visible', timeout});
    await page.waitForFunction(
      ({selector, expected}) => document.querySelector(selector)
        ?.closest('.el-select__wrapper')
        ?.querySelector('.el-select__placeholder')
        ?.textContent?.trim() === expected,
      {selector: 'input[aria-label="默认目标语言"]', expected: targetChange.before},
      {timeout},
    );

    await page.locator('button[data-section="settings-data"]').click();
    const transferActionLabels = (await page.locator('#settings-data .transfer-actions button').allTextContents())
      .map(label => label.trim());
    if (JSON.stringify(transferActionLabels) !== JSON.stringify(['导出配置', '导入配置'])) {
      throw new Error(`配置迁移入口不是唯一的导出/导入两个选项：${JSON.stringify(transferActionLabels)}`);
    }
    if (await page.getByTestId('persist-credentials-switch').count()) {
      throw new Error('配置管理仍显示已废弃的凭据持久化开关');
    }
    if ((await page.locator('#settings-data').textContent()).includes('跨浏览器重启保存 API 凭据')) {
      throw new Error('配置管理仍显示已废弃的凭据持久化文案');
    }
    await page.evaluate(() => {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) throw new Error('当前扩展页不支持 Clipboard.writeText');
      const originalWriteText = clipboard.writeText.bind(clipboard);
      Object.defineProperty(clipboard, 'writeText', {
        configurable: true,
        value: async text => {
          await originalWriteText(text);
          window.__fluentReadLastClipboardWrite = text;
        },
      });
    });
    await page.getByRole('button', {name: '导出配置', exact: true}).click();
    const transferDialog = page.getByTestId('config-transfer-dialog');
    await transferDialog.waitFor({state: 'visible', timeout});
    await transferDialog.getByText('导出配置 JSON', {exact: true}).waitFor({state: 'visible', timeout});
    const exportedText = await transferDialog.getByLabel('配置 JSON').inputValue();
    const exportedConfig = JSON.parse(exportedText);
    assertExportContainsAllUserConfiguration(exportedConfig);
    assertImportedSentinels(exportedConfig, legacyMigrationSentinels);
    await page.waitForTimeout(250);
    report.screenshots.push(await screenshot(page, 'settings-config-export-dialog.png'));
    await transferDialog.getByRole('button', {name: '复制', exact: true}).click();
    await page.locator('.el-message:visible').filter({hasText: '配置 JSON 已复制'}).waitFor({state: 'visible', timeout});
    const clipboardText = await page.evaluate(() => window.__fluentReadLastClipboardWrite);
    if (clipboardText !== exportedText) throw new Error('复制按钮写入剪贴板的 JSON 与对话框内容不一致');
    await transferDialog.getByRole('button', {name: '取消', exact: true}).click();
    await transferDialog.waitFor({state: 'hidden', timeout});

    const sentinels = {
      token: 'indexeddb-openai-token-sensitive-sentinel',
      ak: 'indexeddb-ak-sensitive-sentinel',
      sk: 'indexeddb-sk-sensitive-sentinel',
      appid: 'indexeddb-appid-sensitive-sentinel',
      key: 'indexeddb-key-sensitive-sentinel',
      youdaoAppKey: 'indexeddb-youdao-app-key-sensitive-sentinel',
      youdaoAppSecret: 'indexeddb-youdao-app-secret-sensitive-sentinel',
      tencentSecretId: 'indexeddb-tencent-secret-id-sensitive-sentinel',
      tencentSecretKey: 'indexeddb-tencent-secret-key-sensitive-sentinel',
      extra: 'indexeddb-extra-sensitive-sentinel',
      userRole: 'indexeddb-user-role-sensitive-sentinel {{text}}',
      systemRole: 'indexeddb-system-role-sensitive-sentinel',
      proxy: 'https://indexeddb-proxy-sensitive-sentinel.invalid/v1',
      customBody: '{"indexedDbProof":"indexeddb-custom-body-sensitive-sentinel"}',
    };
    const importedConfig = {
      ...exportedConfig,
      to: exportedConfig.to === 'en' ? 'ja' : 'en',
      token: {...exportedConfig.token, openai: sentinels.token},
      ak: sentinels.ak,
      sk: sentinels.sk,
      appid: sentinels.appid,
      key: sentinels.key,
      youdaoAppKey: sentinels.youdaoAppKey,
      youdaoAppSecret: sentinels.youdaoAppSecret,
      tencentSecretId: sentinels.tencentSecretId,
      tencentSecretKey: sentinels.tencentSecretKey,
      extra: {...exportedConfig.extra, indexedDbProof: sentinels.extra},
      user_role: {...exportedConfig.user_role, openai: sentinels.userRole},
      system_role: {...exportedConfig.system_role, openai: sentinels.systemRole},
      proxy: {...exportedConfig.proxy, openai: sentinels.proxy},
      customBody: {...exportedConfig.customBody, openai: sentinels.customBody},
    };
    await page.getByRole('button', {name: '导入配置', exact: true}).click();
    await transferDialog.waitFor({state: 'visible', timeout});
    await transferDialog.getByText('粘贴配置 JSON', {exact: true}).waitFor({state: 'visible', timeout});
    await transferDialog.getByLabel('配置 JSON').fill(JSON.stringify(importedConfig));
    report.screenshots.push(await screenshot(page, 'settings-config-import-dialog.png'));
    await transferDialog.getByRole('button', {name: '查看差异', exact: true}).click();
    await previewDialog.waitFor({state: 'visible', timeout});
    if (await previewDialog.locator('.diff-item').count() < 1) throw new Error('导入预览没有显示差异');
    await previewDialog.getByText('OpenAI API Key', {exact: true}).waitFor({state: 'visible', timeout});
    await previewDialog.getByText('将新增（内容已隐藏）', {exact: true}).first().waitFor({state: 'visible', timeout});
    if ((await previewDialog.textContent()).includes(sentinels.token)) throw new Error('导入预览泄露了凭据内容');
    await previewDialog.getByRole('button', {name: '确认导入', exact: true}).click();
    const importConfirm = page.locator('.el-message-box:visible');
    await importConfirm.waitFor({state: 'visible', timeout});
    await importConfirm.getByRole('button', {name: '导入', exact: true}).click();
    await previewDialog.waitFor({state: 'hidden', timeout});

    await page.locator('button[data-section="settings-general"]').click();
    await page.waitForFunction(
      ({selector, expected}) => document.querySelector(selector)
        ?.closest('.el-select__wrapper')
        ?.querySelector('.el-select__placeholder')
        ?.textContent?.trim() === expected,
      {selector: 'input[aria-label="默认目标语言"]', expected: importedConfig.to === 'en' ? '英语' : '日语'},
      {timeout},
    );
    await page.locator('button[data-section="settings-data"]').click();

    report.encryptedConfigurationStorage = await inspectEncryptedConfigurationStorage(page, sentinels);
    report.assertions.indexedDbEncryptedAtRest = true;
    report.assertions.legacyConfigStorageCleared = true;

    await page.reload({waitUntil: 'domcontentloaded', timeout});
    await page.locator('.settings-app').waitFor({state: 'visible', timeout});
    await page.locator('button[data-section="settings-data"]').click();
    await page.getByRole('button', {name: '导出配置', exact: true}).click();
    await transferDialog.waitFor({state: 'visible', timeout});
    const reloadedExportText = await transferDialog.getByLabel('配置 JSON').inputValue();
    const reloadedExportConfig = JSON.parse(reloadedExportText);
    assertExportContainsAllUserConfiguration(reloadedExportConfig);
    assertImportedSentinels(reloadedExportConfig, sentinels);
    if (reloadedExportConfig.to !== importedConfig.to) throw new Error('页面重载后目标语言没有从加密 IndexedDB 恢复');
    report.reloadedExport = {
      targetLanguage: reloadedExportConfig.to,
      credentialFields: [
        'token', 'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
        'tencentSecretId', 'tencentSecretKey', 'extra',
      ],
      roleFields: ['user_role', 'system_role'],
      plaintextRoundTrip: true,
    };
    await transferDialog.getByRole('button', {name: '取消', exact: true}).click();
    await transferDialog.waitFor({state: 'hidden', timeout});
    report.assertions.encryptedConfigReloadRoundTrip = true;
    report.assertions.twoBackupStreams = true;
    report.assertions.previewBeforeRestore = true;
    report.assertions.restoreWithConfirmation = true;
    report.assertions.onlyTwoTransferActions = true;
    report.assertions.exportDialog = true;
    report.assertions.exportIncludesUserConfiguration = true;
    report.assertions.exportClipboard = true;
    report.assertions.importPreview = true;

    for (const viewport of [
      {width: 1366, height: 700},
      {width: 1024, height: 900},
      {width: 820, height: 900},
      {width: 390, height: 844},
    ]) {
      await page.setViewportSize(viewport);
      await page.locator('button[data-section="settings-general"]').click();
      await page.waitForTimeout(150);
      const serviceCardLayout = await defaultServiceCard.evaluate(card => {
        const item = card.closest('.settings-item');
        const cardRect = card.getBoundingClientRect();
        const itemRect = item?.getBoundingClientRect();
        const copyRect = item?.querySelector('.settings-item-copy')?.getBoundingClientRect();
        return {
          withinViewport: Boolean(itemRect && itemRect.left >= -1 && itemRect.right <= window.innerWidth + 1),
          stacked: Boolean(copyRect && cardRect.top >= copyRect.bottom - 1),
          controlWidth: cardRect.width,
        };
      });
      if (!serviceCardLayout.withinViewport) throw new Error(`${viewport.width}px 默认服务卡超出视口`);
      if (viewport.width <= 480 && !serviceCardLayout.stacked) throw new Error(`${viewport.width}px 默认服务设置行没有纵向排列`);
      const generalMetrics = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        sectionWithinViewport: [...document.querySelectorAll('.settings-section')]
          .filter(section => getComputedStyle(section).display !== 'none')
          .every(section => {
            const rect = section.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= window.innerWidth + 1;
          }),
        activeNavigationVisible: (() => {
          const active = document.querySelector('nav[aria-label="设置分类"] button[aria-current="page"]');
          if (!active) return false;
          const rect = active.getBoundingClientRect();
          return rect.left >= -1
            && rect.right <= window.innerWidth + 1
            && rect.top >= -1
            && rect.bottom <= window.innerHeight + 1;
        })(),
      }));
      if (generalMetrics.horizontalOverflow
        || !generalMetrics.sectionWithinViewport
        || !generalMetrics.activeNavigationVisible) {
        throw new Error(`${viewport.width}px 通用设置响应式异常：${JSON.stringify(generalMetrics)}`);
      }
      const generalFile = `settings-general-${viewport.width}.png`;
      report.screenshots.push(await screenshot(page, generalFile));
      report.defaultServiceCard.responsive.push({...viewport, ...serviceCardLayout});
      report.responsive.push({page: 'settings-general', ...viewport, ...generalMetrics});

      await page.locator('button[data-section="settings-translation"]').click();
      await page.waitForTimeout(150);
      const translationMetrics = await page.evaluate(expectedGroups => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        groupOrder: [...document.querySelectorAll('.settings-section')]
          .filter(section => getComputedStyle(section).display !== 'none')
          .flatMap(section => [...section.querySelectorAll('.settings-group-heading h2')])
          .map(heading => heading.textContent?.trim()),
        groupsWithinViewport: [...document.querySelectorAll('.settings-section')]
          .filter(section => getComputedStyle(section).display !== 'none')
          .flatMap(section => [...section.querySelectorAll('.settings-group')])
          .every(group => {
            const rect = group.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= window.innerWidth + 1;
          }),
        expectedOrder: JSON.stringify(expectedGroups),
        activeNavigationVisible: (() => {
          const active = document.querySelector('nav[aria-label="设置分类"] button[aria-current="page"]');
          if (!active) return false;
          const rect = active.getBoundingClientRect();
          return rect.left >= -1
            && rect.right <= window.innerWidth + 1
            && rect.top >= -1
            && rect.bottom <= window.innerHeight + 1;
        })(),
      }), expectedTranslationGroups);
      if (translationMetrics.horizontalOverflow
        || !translationMetrics.groupsWithinViewport
        || !translationMetrics.activeNavigationVisible
        || JSON.stringify(translationMetrics.groupOrder) !== translationMetrics.expectedOrder) {
        throw new Error(`${viewport.width}px 翻译设置响应式异常：${JSON.stringify(translationMetrics)}`);
      }
      const translationFile = `settings-translation-${viewport.width}.png`;
      report.screenshots.push(await screenshot(page, translationFile));
      report.responsive.push({page: 'settings-translation', ...viewport, ...translationMetrics});

      await page.locator('button[data-section="settings-model-usage"]').click();
      await page.waitForTimeout(150);
      const usageMetrics = await page.evaluate(() => {
        const dashboard = document.querySelector('#settings-model-usage');
        const toolbar = dashboard?.querySelector('.usage-toolbar');
        const trend = dashboard?.querySelector('.usage-trend-plot');
        const dashboardRect = dashboard?.getBoundingClientRect();
        const toolbarRect = toolbar?.getBoundingClientRect();
        return {
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          dashboardWithinViewport: Boolean(dashboardRect
            && dashboardRect.left >= -1
            && dashboardRect.right <= window.innerWidth + 1),
          toolbarWithinDashboard: Boolean(dashboardRect && toolbarRect
            && toolbarRect.left >= dashboardRect.left - 1
            && toolbarRect.right <= dashboardRect.right + 1),
          trendOverflow: trend ? trend.scrollWidth > trend.clientWidth + 1 : false,
          providerFilterVisible: Boolean(dashboard?.querySelector('[aria-label="模型用量服务"]')?.getClientRects().length),
          modelFilterVisible: Boolean(dashboard?.querySelector('[aria-label="模型用量模型"]')?.getClientRects().length),
        };
      });
      if (usageMetrics.horizontalOverflow
        || !usageMetrics.dashboardWithinViewport
        || !usageMetrics.toolbarWithinDashboard
        || usageMetrics.trendOverflow
        || !usageMetrics.providerFilterVisible
        || !usageMetrics.modelFilterVisible) {
        throw new Error(`${viewport.width}px 模型用量响应式异常：${JSON.stringify(usageMetrics)}`);
      }
      const usageFile = `settings-model-usage-${viewport.width}.png`;
      report.screenshots.push(await screenshot(page, usageFile));
      report.responsive.push({page: 'settings-model-usage', ...viewport, ...usageMetrics});
    }
    await page.getByRole('button', {name: '清除统计', exact: true}).click();
    const finalResetDialog = page.getByRole('alertdialog', {name: '清除本机模型用量？'});
    await finalResetDialog.waitFor({state: 'visible', timeout});
    report.screenshots.push(await screenshot(page, 'settings-model-usage-reset-confirmation.png'));
    await finalResetDialog.getByRole('button', {name: '确认清除统计', exact: true}).click();
    await finalResetDialog.waitFor({state: 'hidden', timeout});
    await page.getByText('还没有模型调用记录', {exact: true}).waitFor({state: 'visible', timeout});
    const remainingUsageEvents = await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('FluentReadModelUsage');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = database.transaction('events', 'readonly').objectStore('events').count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    if (remainingUsageEvents !== 0) throw new Error(`确认清除后仍有 ${remainingUsageEvents} 条模型用量事件`);
    report.modelUsage.resetConfirmed = true;
    report.modelUsage.remainingEvents = remainingUsageEvents;
    report.assertions.modelUsageReset = true;
    report.screenshots.push(await screenshot(page, 'settings-model-usage-empty-after-reset.png'));
    report.assertions.responsive = true;
    if (errors.length) throw new Error(`浏览器控制台存在错误：${errors.join(' | ')}`);
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
