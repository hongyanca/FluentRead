/** 实际客户端 ConfigManagement：只走父组件公开属性和挂载 DOM 事件。
 * 配置快照/订阅、后台消息和 Dialog 过渡是受控外部端口；两个恢复客户端及领域投影保持真实。
 * 不读取 setupState，不保存离页 DOM handler；焦点 fixture 只提供 DOM focus 与公开 auto-focus hook，
 * 可暂停真实组件的 nextTick 验证归属；Element Plus 原生焦点/路由仍由 settings-center runner 验证。
 */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {normalizeConfig} from '@/src/core/config/model';
import {appendConfigHistorySnapshot, restoreRestorableConfig, toRestorableConfig, type ConfigHistoryState} from '@/src/services/config/history';
import type {ConfigAutoBackupState} from '@/src/services/config/autoBackup';
import {createConfigHistoryHandler} from '@/src/app/background/handlers/configHistory';
import {createConfigAutoBackupRestoreHandler} from '@/src/app/background/handlers/configAutoBackup';

const dom = await vi.hoisted(async () => {
  const {parseHTML} = await import('linkedom');
  const {window, document} = parseHTML('<html><body></body></html>');
  // Linkedom 不维护 activeElement；只补 DOM 焦点端口，不在 fixture 中替组件选择恢复按钮。
  let focused: Element | null = null;
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused?.isConnected ? focused : document.body});
  Object.defineProperty(document, 'visibilityState', {configurable: true, writable: true, value: 'visible'});
  window.HTMLElement.prototype.focus = function () {
    if (!this.isConnected || this.hasAttribute('disabled') || document.activeElement === this) return;
    focused = this;this.dispatchEvent(new window.Event('focus'));
    this.dispatchEvent(new window.Event('focusin', {bubbles: true}));
  };
  window.HTMLElement.prototype.blur = function () {
    if (focused === this) {focused = null;this.dispatchEvent(new window.Event('focusout', {bubbles: true}));}
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  Object.defineProperty(window.Node.prototype, Symbol.toStringTag, {configurable: true, get() {return this.constructor.name;}});
  for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'ShadowRoot', 'Event', 'CustomEvent']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: (window as any)[key]});
  }
  return {window, document, originals};
});
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const root = process.cwd();
const ports = {
  history: {} as ConfigHistoryState, backups: {} as ConfigAutoBackupState,
  historyListeners: new Set<(value: ConfigHistoryState) => void>(), backupListeners: new Set<(value: ConfigAutoBackupState) => void>(),
  send: vi.fn(), messages: vi.fn(), globalConfirm: vi.fn(), globalClose: vi.fn(),
  delayClosed: false, closing: new Set<() => void>(),
  installedConfig: null as unknown,
  installedHistory: null as ConfigHistoryState | null,
  focusTick: null as {promise: Promise<void>;resolve: (value: void) => void} | null,
  defaultFocus: false,
};
let server: ViteDevServer | undefined, component: import('vue').Component;
const apps = new Set<import('vue').App>();
const legacyConfirmations = new Set<() => void>();
const clientModules = new Map<string, string>(), clientIds = new Map<string, string>();
async function settle() {for (let i = 0; i < 6; i++) {await Promise.resolve();await runtime.nextTick();}}
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};}

const Dialog = runtime.defineComponent({props: ['modelValue', 'title'], emits: ['close', 'closed', 'update:modelValue', 'openAutoFocus', 'closeAutoFocus'], setup(props, {attrs, slots, emit}) {
  const rendered = runtime.ref(Boolean(props.modelValue));let closing: (() => void) | undefined;
  const node = runtime.ref<HTMLElement | null>(null);let origin: Element | null = null, released = false;
  const openFocus = () => {origin = dom.document.activeElement;released = false;emit('openAutoFocus');node.value?.focus();};
  const releaseFocus = () => {
    if (released) return;released = true;
    // 公开 hook 无 Event 参数；EP 的标准默认归还发生在 hook 后同步执行。
    emit('closeAutoFocus');
    if (ports.defaultFocus && origin instanceof HTMLElement) origin.focus();
  };
  runtime.onMounted(() => {if (props.modelValue) void runtime.nextTick(openFocus);});
  runtime.onBeforeUnmount(() => {if (props.modelValue) releaseFocus();});
  runtime.watch(() => props.modelValue, visible => {
    if (closing) {ports.closing.delete(closing);closing = undefined;}
    if (visible) {rendered.value = true;void runtime.nextTick(openFocus);return;}
    releaseFocus();
    emit('close');
    const finish = () => {ports.closing.delete(finish);closing = undefined;rendered.value = false;emit('closed');emit('update:modelValue', false);};
    if (ports.delayClosed) {closing = finish;ports.closing.add(finish);} else finish();
  });
  runtime.onUnmounted(() => {if (closing) ports.closing.delete(closing);});
  return () => rendered.value ? runtime.h('div', {...attrs, ref: node, tabindex: -1, role: 'dialog', 'aria-label': props.title,
    'data-dialog-visible': String(Boolean(props.modelValue)), onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') {emit('close');emit('update:modelValue', false);}
    }}, [...slots.default?.() ?? [], ...slots.footer?.() ?? []]) : null;
}});
const Button = runtime.defineComponent({props: ['disabled', 'loading', 'type'], setup: (props, {attrs, slots}) => () => runtime.h('button', {...attrs,
  type: 'button', disabled: props.disabled || props.loading}, slots.default?.())});

beforeAll(async () => {
  vi.stubGlobal('__fluentreadRestorePorts', ports);
  for (const file of ['src/features/settings/ui/ConfigManagement.vue', 'src/features/settings/ui/components/SettingsPanel.vue']) {
    const filename = resolve(root, file), {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
    const script = compileScript(descriptor, {id: 'restore-client'});
    const clientId = `${filename}.restore-client.ts`;
    clientIds.set(filename, clientId);
    // Control only this compiled SFC's nextTick; external Vue resolution can bypass resolveId.
    let nextTickPortInstalled = false;
    const content = filename.endsWith('/ConfigManagement.vue')
      ? script.content.replace(/import \{([^}]+)\} from ['"]vue['"];?/gu, (declaration, imports: string) => {
        const names = imports.split(',').map(name => name.trim());
        if (!names.includes('nextTick')) return declaration;
        nextTickPortInstalled = true;
        return "import {" + names.filter(name => name !== 'nextTick').join(', ') + "} from 'vue';\nimport {nextTick} from 'restore-component-next-tick';";
      }) : script.content;
    if (filename.endsWith('/ConfigManagement.vue')) expect(nextTickPortInstalled).toBe(true);
    clientModules.set(clientId, content);
  }
  server = await createServer({root, configFile: false, appType: 'custom', logLevel: 'silent',
    resolve: {alias: {'@': root}}, server: {hmr: false, middlewareMode: true},
    ssr: {noExternal: ['webextension-polyfill', 'element-plus']},
    plugins: [{name: 'restore-controlled-ports', enforce: 'pre', resolveId(id, importer) {
      if (clientModules.has(id)) return id;
      const rootRelativeClient = id.startsWith('/') ? resolve(root, id.slice(1)) : '';
      if (clientModules.has(rootRelativeClient)) return rootRelativeClient;
      const path = id.startsWith('@/') ? resolve(root, id.slice(2)) : id.startsWith('.') && importer ? resolve(dirname(importer), id) : id;
      if (clientIds.has(path)) return clientIds.get(path);
      if (id === 'restore-component-next-tick') return '\0restore-component-next-tick';
      if (/\/src\/services\/config(?:\/index(?:\.ts)?)?$/u.test(path)) return '\0restore-config';
      if (/\/src\/platform\/storage\/configStorageRuntime(?:\.ts)?$/u.test(path)) return '\0restore-storage';
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(path)) return '\0restore-i18n';
      if (id === 'webextension-polyfill') return '\0restore-browser';
      if (id === 'element-plus') return '\0restore-messages';
      if (id.endsWith('.vue')) return '\0restore-sibling';
      return null;
    }, load(id) {
      if (clientModules.has(id)) return clientModules.get(id);
      if (id === '\0restore-component-next-tick') return `
        import {nextTick as runtimeNextTick} from 'vue';
        export const nextTick=()=>globalThis.__fluentreadRestorePorts.focusTick?.promise ?? runtimeNextTick();
      `;
      if (id === '\0restore-browser') return 'export default {runtime:{sendMessage:(...args)=>globalThis.__fluentreadRestorePorts.send(...args)}}';
      if (id === '\0restore-i18n') return "import {ref} from 'vue';export const useUiI18n=()=>({language:ref('zh-CN'),t:key=>key,translateLegacy:text=>text})";
      if (id === '\0restore-storage') return 'export const configStorage={writeOwner:false,getItem:async()=>null,setItem:async()=>undefined,removeItem:async()=>undefined,watch:()=>()=>{}}';
      if (id === '\0restore-messages') return `const p=globalThis.__fluentreadRestorePorts;export const ElMessage={success:(...args)=>p.messages('success',...args),error:(...args)=>p.messages('error',...args)};export const ElMessageBox={confirm:(...args)=>p.globalConfirm(...args),close:(...args)=>p.globalClose(...args)}`;
      if (id === '\0restore-sibling') return 'export default {render:()=>null}';
      if (id === '\0restore-config') return `
        export {requestConfigHistoryAction} from ${JSON.stringify(resolve(root, 'src/services/config/store.ts'))};
        export {requestConfigAutoBackupRestore} from ${JSON.stringify(resolve(root, 'src/services/config/autoBackupStore.ts'))};
        const p=globalThis.__fluentreadRestorePorts;
        export const configHistoryReady=Promise.resolve(),configAutoBackupsReady=Promise.resolve();
        export const getConfigHistorySnapshot=()=>structuredClone(p.history),getConfigAutoBackupsSnapshot=()=>structuredClone(p.backups);
        export const subscribeConfigHistory=fn=>{p.historyListeners.add(fn);return()=>p.historyListeners.delete(fn)};
        export const subscribeConfigAutoBackups=fn=>{p.backupListeners.add(fn);return()=>p.backupListeners.delete(fn)};
      `;
      return null;
    }}, vue()]});
  // 模块加载器只解析真实 setup 的导入；所有 render 都来自客户端缓存模板，非 ssrRender。
  for (const [filename, clientId] of clientIds) {
    const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
    const script = compileScript(descriptor, {id: 'restore-client'});
    const actual = (await server.ssrLoadModule(clientId)).default;
    const template = compileTemplate({source: descriptor.template!.content, filename, id: 'restore-client',
      compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: script.bindings, expressionPlugins: ['typescript']}});
    expect(template.errors).toEqual([]);
    actual.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime);
    if (filename.endsWith('/ConfigManagement.vue')) component = actual;
  }
});
beforeEach(() => {
  ports.send.mockReset();ports.messages.mockReset();ports.globalConfirm.mockReset();ports.globalClose.mockReset();
  ports.delayClosed = false;ports.installedConfig = null;ports.installedHistory = null;
  ports.focusTick = null;ports.defaultFocus = false;
  Object.defineProperty(dom.document, 'visibilityState', {configurable: true, writable: true, value: 'visible'});
  const snapshots = [{on: false}, {on: true, to: 'en'}, {on: true}].map(value => toRestorableConfig(normalizeConfig(value)));
  ports.history = {schemaVersion: 1, cursor: 2, nextVersion: 4, entries: snapshots.map((config, index) => ({version: index + 1, savedAt: '2026-10-07T00:00:00Z', config}))};
  ports.backups = {schemaVersion: 1, nextVersion: 3, entries: snapshots.slice(0, 2).map((config, index) => ({version: index + 1, savedAt: '2026-10-07T00:00:00Z', config}))};
  ports.globalConfirm.mockImplementation(() => new Promise(() => {}));
  ports.send.mockImplementation(async (message: {type: string}) => message.type === 'configHistoryAction'
    ? {success: true, history: structuredClone(ports.history)} : {success: true, result: {history: structuredClone(ports.history), backups: structuredClone(ports.backups)}});
});
afterEach(async () => {
  try {
    ports.focusTick?.resolve();ports.focusTick = null;await settle();
    for (const app of apps) app.unmount();apps.clear();
    for (const cancel of [...legacyConfirmations]) cancel();await settle();
  }
  finally {dom.document.body.replaceChildren();}
  expect(ports.historyListeners.size).toBe(0);expect(ports.backupListeners.size).toBe(0);expect(ports.closing.size).toBe(0);expect(legacyConfirmations.size).toBe(0);
});
afterAll(async () => {
  try {await server?.close();}
  finally {
    clientModules.clear();clientIds.clear();vi.unstubAllGlobals();
    for (const [key, descriptor] of dom.originals) {if (descriptor) Object.defineProperty(globalThis, key, descriptor);else Reflect.deleteProperty(globalThis, key);}
  }
});

async function mount() {
  const config = runtime.reactive(normalizeConfig({on: true, count: 73, apiKeys: {openai: ['current-fixture-key']}}));
  const initialConfig = normalizeConfig({...config});
  const props = runtime.shallowReactive({active: true, activePanel: 'history', config}), shown = runtime.ref(true);
  const host = dom.document.createElement('div');dom.document.body.append(host);
  let app: import('vue').App;
  const actions: Record<string, () => void> = {
    active: () => {props.active = false;}, panel: () => {props.activePanel = 'backup';},
    config: () => {props.config = runtime.reactive(normalizeConfig({...config}));},
    // 与 SettingsSections 的真实订阅/水合契约一致：保留顶层对象，覆盖字段。
    assign: () => {Object.assign(props.config, normalizeConfig({...props.config, to: 'fr'}));},
    deep: () => {props.config.alwaysTranslateDomains.push('changed.example');},
    nonrestorable: () => {props.config.count += 1;props.config.apiKeys.openai[0] = 'new-current-fixture-key';},
    install: () => {Object.assign(props.config, normalizeConfig(ports.installedConfig));},
    history: () => {if (ports.installedHistory) for (const listener of ports.historyListeners) listener(structuredClone(ports.installedHistory));},
    baseline: () => {Object.assign(props.config, normalizeConfig(initialConfig));},
    cached: () => {shown.value = false;}, unmount: () => {app.unmount();apps.delete(app);},
    back: () => {props.active = true;props.activePanel = 'history';shown.value = true;},
  };
  app = runtime.createApp({setup: () => () => runtime.h('main', [
    ...Object.entries(actions).map(([name, action]) => runtime.h('button', {'data-lifecycle': name, onClick: action}, name)),
    runtime.h(runtime.KeepAlive, null, {default: () => shown.value ? runtime.h(component, {...props, key: 'config'}) : runtime.h({render: () => null}, {key: 'elsewhere'})}),
  ])});
  app.component('el-dialog', Dialog);app.component('el-button', Button);apps.add(app);app.mount(host);await settle();
  return {host, config};
}
function button(host: Element, label: string) {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(value => value.textContent?.trim() === label);
  expect(result).toBeDefined();return result!;
}
function preview(host: Element) {const node = host.querySelector<HTMLElement>('.config-preview-dialog[data-dialog-visible="true"]');expect(node).not.toBeNull();return node!;}
function confirmation(host: Element) {const node = host.querySelector<HTMLElement>('.config-restore-confirm-dialog[data-dialog-visible="true"]');expect(node).not.toBeNull();return node!;}
async function navigate(host: Element, name: string) {const node = host.querySelector<HTMLButtonElement>(`button[data-lifecycle="${name}"]`);expect(node).not.toBeNull();node!.click();await settle();}
type Kind = 'history' | 'backup';
const kinds: Kind[] = ['history', 'backup'];
const boundaries = ['active', 'panel', 'config', 'assign', 'deep', 'cached', 'unmount', 'close', 'target'] as const;
type Boundary = typeof boundaries[number];
async function open(host: Element, kind: Kind, version = 1) {
  const label = `${kind === 'history' ? 'v' : 'b'}${version}`;
  const badge = Array.from(host.querySelectorAll<HTMLElement>('.version-badge')).find(node => node.textContent?.trim() === label);
  expect(badge).toBeDefined();(badge!.closest('button') as HTMLButtonElement).click();await settle();
  expect(preview(host).querySelector('.preview-summary')!.textContent).toContain(label);
}
async function begin(host: Element) {const restore = button(preview(host), '恢复此版本');expect(restore.disabled).toBe(false);restore.click();await settle();confirmation(host);}
async function confirm(host: Element) {button(confirmation(host), '恢复').click();await settle();}
function cancelWithDomEvent(host: Element, action: 'cancel' | 'escape') {
  button(confirmation(host), '取消').focus();
  if (action === 'cancel') button(confirmation(host), '取消').click();
  else {const event = new dom.window.Event('keydown', {bubbles: true});Object.defineProperty(event, 'key', {value: 'Escape'});confirmation(host).dispatchEvent(event);}
}
async function holdCancelledFocus(host: Element, action: 'cancel' | 'escape' = 'cancel') {
  const tick = deferred<void>();ports.focusTick = tick;cancelWithDomEvent(host, action);await settle();
  expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();
  expect(button(preview(host), '恢复此版本').disabled).toBe(false);
  expect(dom.document.activeElement).not.toBe(button(preview(host), '恢复此版本'));
  return tick;
}
async function releaseCancelledFocus(tick: {resolve: (value: void) => void}) {ports.focusTick = null;tick.resolve();await settle();}
async function invalidate(host: Element, kind: Kind, boundary: Boundary) {
  if (boundary === 'close' || boundary === 'target') {button(preview(host), '关闭').click();await settle();if (boundary === 'target') await open(host, kind, 2);}
  else await navigate(host, boundary);
}
async function reopen(host: Element, kind: Kind, boundary: Boundary) {await navigate(host, 'back');if (boundary !== 'target') await open(host, kind);}
function expectedMessage(kind: Kind, version = 1) {return kind === 'history' ? {type: 'configHistoryAction', action: 'restore', version} : {type: 'configAutoBackupRestore', version};}
function lateResult(kind: Kind, failure: boolean) {
  const history = {...ports.history, nextVersion: 100, entries: [...ports.history.entries, {...ports.history.entries[0], version: 99}]};
  const backups = {...ports.backups, nextVersion: 100, entries: [...ports.backups.entries, {...ports.backups.entries[0], version: 99}]};
  return failure ? {success: false, error: 'old fixture failure'} : kind === 'history' ? {success: true, history} : {success: true, result: {history, backups}};
}
function versionLabels(host: Element) {return Array.from(host.querySelectorAll('.version-badge')).map(node => node.textContent);}

// 新成功链也能在原 source 的真实 MessageBox 调用边界运行；外部确认由挂载按钮触发。
// 原 78 个 owned Dialog 归属用例仍保持原断言，不因兼容此基线端口而放宽。
function prepareLegacyPublicConfirmation() {
  ports.globalConfirm.mockImplementation((_message: string, title: string, options: {confirmButtonText: string;cancelButtonText: string}) => {
    const pending = deferred<void>(), node = dom.document.createElement('div');
    node.className = 'fixture-message-box';node.setAttribute('role', 'dialog');node.setAttribute('aria-label', title);
    const remove = () => {node.remove();legacyConfirmations.delete(cancel);};
    const cancel = () => {remove();pending.reject(new Error('fixture confirmation cancelled'));};
    const yes = dom.document.createElement('button');yes.textContent = options.confirmButtonText;
    yes.addEventListener('click', () => {remove();pending.resolve();});
    const no = dom.document.createElement('button');no.textContent = options.cancelButtonText;no.addEventListener('click', cancel);
    node.append(no, yes);dom.document.body.append(node);legacyConfirmations.add(cancel);return pending.promise;
  });
}
async function beginThroughPublicConfirmation(host: Element) {
  prepareLegacyPublicConfirmation();button(preview(host), '恢复此版本').click();await settle();
  const dialog = host.querySelector('.config-restore-confirm-dialog') || dom.document.querySelector('.fixture-message-box');
  expect(dialog).not.toBeNull();return dialog!;
}
function queuedRealHandlerReceipt(kind: Kind) {
  const pending = deferred<any>();
  const handler = kind === 'history' ? createConfigHistoryHandler(async () => pending.promise)
    : createConfigAutoBackupRestoreHandler(async () => pending.promise);
  ports.send.mockImplementationOnce((message: any) => handler.handle(message, {}));
  return pending;
}
function restoredReceipt(kind: Kind, config: unknown) {
  const history = appendConfigHistorySnapshot(ports.history, config)!;
  return kind === 'history' ? history : {history, backups: structuredClone(ports.backups)};
}

describe.each(kinds)('%s 恢复的公开组件归属', kind => {
  it.each(['cancel', 'escape'] as const)('%s 的实际 close-auto-focus hook 等待 DOM 更新后归还原按钮，且可重试再 Escape', async action => {
    const {host} = await mount();await open(host, kind);
    const trigger = button(preview(host), '恢复此版本');trigger.focus();await begin(host);
    const tick = await holdCancelledFocus(host, action);await releaseCancelledFocus(tick);
    expect(dom.document.activeElement).toBe(trigger);expect(trigger.disabled).toBe(false);
    expect(ports.send).not.toHaveBeenCalled();expect(ports.messages).not.toHaveBeenCalled();
    await begin(host);const retryTick = await holdCancelledFocus(host, 'escape');await releaseCancelledFocus(retryTick);
    expect(dom.document.activeElement).toBe(trigger);expect(preview(host).contains(trigger)).toBe(true);
  });
  it('允许 Dialog hook 后的标准默认归还，再在原预览内补偿到恢复按钮', async () => {
    const {host} = await mount();await open(host, kind);
    const origin = button(preview(host), '关闭'), trigger = button(preview(host), '恢复此版本');
    origin.focus();await begin(host);ports.defaultFocus = true;
    const tick = await holdCancelledFocus(host);expect(dom.document.activeElement).toBe(origin);
    await releaseCancelledFocus(tick);expect(dom.document.activeElement).toBe(trigger);
  });
  it.each(boundaries)('取消后的真实 hook 被暂停时 %s 撤销焦点归还', async boundary => {
    const {host} = await mount();await open(host, kind);
    const trigger = button(preview(host), '恢复此版本');trigger.focus();await begin(host);
    const tick = await holdCancelledFocus(host);await invalidate(host, kind, boundary);
    const focusAfterBoundary = dom.document.activeElement;await releaseCancelledFocus(tick);
    expect(dom.document.activeElement).toBe(focusAfterBoundary);expect(dom.document.activeElement).not.toBe(trigger);
    expect(ports.send).not.toHaveBeenCalled();expect(ports.messages).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'detached', 'disabled'] as const)('延迟归还前 %s 不得对原按钮调用焦点', async boundary => {
    const {host} = await mount();await open(host, kind);
    const trigger = button(preview(host), '恢复此版本');trigger.focus();await begin(host);
    const tick = await holdCancelledFocus(host);
    if (boundary === 'hidden') Object.defineProperty(dom.document, 'visibilityState', {configurable: true, value: 'hidden'});
    else if (boundary === 'detached') trigger.remove();else trigger.setAttribute('disabled', '');
    const focusAfterBoundary = dom.document.activeElement;await releaseCancelledFocus(tick);
    expect(dom.document.activeElement).toBe(focusAfterBoundary);expect(dom.document.activeElement).not.toBe(trigger);
  });
  it('旧 Dialog 已执行的释放 hook 延迟返回时，新 operation 保有确认焦点及 busy', async () => {
    const {host} = await mount();await open(host, kind);await begin(host);
    const tick = await holdCancelledFocus(host);await begin(host);
    const newDialog = confirmation(host), newFocus = dom.document.activeElement;
    expect(newDialog.contains(newFocus)).toBe(true);await releaseCancelledFocus(tick);
    expect(confirmation(host)).toBe(newDialog);expect(dom.document.activeElement).toBe(newFocus);
    expect(button(preview(host), '恢复此版本').disabled).toBe(true);expect(ports.send).not.toHaveBeenCalled();
    await confirm(host);expect(ports.send).toHaveBeenCalledOnce();
  });
  it('延迟期间文档隐藏再返回也不能复活旧焦点归还', async () => {
    const {host} = await mount();await open(host, kind);await begin(host);
    const trigger = button(preview(host), '恢复此版本'), tick = await holdCancelledFocus(host);
    for (const visibilityState of ['hidden', 'visible']) {
      Object.defineProperty(dom.document, 'visibilityState', {configurable: true, value: visibilityState});
      dom.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    }
    const focusAfterBoundary = dom.document.activeElement;await releaseCancelledFocus(tick);
    expect(dom.document.activeElement).toBe(focusAfterBoundary);expect(dom.document.activeElement).not.toBe(trigger);
  });
  it('发送恢复时的 Dialog 释放 hook 不归还或释放 busy，仍由真实客户端 receipt 结束操作', async () => {
    const {host} = await mount();await open(host, kind);await begin(host);
    const trigger = button(preview(host), '恢复此版本'), pending = deferred<unknown>();ports.send.mockReturnValueOnce(pending.promise);
    button(confirmation(host), '恢复').focus();await confirm(host);
    expect(trigger.disabled).toBe(true);expect(ports.send).toHaveBeenCalledWith(expectedMessage(kind));
    const input = dom.document.createElement('input');dom.document.body.append(input);input.focus();await settle();
    expect(dom.document.activeElement).toBe(input);expect(trigger.disabled).toBe(true);
    pending.resolve({success: false, error: 'controlled restore failure'});await settle();
    expect(dom.document.activeElement).toBe(input);expect(trigger.disabled).toBe(false);
    expect(ports.messages).toHaveBeenCalledWith('error', '恢复失败：controlled restore failure');
  });
  it.each(['before-release', 'after-default', 'original-default-target', 'blur-to-body', 'trigger-then-blur'] as const)('%s 用户新选择不得被取消的旧确认僭越', async timing => {
    const {host} = await mount();await open(host, kind);
    const trigger = button(preview(host), '恢复此版本'), origin = button(preview(host), '关闭');origin.focus();await begin(host);
    const input = dom.document.createElement('input');dom.document.body.append(input);
    if (timing === 'before-release') {
      // 确认仍挂载，但用户已经转移焦点；公开 Escape 事件不能覆盖这个选择。
      input.focus();const tick = deferred<void>();ports.focusTick = tick;
      const event = new dom.window.Event('keydown', {bubbles: true});Object.defineProperty(event, 'key', {value: 'Escape'});confirmation(host).dispatchEvent(event);
      await settle();await releaseCancelledFocus(tick);expect(dom.document.activeElement).toBe(input);
    } else {
      const tick = await holdCancelledFocus(host);
      const selected = timing === 'trigger-then-blur' ? trigger : timing === 'original-default-target' ? origin : input;selected.focus();
      if (timing === 'blur-to-body' || timing === 'trigger-then-blur') selected.blur();
      const chosen = dom.document.activeElement;await releaseCancelledFocus(tick);expect(dom.document.activeElement).toBe(chosen);
    }
    expect(dom.document.activeElement).not.toBe(trigger);expect(ports.send).not.toHaveBeenCalled();
  });
  it('暂停归还期间仅凭据/计数更新仍归还原按钮，不破坏不可恢复字段隔离', async () => {
    const {host, config} = await mount();await open(host, kind);
    const trigger = button(preview(host), '恢复此版本');trigger.focus();await begin(host);
    const tick = await holdCancelledFocus(host);await navigate(host, 'nonrestorable');await releaseCancelledFocus(tick);
    expect(dom.document.activeElement).toBe(trigger);expect(config.count).toBe(74);expect(config.apiKeys.openai).toEqual(['new-current-fixture-key']);
    expect(ports.send).not.toHaveBeenCalled();expect(ports.messages).not.toHaveBeenCalled();
  });
  it.each(boundaries)('%s 取消尚未确认的恢复，返回后可再次恢复当前目标', async boundary => {
    const {host} = await mount();await open(host, kind);await begin(host);await invalidate(host, kind, boundary);
    expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();expect(ports.send).not.toHaveBeenCalled();expect(ports.messages).not.toHaveBeenCalled();
    expect(ports.globalConfirm).not.toHaveBeenCalled();expect(ports.globalClose).not.toHaveBeenCalled();
    if (boundary === 'unmount') return;
    await reopen(host, kind, boundary);await begin(host);await confirm(host);
    expect(ports.send.mock.calls.map(([message]) => message)).toEqual([expectedMessage(kind, boundary === 'target' ? 2 : 1)]);
    expect(ports.messages).toHaveBeenCalledOnce();expect(ports.messages).toHaveBeenCalledWith('success', '设置已恢复');
  });
  it.each(boundaries.flatMap(boundary => [false, true].map(failure => ({boundary, failure}))))('$boundary 后旧 receipt failure=$failure 不安装快照、不通知、不释放新确认 busy', async ({boundary, failure}) => {
    const pending = deferred<unknown>();ports.send.mockReturnValueOnce(pending.promise);
    const {host} = await mount();await open(host, kind);await begin(host);await confirm(host);
    expect(ports.send).toHaveBeenCalledOnce();expect(ports.send).toHaveBeenCalledWith(expectedMessage(kind));
    await invalidate(host, kind, boundary);
    if (boundary !== 'unmount') {await reopen(host, kind, boundary);await begin(host);}
    const before = versionLabels(host);pending.resolve(lateResult(kind, failure));await settle();
    expect(versionLabels(host)).toEqual(before);expect(ports.messages).not.toHaveBeenCalled();expect(ports.send).toHaveBeenCalledOnce();
    if (boundary === 'unmount') return;
    expect(host.querySelectorAll('.config-restore-confirm-dialog')).toHaveLength(1);
    expect(button(preview(host), '恢复此版本').disabled).toBe(true);
    await confirm(host);
    expect(ports.send.mock.calls.map(([message]) => message)).toEqual([expectedMessage(kind), expectedMessage(kind, boundary === 'target' ? 2 : 1)]);
    expect(ports.messages).toHaveBeenCalledOnce();expect(ports.messages).toHaveBeenCalledWith('success', '设置已恢复');
  });
  it.each(['cancel', 'escape'])('%s 只关闭当前确认且释放 busy，预览可以重试', async action => {
    const {host} = await mount();await open(host, kind);await begin(host);
    if (action === 'cancel') button(confirmation(host), '取消').click();
    else {const event = new dom.window.Event('keydown', {bubbles: true});Object.defineProperty(event, 'key', {value: 'Escape'});confirmation(host).dispatchEvent(event);}
    await settle();expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();expect(button(preview(host), '恢复此版本').disabled).toBe(false);
    expect(ports.send).not.toHaveBeenCalled();expect(ports.messages).not.toHaveBeenCalled();await begin(host);await confirm(host);expect(ports.send).toHaveBeenCalledOnce();
  });
  it('同一挂载按钮的连续点击只创建一份确认和一次真实客户端请求', async () => {
    const {host} = await mount();await open(host, kind);const pending = deferred<unknown>();ports.send.mockReturnValueOnce(pending.promise);
    const restore = button(preview(host), '恢复此版本');restore.click();restore.click();await settle();expect(host.querySelectorAll('.config-restore-confirm-dialog')).toHaveLength(1);
    const yes = button(confirmation(host), '恢复');yes.click();yes.click();await settle();expect(ports.send).toHaveBeenCalledOnce();expect(button(preview(host), '恢复此版本').disabled).toBe(true);
    pending.resolve(lateResult(kind, false));await settle();expect(host.querySelector('.config-preview-dialog')).toBeNull();expect(ports.messages).toHaveBeenCalledOnce();
  });
  it('实际客户端失败会释放 busy，保留预览并允许重试', async () => {
    const {host} = await mount();await open(host, kind);ports.send.mockResolvedValueOnce({success: false, error: 'controlled restore failure'});
    await begin(host);await confirm(host);expect(ports.messages).toHaveBeenCalledWith('error', '恢复失败：controlled restore failure');expect(button(preview(host), '恢复此版本').disabled).toBe(false);
    await begin(host);await confirm(host);expect(ports.send.mock.calls.map(([message]) => message)).toEqual([expectedMessage(kind), expectedMessage(kind)]);expect(ports.messages).toHaveBeenLastCalledWith('success', '设置已恢复');
  });
  it.each([false, true])('公开关闭至 closed 过渡内的旧 receipt failure=%s 保留可见预览内容但不安装/通知', async failure => {
    const {host} = await mount();await open(host, kind);const pending = deferred<unknown>();ports.send.mockReturnValueOnce(pending.promise);await begin(host);await confirm(host);
    ports.delayClosed = true;const before = versionLabels(host);button(preview(host), '关闭').click();await settle();
    expect(host.querySelector('.config-preview-dialog')!.getAttribute('data-dialog-visible')).toBe('false');expect(host.querySelector('.preview-summary')).not.toBeNull();expect(ports.closing.size).toBe(1);
    pending.resolve(lateResult(kind, failure));await settle();expect(versionLabels(host)).toEqual(before);expect(ports.messages).not.toHaveBeenCalled();expect(ports.send).toHaveBeenCalledOnce();
    for (const finish of [...ports.closing]) finish();await settle();expect(host.querySelector('.config-preview-dialog')).toBeNull();expect(ports.closing.size).toBe(0);
  });
  it('旧消息端口 rejection 不影响返回后新确认的 busy 和发送', async () => {
    const {host} = await mount();await open(host, kind);const pending = deferred<unknown>();ports.send.mockReturnValueOnce(pending.promise);await begin(host);await confirm(host);
    await navigate(host, 'active');await navigate(host, 'back');await open(host, kind);await begin(host);pending.reject(new Error('old transport rejection'));await settle();
    expect(ports.messages).not.toHaveBeenCalled();expect(button(preview(host), '恢复此版本').disabled).toBe(true);await confirm(host);expect(ports.send).toHaveBeenCalledTimes(2);expect(ports.messages).toHaveBeenCalledOnce();
  });
  it('只把版本交给真实客户端，不把旧 API 凭据和翻译计数变为恢复载荷', async () => {
    const saved = kind === 'history' ? ports.history.entries[0] : ports.backups.entries[0];
    Object.assign(saved.config, {count: 0, apiKeys: {openai: ['saved-fixture-key']}, token: {openai: 'saved-fixture-key'}});
    const {host, config} = await mount();await open(host, kind);
    expect(preview(host).querySelector('.restore-boundary')!.textContent).toBe('API 凭据和翻译次数不会随设置版本恢复');
    const json = JSON.parse(preview(host).querySelector('pre')!.textContent!);expect(json.count).toBeUndefined();expect(JSON.stringify(json)).not.toContain('saved-fixture-key');
    await begin(host);await confirm(host);expect(ports.send).toHaveBeenCalledWith(expectedMessage(kind));expect(config.count).toBe(73);expect(config.apiKeys.openai).toEqual(['current-fixture-key']);
  });
  it('页面失活只释放自己的确认，保留另一个调用者的 Dialog', async () => {
    const {host} = await mount();const foreignHost = dom.document.createElement('div');dom.document.body.append(foreignHost);
    const foreign = runtime.createApp({render: () => runtime.h(Dialog, {modelValue: true, class: 'foreign-confirm-dialog'}, {default: () => 'foreign'})});apps.add(foreign);foreign.mount(foreignHost);
    await open(host, kind);await begin(host);await navigate(host, 'active');expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();expect(foreignHost.querySelector('.foreign-confirm-dialog')).not.toBeNull();expect(ports.globalClose).not.toHaveBeenCalled();
  });
  it('同对象 API 凭据与计数更新不取消有效确认，仍只发送版本恢复请求', async () => {
    const {host, config} = await mount();await open(host, kind);await begin(host);await navigate(host, 'nonrestorable');
    expect(host.querySelectorAll('.config-restore-confirm-dialog')).toHaveLength(1);expect(ports.send).not.toHaveBeenCalled();
    await confirm(host);expect(ports.send).toHaveBeenCalledWith(expectedMessage(kind));expect(ports.messages).toHaveBeenCalledWith('success', '设置已恢复');
    expect(config.count).toBe(74);expect(config.apiKeys.openai).toEqual(['new-current-fixture-key']);
  });
  it.each(['assign', 'deep'])('%s 同一批次内仍挂载的确认按钮也不能恢复旧上下文', async boundary => {
    const {host} = await mount();await open(host, kind);await begin(host);
    const yes = button(confirmation(host), '恢复');expect(yes.isConnected).toBe(true);
    host.querySelector<HTMLButtonElement>(`button[data-lifecycle="${boundary}"]`)!.click();
    // 两次事件发生在 DOM 更新前；没有缓存或调用卸载后的事件 handler。
    expect(yes.isConnected).toBe(true);yes.click();expect(ports.send).not.toHaveBeenCalled();await settle();
    expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();expect(ports.messages).not.toHaveBeenCalled();
    await open(host, kind);await begin(host);await confirm(host);expect(ports.send).toHaveBeenCalledOnce();
  });
  it.each(['config-first', 'history-first'])('后台先广播恢复目标再返回实际 handler receipt，%s 仍显示成功及正确快照，保留当前凭据/count', async order => {
    const {host, config} = await mount();await open(host, kind);
    const saved = kind === 'history' ? ports.history.entries[0] : ports.backups.entries[0];
    const expected = restoreRestorableConfig(saved.config, config), pending = queuedRealHandlerReceipt(kind);
    button(await beginThroughPublicConfirmation(host), '恢复').click();await settle();
    expect(ports.send.mock.calls.map(([message]) => message)).toEqual([expectedMessage(kind)]);
    const receipt = restoredReceipt(kind, expected);
    ports.installedConfig = expected;ports.installedHistory = 'history' in receipt ? receipt.history : receipt;
    for (const channel of order === 'config-first' ? ['install', 'history'] : ['history', 'install']) {
      await navigate(host, channel);preview(host);expect(ports.messages).not.toHaveBeenCalled();
    }
    // 同一个父配置对象安装后台目标，receipt 尚未到达，不能提前取消或报告成功。
    expect(toRestorableConfig(config)).toEqual(toRestorableConfig(expected));preview(host);expect(ports.messages).not.toHaveBeenCalled();
    pending.resolve(receipt);await settle();
    expect(ports.messages).toHaveBeenCalledOnce();expect(ports.messages).toHaveBeenCalledWith('success', '设置已恢复');expect(host.querySelector('.config-preview-dialog')).toBeNull();
    expect(config.count).toBe(73);expect(config.apiKeys.openai).toEqual(['current-fixture-key']);
    const latest = appendConfigHistorySnapshot(ports.history, expected)!.entries.at(-1)!;
    await open(host, 'history', latest.version);
    expect(JSON.parse(preview(host).querySelector('pre')!.textContent!)).toEqual(toRestorableConfig(expected));
    expect(preview(host).querySelector('.restore-boundary')!.textContent).toBe('API 凭据和翻译次数不会随设置版本恢复');
  });
  it.each(['deep', 'baseline'])('本次目标广播后又发生 %s 修改，旧成功 receipt 不覆盖/通知/释放新 busy', async boundary => {
    const {host, config} = await mount();await open(host, kind);
    const saved = kind === 'history' ? ports.history.entries[0] : ports.backups.entries[0];
    const expected = restoreRestorableConfig(saved.config, config), pending = queuedRealHandlerReceipt(kind);
    button(await beginThroughPublicConfirmation(host), '恢复').click();await settle();
    ports.installedConfig = expected;await navigate(host, 'install');preview(host);expect(ports.messages).not.toHaveBeenCalled();
    await navigate(host, boundary);expect(host.querySelector('.config-preview-dialog')).toBeNull();
    const foreign = toRestorableConfig(config);await open(host, kind);await begin(host);const before = versionLabels(host);
    pending.resolve(restoredReceipt(kind, expected));await settle();
    expect(toRestorableConfig(config)).toEqual(foreign);expect(versionLabels(host)).toEqual(before);expect(ports.messages).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.config-restore-confirm-dialog')).toHaveLength(1);expect(button(preview(host), '恢复此版本').disabled).toBe(true);expect(ports.send).toHaveBeenCalledOnce();
    await confirm(host);expect(ports.send).toHaveBeenCalledTimes(2);expect(ports.messages).toHaveBeenCalledWith('success', '设置已恢复');
  });
  it('确认前到达恰好等于目标的同对象配置，也必须取消旧确认且不发送', async () => {
    const {host, config} = await mount();await open(host, kind);await beginThroughPublicConfirmation(host);
    const saved = kind === 'history' ? ports.history.entries[0] : ports.backups.entries[0];
    ports.installedConfig = restoreRestorableConfig(saved.config, config);await navigate(host, 'install');
    expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();expect(host.querySelector('.config-preview-dialog')).toBeNull();expect(ports.send).not.toHaveBeenCalled();expect(ports.messages).not.toHaveBeenCalled();
  });
  it('目标广播本身不能代表成功，随后实际 handler 失败仍显示错误而非成功', async () => {
    const {host, config} = await mount();await open(host, kind);
    const saved = kind === 'history' ? ports.history.entries[0] : ports.backups.entries[0];
    const pending = queuedRealHandlerReceipt(kind);button(await beginThroughPublicConfirmation(host), '恢复').click();await settle();
    ports.installedConfig = restoreRestorableConfig(saved.config, config);await navigate(host, 'install');preview(host);expect(ports.messages).not.toHaveBeenCalled();
    pending.reject(new Error('controlled history write failure'));await settle();
    expect(ports.messages).toHaveBeenCalledOnce();expect(ports.messages).toHaveBeenCalledWith('error', '恢复失败：controlled history write failure');preview(host);
    expect(host.querySelector('.config-restore-confirm-dialog')).toBeNull();expect(config.count).toBe(73);expect(config.apiKeys.openai).toEqual(['current-fixture-key']);
  });
});
