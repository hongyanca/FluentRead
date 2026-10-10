import {hasDistinctTranslation} from '@/src/core/translation/result';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {parse, compileScript} from 'vue/compiler-sfc';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as areaCore from '@/src/features/area-translation/core';
import * as areaHotkey from '@/src/core/config/areaTranslation';

const Vue = createRequire(import.meta.url)('vue') as typeof import('vue');
let app: import('vue').App | undefined;
afterEach(() => {app?.unmount(); vi.unstubAllGlobals();});
function deferred() {let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve};}

function mountRecovery() {
  const {window, document} = parseHTML('<html><body></body></html>');
  Object.defineProperty(document, 'visibilityState', {value: 'visible'});
  Object.assign(window, {innerWidth: 1000, innerHeight: 800, matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('Node', window.Node); vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const config = {on: true, selectionAreaEnabled: true, animations: true, from: 'auto', theme: 'light'};
  const captured = 'data:image/png,original-selection';
  const result = {image: 'data:image/png,crop', sourceText: 'Source', translatedText: '译文', service: 'microsoft', serviceName: '微软翻译', model: '', mode: 'standard', lines: [], warnings: []};
  const capture = vi.fn().mockResolvedValue(captured);
  const translate = vi.fn().mockRejectedValueOnce(new Error('图片文字识别需要先下载中文、English语言包，请前往设置下载')).mockResolvedValue(result);
  const prepare = vi.fn().mockResolvedValue(undefined);
  const modules: Record<string, any> = {
    '@/src/core/translation/result': {hasDistinctTranslation},
    vue: Vue, 'webextension-polyfill': {default: {runtime: {sendMessage: vi.fn()}}},
    '@/src/services/config/store': {config, subscribeConfig: () => () => undefined},
    '@/src/core/config/customOpenAI': {isCustomOpenAIProviderId: () => false},
    '@/src/ui/i18n': {useUiI18n: () => ({translateLegacy: (text: string) => text})},
    '@/src/features/area-translation/services/client': {captureVisibleAreaInExtension: capture, translateCapturedAreaInExtension: translate},
    '@/src/features/area-translation/core': areaCore,
    '@/src/core/config/areaTranslation': areaHotkey,
    '@/src/features/image-translation/public': {prepareImageOcrLanguages: prepare},
    '@/src/ui/components/DownloadProgress.vue': {default: {}},
    '@/src/features/area-translation/content/contextMenuBridge': {setAreaContextMenuHandler: () => () => undefined},
  };
  const filename = resolve('src/features/area-translation/ui/AreaTranslator.vue');
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const script = compileScript(descriptor, {id: 'area-recovery'}).content;
  const js = ts.transpileModule(script, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText
    .replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_all, binding, id) => binding.startsWith('{')
      ? `const ${binding.replace(/\s+as\s+/g, ': ')} = modules[${JSON.stringify(id)}];`
      : `const ${binding} = modules[${JSON.stringify(id)}].default;`)
    .replace('export default', 'return');
  const component = new Function('modules', js)(modules);
  component.render = () => null;
  const renderer = Vue.createRenderer<any, any>({patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null});
  app = renderer.createApp(component); app.config.warnHandler = () => undefined;
  const vm = app.mount({});
  const state = (vm.$ as any).setupState;
  const rect = {left: 10, top: 20, width: 120, height: 90};
  state.activeRect = rect; state.phase = 'loading';
  return {state, rect, config, captured, capture, translate, prepare, result};
}

describe('圈选缺少语言包的一键恢复', () => {
  it('缺包后只下载一次，使用原截图和原语言继续，无需重新圈选', async () => {
    const f = mountRecovery();
    await f.state.requestTranslation(f.rect);
    expect(f.state.needsLanguages).toBe(true); expect(f.state.phase).toBe('error');
    f.config.from = 'ja';
    f.state.downloadLanguagesAndRetry(); f.state.downloadLanguagesAndRetry();
    await vi.waitFor(() => expect(f.state.phase).toBe('translated'));
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.prepare).toHaveBeenCalledWith('auto', expect.any(AbortSignal), expect.any(Function));
    // 准备语言包期间，卡片显示后台回报的真实下载百分比。
    f.prepare.mock.calls[0][2](75);
    expect(f.state.languagePercent).toBe(75);
    expect(f.capture).toHaveBeenCalledOnce();
    expect(f.translate.mock.calls[1][0]).toBe(f.captured);
    expect(f.translate.mock.calls[1][2]).toBe('auto');
    expect(f.state.result.translatedText).toBe('译文');
  });
  it('下载失败保留恢复按钮，取消下载后迟到结果不触发翻译', async () => {
    const f = mountRecovery(); await f.state.requestTranslation(f.rect);
    f.prepare.mockRejectedValueOnce(new Error('network unavailable'));
    f.state.downloadLanguagesAndRetry();
    await vi.waitFor(() => expect(f.state.phase).toBe('error'));
    expect(f.state.needsLanguages).toBe(true);
    const pending = deferred(); f.prepare.mockReturnValueOnce(pending.promise);
    f.state.downloadLanguagesAndRetry();
    expect(f.state.preparingLanguages).toBe(true);
    f.state.clearResult(); pending.resolve(); await Vue.nextTick();
    expect(f.prepare.mock.calls.at(-1)![1].aborted).toBe(true);
    expect(f.translate).toHaveBeenCalledOnce(); expect(f.state.phase).toBe('idle');
  });
});


describe('圈选结果拖动', () => {
  it('标题栏拖动受视口边界约束，重试保留位置，关闭释放指针并重置位置', () => {
    const f = mountRecovery();
    const handle = document.createElement('header');
    const capture = vi.fn(); const release = vi.fn();
    Object.assign(handle, {setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release});
    f.state.panelElement = {getBoundingClientRect: () => ({left: 40, top: 60, width: 460})};
    const event = (extra = {}) => ({isTrusted: true, button: 0, pointerId: 7, clientX: 50, clientY: 70, target: handle, currentTarget: handle, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra});
    f.state.beginPanelDrag(event({target: document.createElement('button')}));
    f.state.beginPanelDrag(event({isTrusted: false}));
    expect(capture).not.toHaveBeenCalled();
    f.state.beginPanelDrag(event());
    expect(capture).toHaveBeenCalledWith(7);
    f.state.handlePointermove(event({pointerId: 8, clientX: 200}));
    expect(f.state.panelPosition).toBeNull();
    f.state.handlePointermove(event({clientX: 200, clientY: 220}));
    expect(f.state.panelPosition).toEqual({x: 190, y: 210});
    f.state.handlePointermove(event({clientX: 2000, clientY: 2000}));
    expect(f.state.panelPosition).toEqual({x: 528, y: 560});
    f.state.handlePointerup(event());
    expect(release).toHaveBeenCalledWith(7);
    f.state.phase = 'translated';
    expect(f.state.panelStyle(f.rect)).toMatchObject({left: '528px', top: '560px'});
    f.state.beginPanelDrag(event());
    f.state.clearResult();
    expect(release).toHaveBeenCalledTimes(2);
    expect(f.state.panelPosition).toBeNull();
    f.state.handlePointermove(event({clientX: 200}));
    expect(f.state.panelPosition).toBeNull();
  });
  it('取消或窗口失焦只停止拖动，不删除正在阅读的结果', () => {
    const f = mountRecovery();
    const handle = document.createElement('header');
    Object.assign(handle, {setPointerCapture() {}, hasPointerCapture: () => false});
    f.state.panelElement = {getBoundingClientRect: () => ({left: 40, top: 60, width: 460})};
    const e = {isTrusted: true, button: 0, pointerId: 2, clientX: 10, clientY: 10, target: handle, currentTarget: handle, preventDefault() {}, stopPropagation() {}};
    f.state.beginPanelDrag(e); f.state.handlePointercancel(e);
    expect(f.state.phase).toBe('loading');
    f.state.beginPanelDrag(e); f.state.handleWindowBlur();
    f.state.handlePointermove({...e, clientX: 100});
    expect(f.state.panelPosition).toBeNull(); expect(f.state.phase).toBe('loading');
  });
});
