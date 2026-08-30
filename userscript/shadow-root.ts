type ShadowRootUiOptions<T> = {
    name: string;
    position?: string;
    alignment?: string;
    zIndex?: number;
    mode?: ShadowRootMode;
    inheritStyles?: boolean;
    isolateEvents?: string[];
    css?: string;
    onMount(container: HTMLElement): T;
    onRemove?(mounted?: T): void;
};

export interface ShadowRootContentScriptUi<T> {
    shadowHost: HTMLElement;
    shadow: ShadowRoot;
    mounted?: T;
    mount(): void;
    remove(): void;
}

function installStyles(shadow: ShadowRoot, localCss = ''): void {
    // 构建时汇总的全局 CSS 与当前组件 CSS 只写入 ShadowRoot，避免污染宿主网页样式。
    const css = [globalThis.__fluentReadUserscriptCss || '', localCss].filter(Boolean).join('\n');
    if (!css) return;
    const style = document.createElement('style');
    style.setAttribute('data-fluent-read-userscript-styles', 'true');
    style.textContent = css;
    shadow.appendChild(style);
}

/** 为单页 userscript runtime 提供兼容 WXT 契约的最小 Shadow UI 宿主。 */
export async function createShadowRootUi<T>(
    _ctx: unknown,
    options: ShadowRootUiOptions<T>,
): Promise<ShadowRootContentScriptUi<T>> {
    const shadowHost = document.createElement('div');
    shadowHost.setAttribute('data-fluent-read-userscript-host', options.name);
    // 用零尺寸固定宿主隔离网页布局；实际浮层由 ShadowRoot 子节点定位并接收事件。
    shadowHost.style.cssText = [
        'all: initial !important',
        'position: fixed !important',
        'left: 0 !important',
        'top: 0 !important',
        'width: 0 !important',
        'height: 0 !important',
        'overflow: visible !important',
        'pointer-events: auto !important',
        `z-index: ${options.zIndex ?? 2_147_483_647} !important`,
    ].join(';');

    const shadow = shadowHost.attachShadow({mode: options.mode || 'open'});
    installStyles(shadow, options.css);
    const container = document.createElement('div');
    container.setAttribute('data-fluent-read-userscript-container', options.name);
    container.style.cssText = 'all: initial; width: 0; height: 0; overflow: visible; pointer-events: auto;';
    shadow.appendChild(container);

    // 在捕获阶段阻断明确要求隔离的事件，保持与 WXT Shadow UI 的页面边界一致。
    for (const eventName of options.isolateEvents || []) {
        shadow.addEventListener(eventName, (event) => event.stopPropagation(), true);
    }

    let isMounted = false;
    const ui: ShadowRootContentScriptUi<T> = {
        shadowHost,
        shadow,
        mount() {
            if (isMounted) return;
            isMounted = true;
            (document.documentElement || document.body).appendChild(shadowHost);
            ui.mounted = options.onMount(container);
        },
        remove() {
            if (!isMounted) return;
            isMounted = false;
            options.onRemove?.(ui.mounted);
            ui.mounted = undefined;
            shadowHost.remove();
        },
    };
    return ui;
}
