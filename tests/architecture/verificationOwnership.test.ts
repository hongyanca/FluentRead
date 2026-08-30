import {readdirSync, readFileSync, statSync} from 'node:fs';
import {relative, resolve, sep} from 'node:path';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '../..');
const AUDITED_EXTENSIONS = /\.(?:cjs|css|html|js|mjs|ts|vue)$/u;
const PRODUCT_ROOTS = [
    'docs/.vitepress',
    'entrypoints',
    'examples',
    'scripts',
    'src',
    'styles',
    'userscript',
] as const;
const ROOT_FILES = [
    'vitest.config.ts',
    'vitest.coverage.config.ts',
    'wxt.config.ts',
] as const;

type VerificationOwner =
    | 'chrome-firefox-build'
    | 'config-storage-functional'
    | 'document-browser-functional'
    | 'docs-build'
    | 'full-page-state-functional'
    | 'isolated-browser-regression'
    | 'strict-v8-coverage'
    | 'test-infrastructure-contract'
    | 'userscript-build';

interface OwnedFile {
    path: string;
    owners: VerificationOwner[];
}

function projectPath(...parts: string[]): string {
    return resolve(PROJECT_ROOT, ...parts);
}

function relativePath(path: string): string {
    return relative(PROJECT_ROOT, path).split(sep).join('/');
}

function listFiles(directory: string): string[] {
    const root = projectPath(directory);
    const files: string[] = [];

    const visit = (current: string) => {
        for (const entry of readdirSync(current)) {
            const absolute = resolve(current, entry);
            if (statSync(absolute).isDirectory()) {
                visit(absolute);
            } else if (AUDITED_EXTENSIONS.test(entry) && !entry.endsWith('.d.ts')) {
                files.push(relativePath(absolute));
            }
        }
    };

    visit(root);
    return files;
}

function coverageSourcePaths(): Set<string> {
    const source = readFileSync(projectPath('vitest.coverage.config.ts'), 'utf8');
    const paths = source.match(/['"]src\/[^'"]+\.ts['"]/gu) ?? [];
    return new Set(paths.map((path) => path.slice(1, -1)));
}

function verificationOwners(path: string, strictCoverage: Set<string>): VerificationOwner[] {
    const owners = new Set<VerificationOwner>();

    // 步骤 1：迁移到 src 的业务模块优先由严格 V8 门禁验证行为。
    if (strictCoverage.has(path)) owners.add('strict-v8-coverage');

    // 步骤 2：WXT 入口、Vue 页面和共享样式必须同时经过 Chrome 与 Firefox 构建。
    if (path.startsWith('components/')
        || path.startsWith('entrypoints/')
        || path.startsWith('src/')
        || path.startsWith('styles/')
        || path === 'wxt.config.ts') {
        owners.add('chrome-firefox-build');
    }

    // 步骤 3：各自独立的发布出口和测试基础设施由对应流水线负责。
    if (path.startsWith('userscript/')) owners.add('userscript-build');
    if (path === 'src/services/config/store.ts') owners.add('config-storage-functional');
    if (path === 'src/features/document-translation/ui/pdfPreview.ts') owners.add('document-browser-functional');
    if (path === 'src/features/full-page-translation/content/state.ts') owners.add('full-page-state-functional');
    if (path.startsWith('docs/.vitepress/')) owners.add('docs-build');
    if (path.startsWith('examples/')) owners.add('isolated-browser-regression');
    if (path.startsWith('scripts/run-') || path.startsWith('scripts/site-translation/')) {
        owners.add('isolated-browser-regression');
    }
    if (path.startsWith('scripts/testing/')
        || path === 'scripts/verify-userscript-build.mjs'
        || path.startsWith('vitest.')) {
        owners.add('test-infrastructure-contract');
    }

    return [...owners].sort();
}

function isTypeOnlyModule(path: string): boolean {
    return path.endsWith('/types.ts') || path.endsWith('.d.ts');
}

function isPureBarrel(path: string): boolean {
    if (!path.endsWith('.ts')) return false;
    const source = readFileSync(projectPath(path), 'utf8');
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return sourceFile.statements.length > 0
        && sourceFile.statements.every((statement) => ts.isExportDeclaration(statement));
}

function isCoverageExemptSrcModule(path: string): boolean {
    return isTypeOnlyModule(path)
        || isPureBarrel(path)
        || BUILD_ONLY_SRC_ALLOWLIST.has(path);
}

const BUILD_ONLY_SRC_ALLOWLIST = new Set([
    // WXT ShadowRootUi/Vue 挂载适配器绑定真实 DOM 与组件生命周期；由 shadowUi 单测和双浏览器构建验证。
    'src/platform/shadow-ui/vue.ts',
    // 配置存储运行时只识别 MV3/MV2 背景身份并装配 WXT、IndexedDB 或 runtime 端口；行为由纯端口测试和双浏览器构建验证。
    'src/platform/storage/configStorageRuntime.ts',
    // 页内通知绑定 Shadow DOM、定时器和 runtime 消息；由 pageNotice 功能测试和双浏览器构建验证。
    'src/features/page-notice/content/notice.ts',
    // 悬浮球组装 Vue、WXT、配置持久化与全文翻译；生命周期由 contentUiRuntime 测试覆盖。
    'src/features/floating-ball/content/runtime.ts',
    // 进度面板绑定 Vue Shadow UI；纯进度状态机已另行进入 strict coverage。
    'src/features/full-page-translation/content/progressPanel.ts',
    // 翻译节点标记绑定页面 DOM 与通知 UI；交互由 indicators 功能测试验证，纯错误分类进入 strict coverage。
    'src/features/full-page-translation/ui/translationIndicators.ts',
    // options composition root 只注册 Element Plus 组件、图标、全局样式并挂载 Vue；由组件契约与双浏览器构建验证。
    'src/app/options/index.ts',
    // popup composition root 只注册 Vue/Element Plus 并挂载页面；由 popup 契约测试、隔离 UI 回归和双浏览器构建验证。
    'src/app/popup/index.ts',
    // Offscreen composition root 只注入真实 Audio/Blob/Chrome runtime 与 OCR 能力；协议、翻译和播放状态机均已严格覆盖。
    'src/app/offscreen/runtime.ts',
    // background composition root 只串联菜单、静态消息 registry 和缓存维护；由 handler 单测、入口契约与双浏览器构建验证。
    'src/app/background/runtime.ts',
    // 右键菜单绑定 browser tabs/contextMenus 生命周期；纯标题策略与 tab 状态仓库已严格覆盖，真实交互由隔离浏览器回归验证。
    'src/app/background/contextMenuRuntime.ts',
    // 后台消息 composition 只把 provider、feature handler 与 browser API 静态注入；各 handler/路由均已严格覆盖。
    'src/app/background/messageRuntime.ts',
    // 配置存储 runtime 只把真实 browser/configStorage API 注入严格覆盖的广播策略和 OCR 仓库。
    'src/app/background/configStorageRuntime.ts',
    // 配置消息 composition 只将保存、计数、历史和备份 handler 接入同一 mutation 队列；各 handler 与队列均有功能测试。
    'src/app/background/configMessageHandlers.ts',
    // content composition root 绑定 WXT context、页面生命周期和静态 feature registry；由内容功能测试与隔离浏览器回归验证。
    'src/app/content/runtime.ts',
    // 页面快捷键 runtime 绑定真实可信 KeyboardEvent、Selection/Range 与 AbortSignal；纯匹配策略已严格覆盖，信任边界由回归测试验证。
    'src/app/content/hotkeyRuntime.ts',
    // 内容消息 runtime 绑定 browser.runtime 与动态 UI 挂载；payload 守卫和行为由内容消息功能测试、双浏览器构建验证。
    'src/app/content/messageRuntime.ts',
    // 这是 WXT/provider/config 的静态组装根；行为由被注入模块的单测和双浏览器构建验证。
    'src/app/translation/runtime.ts',
    // 内容侧客户端绑定 browser.runtime、页面上下文、AbortSignal 与持久化定时器；由 translateApi 功能测试和三种构建验证。
    'src/app/translation/client.ts',
    // 页面上下文运行时绑定 live DOM、脱离文档快照和 Defuddle 动态导入；纯预算与格式化策略已严格覆盖。
    'src/services/translation/context/browser.ts',
    // 文档组合根只把 config/store 与 app translation client 注入严格覆盖的编排服务；由文档功能回归和双浏览器构建验证。
    'src/app/document-translation/runtime.ts',
    // 文档 WXT 页面 composition 只挂载 Vue/Element Plus 与页面样式；由文档组件回归和双浏览器构建验证。
    'src/app/document-translation/page.ts',
    // 该模块绑定后台 IndexedDB 端口、会话/持久凭据迁移与页面生命周期；纯 schema/历史算法严格覆盖，集成行为由 config.test 验证。
    'src/services/config/store.ts',
    // 自动备份 store 绑定加密配置仓库 watch 与配置保存队列；纯状态机严格覆盖，集成读写和恢复由 configAutoBackupStore.test 验证。
    'src/services/config/autoBackupStore.ts',
    // 后台维护组合根只把 browser alarms/storage 注入严格覆盖的自动备份 runtime，并复用缓存维护任务。
    'src/app/background/maintenanceRuntime.ts',
    // WeakRef、MutationObserver、DOM lease 与 GC 时序属于浏览器生命周期状态机；由 translationState 功能测试和隔离浏览器回归验证。
    'src/features/full-page-translation/content/state.ts',
    // 全文翻译内容脚本 runtime 绑定页面 DOM、MutationObserver 与 WXT 翻译 glue；纯状态/布局/渲染已单独纳入 strict coverage。
    'src/features/full-page-translation/content/runtime.ts',
    // 视频字幕内容脚本 runtime 绑定 YouTube 播放器 DOM、浏览器消息与字幕下载流程；YouTube 数据逻辑已单独纳入 strict coverage。
    'src/features/video-subtitle/content/runtime.ts',
    // MAIN world adapter 只把 window Fetch/XHR 注入严格覆盖的 timedtext bridge core。
    'src/features/video-subtitle/content/youtubeTimedTextBridge.ts',
    // PDF Canvas 预览绑定 PDF.js worker、真实 Canvas 像素采样与对象 URL；由隔离文档浏览器回归和双浏览器构建验证。
    'src/features/document-translation/ui/pdfPreview.ts',
    // 图片悬停 runtime 绑定页面 Image/Canvas/Shadow DOM；协议、OCR、修复与远程图片规则由 strict coverage 验证。
    'src/features/image-translation/content/runtime.ts',
    // Tesseract worker、Canvas 测量/绘制与 Chrome runtime 消息属于 offscreen 浏览器 glue；纯 OCR、修复和颜色采样规则已纳入 strict coverage。
    'src/features/image-translation/services/ocrRuntime.ts',
    'src/features/image-translation/services/offscreenRuntime.ts',
    // MAIN world adapter 只把 Element/History/Navigation 注入严格覆盖的 ShadowRoute bridge core。
    'src/platform/shadow-ui/pageBridge.ts',
    // Edge TTS 运行时绑定 Web Crypto、第三方网络协议与 AbortSignal；纯音色、SSML、分段和 token 时效策略已严格覆盖。
    'src/features/selection-translation/services/edgeTts.ts',
    // Provider 注册表与 AI SDK transport 是依赖注入/网络协议组装；由注册表契约、功能测试和双浏览器构建共同验证。
    'src/providers/translation/registry.ts',
    'src/providers/translation/ai-sdk/openai-compatible.ts',
    // 以下文件逐一绑定真实网络协议或浏览器 offscreen API；纯端点、错误和鉴权逻辑已拆出并纳入 strict coverage。
    'src/providers/translation/azure-openai.ts',
    'src/providers/translation/chrome-translator.ts',
    'src/providers/translation/claude.ts',
    'src/providers/translation/deepl.ts',
    'src/providers/translation/deeplx.ts',
    'src/providers/translation/deepseek.ts',
    'src/providers/translation/gemini.ts',
    'src/providers/translation/google.ts',
    'src/providers/translation/hunyuan-translation.ts',
    'src/providers/translation/microsoft.ts',
    'src/providers/translation/tencent.ts',
    'src/providers/translation/tongyi.ts',
    'src/providers/translation/xiaoniu.ts',
    'src/providers/translation/youdao.ts',
    'src/providers/translation/zhipu.ts',
]);

describe('repository verification ownership', () => {
    const strictCoverage = coverageSourcePaths();
    const auditedFiles = [
        ...PRODUCT_ROOTS.flatMap(listFiles),
        ...ROOT_FILES,
    ].sort();
    const ownership: OwnedFile[] = auditedFiles.map((path) => ({
        path,
        owners: verificationOwners(path, strictCoverage),
    }));

    it('每个产品、构建和测试基础设施文件都有明确验证归属', () => {
        const unowned = ownership.filter(({owners}) => owners.length === 0);
        expect(unowned).toEqual([]);
    });

    it('src 中每个可执行非组装模块都进入四维 100% 覆盖率边界', () => {
        const uncovered = auditedFiles.filter((path) => path.startsWith('src/')
            && path.endsWith('.ts')
            && !isCoverageExemptSrcModule(path)
            && !strictCoverage.has(path));

        expect(uncovered).toEqual([]);
    });

    it('覆盖率清单不能引用不存在的源码或把组装根伪装成业务覆盖', () => {
        const audited = new Set(auditedFiles);
        const invalid = [...strictCoverage].filter((path) => !audited.has(path)
            || isCoverageExemptSrcModule(path));

        expect(invalid).toEqual([]);
    });

    it('验证归属覆盖所有审计文件且路径不重复', () => {
        const unique = new Set(ownership.map(({path}) => path));
        expect(unique.size).toBe(auditedFiles.length);
        expect(ownership.length).toBeGreaterThan(150);
    });
});
