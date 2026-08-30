import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const FOCUS_SAFE_SCRIPTS = [
    'scripts/run-selection-trigger-test.cjs',
    'scripts/run-full-page-translation-test.cjs',
    'scripts/run-video-subtitle-fixture-test.cjs',
    'scripts/run-document-translation-test.cjs',
    'scripts/testing/run-settings-center-ui-test.cjs',
    'scripts/run-privacy-boundary-test.cjs',
    'scripts/run-site-translation-test.cjs',
    'scripts/run-userscript-smoke-test.cjs',
    'scripts/run-video-subtitle-test.cjs',
    'scripts/run-video-performance-test.cjs',
];

const ACTIVATED_EXTENSION_TAB_SCRIPTS = FOCUS_SAFE_SCRIPTS.filter(
    (path) => ![
        'scripts/run-document-translation-test.cjs',
        'scripts/testing/run-settings-center-ui-test.cjs',
        'scripts/run-userscript-smoke-test.cjs',
    ].includes(path),
);

const RUNNER_CLI_CASES = [
    {
        path: 'scripts/run-userscript-smoke-test.cjs',
        requiredArgs: [
            '--artifact', '.output/userscript/fluent-read.user.js',
            '--playwright-root', '/tmp/playwright-runtime',
            '--artifacts-dir', '/tmp/userscript-artifacts',
        ],
    },
    {
        path: 'scripts/run-video-subtitle-test.cjs',
        requiredArgs: ['--playwright-root', '/tmp/playwright-runtime'],
    },
    {
        path: 'scripts/run-video-performance-test.cjs',
        requiredArgs: ['--playwright-root', '/tmp/playwright-runtime'],
    },
];

function readScript(path: string): string {
    return readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
}

describe('browser regression focus safety', () => {
    it('全文回归内建 fixture handler 只提供预期页面并禁用缓存', () => {
        const {
            assertDeterministicFixtureTraffic,
            assertNoRuntimeErrors,
            buildFixtureMicrosoftResponseBody,
            createFixtureRequestHandler,
            parseArgs,
        } = require(resolve(PROJECT_ROOT, 'scripts/run-full-page-translation-test.cjs'));
        const handler = createFixtureRequestHandler(Buffer.from('fixture html'));
        const okResponse = {writeHead: vi.fn(), end: vi.fn()};
        const missingResponse = {writeHead: vi.fn(), end: vi.fn()};

        handler({url: '/unified-translation-fixture.html'}, okResponse);
        expect(okResponse.writeHead).toHaveBeenCalledWith(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
        });
        expect(okResponse.end).toHaveBeenCalledWith(Buffer.from('fixture html'));

        handler({url: '/unexpected'}, missingResponse);
        expect(missingResponse.writeHead).toHaveBeenCalledWith(404, {
            'content-type': 'text/plain; charset=utf-8',
        });
        expect(missingResponse.end).toHaveBeenCalledWith('Not found');

        expect(JSON.parse(buildFixtureMicrosoftResponseBody(['one', '<b>two</b>']))).toEqual([
            {translations: [{text: '测试译文：one'}]},
            {translations: [{text: '测试译文：<b>two</b>'}]},
        ]);
        expect(JSON.parse(buildFixtureMicrosoftResponseBody({text: 'invalid'}))).toEqual([]);
        expect(() => assertNoRuntimeErrors([])).not.toThrow();
        expect(() => assertNoRuntimeErrors(['pageerror: fixture failed'])).toThrow(
            '全文翻译浏览器回归出现运行时错误：["pageerror: fixture failed"]',
        );
        expect(() => assertDeterministicFixtureTraffic(12, [])).not.toThrow();
        expect(() => assertDeterministicFixtureTraffic(0, [])).toThrow('未命中确定性微软翻译路由');
        expect(() => assertDeterministicFixtureTraffic(12, ['https://translate.googleapis.com/translate_a/single']))
            .toThrow('尝试访问未授权网络');

        const requiredArgs = [
            '--extension-dir', '.output/chrome-mv3',
            '--playwright-root', '/tmp/playwright-runtime',
            '--focus-safe-helper', '/tmp/focus-safe-browser.cjs',
        ];
        expect(parseArgs(requiredArgs).service).toBe('freeTranslation');
        expect(() => parseArgs([...requiredArgs, '--service', 'google'])).toThrow('只允许 freeTranslation');
        expect(() => parseArgs([...requiredArgs, '--configure-service', 'google'])).toThrow('只允许 freeTranslation');
        expect(() => parseArgs([...requiredArgs, '--url', 'https://example.com/fixture'])).toThrow(
            '只允许 loopback URL',
        );
        for (const script of [
            'scripts/run-selection-trigger-test.cjs',
            'scripts/run-full-page-translation-test.cjs',
            'scripts/run-video-subtitle-fixture-test.cjs',
        ]) {
            expect(readScript(script)).toContain("'report.json'");
        }
        const selectionSource = readScript('scripts/run-selection-trigger-test.cjs');
        expect(selectionSource).toContain('if (!result.ok) throw new Error');
        expect(selectionSource).toContain('/options.html#settings-translation');
        expect(selectionSource).not.toContain('/options.html#settings-shortcuts');
        const videoSource = readScript('scripts/run-video-subtitle-fixture-test.cjs');
        expect(videoSource).toContain("const navigationMode = 'offline-youtube-fixture'");
        expect(videoSource).not.toContain('live-youtube');
        expect(videoSource).toContain("await context.route('**/*'");
        expect(videoSource).toContain('unexpectedNetworkRequests.length === 0');
        expect(videoSource).toContain('if (!evidence.ok)');
        const privacySource = readScript('scripts/run-privacy-boundary-test.cjs');
        expect(privacySource).toContain('configurePrivacySurfaces(optionsPage');
        expect(privacySource).toContain("type: 'persistConfig'");
        expect(privacySource).toContain('baseRevision');
        expect(privacySource).not.toContain('configurePrivacySurfaces(worker');
        expect(privacySource).not.toContain('chrome.storage.local.set({ config: next })');
    });

    it('userscript 后台 smoke 不复用 helper 可能关闭的启动页', async () => {
        const {selectUserscriptTestPage} = require(resolve(
            PROJECT_ROOT,
            'scripts/run-userscript-smoke-test.cjs',
        ));
        const startupPage = {id: 'startup'};
        const isolatedPage = {id: 'isolated'};
        const context = {pages: vi.fn(() => [startupPage])};
        const createIsolatedPage = vi.fn(async () => isolatedPage);

        await expect(selectUserscriptTestPage(true, context, createIsolatedPage)).resolves.toBe(isolatedPage);
        expect(context.pages).not.toHaveBeenCalled();
        expect(createIsolatedPage).toHaveBeenCalledOnce();

        createIsolatedPage.mockClear();
        await expect(selectUserscriptTestPage(false, context, createIsolatedPage)).resolves.toBe(startupPage);
        expect(context.pages).toHaveBeenCalledOnce();
        expect(createIsolatedPage).not.toHaveBeenCalled();
    });

    it.each(FOCUS_SAFE_SCRIPTS)('%s 的后台路径强制使用焦点安全 helper', (path) => {
        const source = readScript(path);

        expect(source).toContain('focus-safe-helper');
        expect(source).toContain('launchFocusSafePersistentContext');
        expect(source).toContain('newPageWithoutForeground');
    });

    it.each(ACTIVATED_EXTENSION_TAB_SCRIPTS)('%s 激活扩展页时不抢前台焦点', (path) => {
        const source = readScript(path);

        expect(source).toContain('activateExtensionTabWithoutForeground');
    });

    it.each(FOCUS_SAFE_SCRIPTS)('%s 不再使用最小化窗口或 bringToFront 伪装后台安全', (path) => {
        const source = readScript(path);

        expect(source).not.toContain('--start-minimized');
        expect(source).not.toContain('--window-position=-10000');
        expect(source).not.toContain('.bringToFront(');
        expect(source).not.toContain('playwright-minimized-fallback');
        expect(source).not.toContain('best-effort-minimized');
    });

    it.each(FOCUS_SAFE_SCRIPTS)('%s 输出可审计的启动与焦点策略', (path) => {
        const source = readScript(path);

        expect(source).toContain('launchMode');
        expect(source).toContain('focusPolicy');
        expect(source).toContain('windowPlacement');
    });

    it.each(RUNNER_CLI_CASES)('$path 默认后台模式缺少 helper 时失败即停', ({path, requiredArgs}) => {
        const {parseArgs} = require(resolve(PROJECT_ROOT, path));

        expect(() => parseArgs(requiredArgs, {})).toThrow(/--focus-safe-helper|FLUENTREAD_FOCUS_SAFE_HELPER/);
    });

    it.each(RUNNER_CLI_CASES)('$path 接受显式 helper 或环境变量，且 headed 不伪装后台', ({path, requiredArgs}) => {
        const {parseArgs} = require(resolve(PROJECT_ROOT, path));
        const explicit = parseArgs([...requiredArgs, '--focus-safe-helper', '/tmp/focus-safe-browser.cjs'], {});
        const fromEnv = parseArgs(requiredArgs, {FLUENTREAD_FOCUS_SAFE_HELPER: '/tmp/focus-safe-browser.cjs'});
        const headed = parseArgs([...requiredArgs, '--headed'], {});

        expect(explicit.background).toBe(true);
        expect(explicit.focusSafeHelper).toBe('/tmp/focus-safe-browser.cjs');
        expect(fromEnv.background).toBe(true);
        expect(fromEnv.focusSafeHelper).toBe('/tmp/focus-safe-browser.cjs');
        expect(headed.background).toBe(false);
        expect(headed.focusSafeHelper).toBe('');
    });

    it('站点矩阵把后台 helper、独立证据目录和网络授权传给每个子进程', () => {
        const source = readScript('scripts/run-site-translation-matrix.cjs');

        expect(source).toContain('--focus-safe-helper');
        expect(source).toContain('--artifacts-dir');
        expect(source).toContain('--allow-network');
        expect(source).toContain('--background');
        expect(source).not.toContain('--start-minimized');
        expect(source).not.toContain('.bringToFront(');
    });
});
