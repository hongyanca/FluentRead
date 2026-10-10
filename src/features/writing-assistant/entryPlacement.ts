/**
 * @file src/features/writing-assistant/entryPlacement.ts
 * 文件职责：把写作入口放入 Gmail 与 GitHub 的原生操作行。
 * 主要内容：锁定入口宿主的布局身份，并按网站约定把宿主放到原生操作按钮的前后；按钮内部仍由调用方放入 Shadow DOM。
 * 模块边界：只处理入口宿主的 DOM 布局，不读取网页内容、不定位模型面板。
 */
export type WritingEntrySite = 'github' | 'gmail';

const WRITING_ENTRY_HOST_STYLE = [
    'all:initial !important',
    'display:inline-flex !important',
    'align-items:center !important',
    'justify-content:center !important',
    'position:static !important',
    'vertical-align:middle !important',
    'flex:0 0 auto !important',
    'width:auto !important',
    'height:32px !important',
    'margin-inline:4px !important',
    'padding:0 !important',
    'border:0 !important',
    'line-height:0 !important',
    'white-space:nowrap !important',
    'z-index:auto !important',
].join(';');

export function prepareWritingEntryHost(host: HTMLElement): void {
    host.style.cssText = WRITING_ENTRY_HOST_STYLE;
}

/** 将入口作为原生操作行的真实子节点插入，而不是放在页面上方的 fixed 浮层。 */
export function placeWritingEntry(action: HTMLElement, host: HTMLElement, site: WritingEntrySite): boolean {
    const parent = action.parentElement;
    if (!action.isConnected || !parent) return false;
    if (site === 'github') {
        if (action.previousElementSibling !== host) parent.insertBefore(host, action);
    } else if (action.nextElementSibling !== host) {
        parent.insertBefore(host, action.nextSibling);
    }
    return host.parentElement === parent;
}
