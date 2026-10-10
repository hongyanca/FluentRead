import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {parse, compileScript} from 'vue/compiler-sfc';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {hasDistinctTranslation} from '@/src/core/translation/result';
import * as areaCore from '@/src/features/area-translation/core';
import * as areaHotkey from '@/src/core/config/areaTranslation';
import {shouldStartAreaTranslationFromHotkey} from '@/src/features/area-translation/content/areaHotkey';

const Vue = createRequire(import.meta.url)('vue') as typeof import('vue');
let app: import('vue').App | undefined;
afterEach(() => {app?.unmount(); vi.unstubAllGlobals();});

function mountTranslator() {
  const {window, document} = parseHTML('<html><body><h1>Title</h1></body></html>');
  Object.defineProperty(document, 'visibilityState', {value: 'visible'});
  Object.assign(window, {innerWidth: 1000, innerHeight: 800, matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Node', window.Node); vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  let focused: unknown = document.body;
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused});
  const config: Record<string, unknown> = {
    on: true, selectionAreaEnabled: true, animations: true, from: 'auto', theme: 'light',
    selectionAreaHotkey: 'Shift+Z', customSelectionAreaHotkey: '',
  };
  const capture = vi.fn().mockResolvedValue('data:image/png,capture');
  const translate = vi.fn().mockResolvedValue({
    image: 'data:image/png,crop', sourceText: 'Source', translatedText: '译文',
    service: 'microsoft', serviceName: '微软翻译', model: '', mode: 'standard', lines: [], warnings: [],
  });
  const modules: Record<string, any> = {
    // AreaTranslator 自 fe2946df 起依赖译文比较；测试的模块表此前没有同步登记。
    '@/src/core/translation/result': {hasDistinctTranslation},
    vue: Vue, 'webextension-polyfill': {default: {runtime: {sendMessage: vi.fn()}}},
    '@/src/services/config/store': {config, subscribeConfig: () => () => undefined},
    '@/src/core/config/customOpenAI': {isCustomOpenAIProviderId: () => false},
    '@/src/ui/i18n': {useUiI18n: () => ({translateLegacy: (text: string) => text})},
    '@/src/features/area-translation/services/client': {captureVisibleAreaInExtension: capture, translateCapturedAreaInExtension: translate},
    '@/src/features/area-translation/core': areaCore,
    '@/src/core/config/areaTranslation': areaHotkey,
    '@/src/features/image-translation/public': {prepareImageOcrLanguages: vi.fn()},
    '@/src/ui/components/DownloadProgress.vue': {default: {}},
    '@/src/features/area-translation/content/contextMenuBridge': {setAreaContextMenuHandler: () => () => undefined},
  };
  const filename = resolve('src/features/area-translation/ui/AreaTranslator.vue');
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const script = compileScript(descriptor, {id: 'area-trigger'}).content;
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
  const focus = (element: unknown) => {focused = element;};
  const press = (overrides: Record<string, unknown> = {}) => {
    const target = overrides.target ?? focused ?? document.body;
    const event = {
      isTrusted: true, key: 'Z', code: 'KeyZ', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
      repeat: false, isComposing: false, target, composedPath: () => [target, document.body, document],
      preventDefault: vi.fn(), ...overrides,
    };
    // 快捷键由无 DOM 的内容入口判断，组件只接收已授权的启动请求。
    if (shouldStartAreaTranslationFromHotkey(event as unknown as KeyboardEvent,
      config as unknown as Parameters<typeof shouldStartAreaTranslationFromHotkey>[1], document as unknown as Document)) {
      event.preventDefault();
      (vm.$ as any).exposed.beginSelection();
    }
    return event;
  };
  return {state, config, document, focus, press, capture, translate};
}

describe('圈选翻译快捷键触发', () => {
  it('默认 Shift+Z 在正文按下时进入选区模式，Esc 退出', () => {
    const f = mountTranslator();
    const event = f.press();
    expect(f.state.phase).toBe('selecting');
    expect(event.preventDefault).toHaveBeenCalled();
    f.state.handleKeydown({isTrusted: true, key: 'Escape', preventDefault: vi.fn()});
    expect(f.state.phase).toBe('idle');
  });

  it('焦点停在播放器、带 tabindex 的容器或按钮上时仍然触发', () => {
    const f = mountTranslator();
    const focusable = f.document.createElement('div');
    focusable.setAttribute('tabindex', '-1');
    for (const element of [focusable, f.document.createElement('video'), f.document.createElement('button'), f.document.createElement('a')]) {
      f.state.clearResult();
      f.focus(element);
      f.press();
      expect(f.state.phase, element.tagName).toBe('selecting');
    }
  });

  it('正在输入文字时不抢按键，包括 contenteditable、ARIA 输入框和 ShadowRoot 内的输入', () => {
    const f = mountTranslator();
    const editable = f.document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const ariaInput = f.document.createElement('div');
    ariaInput.setAttribute('role', 'textbox');
    const openHost = f.document.createElement('div');
    const shadowInput = f.document.createElement('input');
    Object.defineProperty(openHost, 'shadowRoot', {value: {activeElement: shadowInput}});
    // 封闭 ShadowRoot 只把宿主暴露为 activeElement；宿主自身不可聚焦，按输入保守处理。
    const closedHost = f.document.createElement('div');
    const customElement = f.document.createElement('my-editor');
    for (const element of [
      f.document.createElement('input'), f.document.createElement('textarea'), f.document.createElement('select'),
      editable, ariaInput, openHost, closedHost, customElement,
    ]) {
      f.focus(element);
      f.press();
      expect(f.state.phase, element.tagName).toBe('idle');
    }
  });

  it('按自定义快捷键触发，原默认组合键不再接管按键', () => {
    const f = mountTranslator();
    f.config.selectionAreaHotkey = 'custom';
    f.config.customSelectionAreaHotkey = 'Alt+X';
    f.press();
    expect(f.state.phase).toBe('idle');
    f.press({key: 'x', code: 'KeyX', shiftKey: false, altKey: true});
    expect(f.state.phase).toBe('selecting');
    f.state.clearResult();
    f.config.selectionAreaHotkey = 'Shift+X';
    f.press({key: 'X', code: 'KeyX'});
    expect(f.state.phase).toBe('selecting');
  });

  it('合成事件、重复按键、输入法组合和功能关闭都不会进入选区模式', () => {
    const f = mountTranslator();
    for (const overrides of [{isTrusted: false}, {repeat: true}, {isComposing: true}, {key: 'a', code: 'KeyA'}]) {
      f.press(overrides);
      expect(f.state.phase).toBe('idle');
    }
    f.config.selectionAreaEnabled = false;
    f.press();
    expect(f.state.phase).toBe('idle');
    f.config.selectionAreaEnabled = true;
    f.config.on = false;
    f.press();
    expect(f.state.phase).toBe('idle');
  });

  it('页面自身的滚动不关闭刚打开的选区，只重置进行中的拖拽', () => {
    const f = mountTranslator();
    f.press();
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('selecting');
    const pointer = {isTrusted: true, button: 0, pointerId: 3, clientX: 20, clientY: 30, target: f.document.body, preventDefault: vi.fn(), stopPropagation: vi.fn()};
    f.state.handlePointerdown(pointer);
    f.state.handlePointermove({...pointer, clientX: 120, clientY: 130});
    expect(f.state.selectionRect).toEqual({left: 20, top: 30, width: 100, height: 100});
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('selecting');
    expect(f.state.selectionRect).toBeNull();
    // 起点已失效，继续移动不得恢复旧选区；重新按下即可开始新的拖拽。
    f.state.handlePointermove({...pointer, clientX: 200, clientY: 200});
    expect(f.state.selectionRect).toBeNull();
    f.state.handlePointerdown({...pointer, pointerId: 4, clientX: 10, clientY: 10});
    expect(f.state.selectionRect).toEqual({left: 10, top: 10, width: 0, height: 0});
  });

  it('截图完成后页面和卡片滚动保留结果，截图未完成时页面变化取消旧坐标', () => {
    const f = mountTranslator();
    f.state.activeRect = {left: 10, top: 20, width: 120, height: 90};
    f.state.phase = 'translated';
    const host = f.document.createElement('div');
    host.id = 'fluent-read-area-translator-container';
    f.document.body.append(host);
    const inside = f.document.createElement('div');
    host.append(inside);
    f.state.handleViewportChange({target: inside});
    expect(f.state.phase).toBe('translated');
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('translated');
    expect(f.state.activeRect).not.toBeNull();
    f.state.phase = 'loading';
    f.state.capturePending = true;
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('idle');
    expect(f.state.activeRect).toBeNull();
  });

  it('选区开始后缩小窗口，后续结果按新的视口宽度约束', () => {
    const f = mountTranslator();
    f.press();
    window.innerWidth = 390;
    window.innerHeight = 600;
    f.state.handleViewportChange({target: f.document.body});
    const style = f.state.panelStyle({left: 800, top: 700, width: 120, height: 90});
    expect(style.width).toBe('366px');
    expect(style.left).toBe('12px');
    expect(style.top).toBe('360px');
    expect(f.state.phase).toBe('selecting');
  });
});
