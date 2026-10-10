/**
 * @file src/features/selection-translation/background/pageZoomHandler.ts
 * 文件职责：仅向发起请求的内容脚本返回其所属标签页的页面缩放比例。
 * 主要内容：从可信 runtime sender 读取 tabId，按浏览器能力获取页面缩放并规范化结果；移动版缺少或拒绝缩放 API 时沿用默认比例，避免后台启动和划词卡片中断。
 * 模块边界：不接受消息体指定的标签页，不更改页面缩放或读取宿主页内容；浏览器 API 由组合层注入。
 */

import {normalizeSelectionPageZoom, SELECTION_PAGE_ZOOM_CHANGED, SELECTION_PAGE_ZOOM_REQUEST} from '../pageZoom';
import {isBrowserTabId} from '@/src/platform/browser/ids';

interface SelectionPageZoomTabs {
    getZoom?(tabId: number): Promise<number>;
    onZoomChange?: {addListener(listener: (change: {tabId: number; newZoomFactor: number}) => void): void};
    sendMessage(tabId: number, message: {type: typeof SELECTION_PAGE_ZOOM_CHANGED; zoom: number}): Promise<unknown>;
}

/** Firefox Android 不提供 tabs.getZoom/onZoomChange；缺失时继续注册翻译消息路由。 */
export function createSelectionPageZoomBrowserPort(tabs: SelectionPageZoomTabs) {
    return {
        getZoom: (tabId: number): Promise<number> =>
            typeof tabs.getZoom === 'function' ? tabs.getZoom(tabId) : Promise.resolve(1),
        installZoomChangeListener(): void {
            if (typeof tabs.onZoomChange?.addListener !== 'function') return;
            tabs.onZoomChange.addListener(({tabId, newZoomFactor}) => {
                if (!isBrowserTabId(tabId)) return;
                void tabs.sendMessage(tabId, {
                    type: SELECTION_PAGE_ZOOM_CHANGED,
                    zoom: normalizeSelectionPageZoom(newZoomFactor),
                }).catch(() => undefined);
            });
        },
    };
}

export interface SelectionPageZoomContext {
    sender?: {tab?: {id?: number}};
}

export function createSelectionPageZoomHandler(getZoom: (tabId: number) => Promise<number>) {
    return {
        type: SELECTION_PAGE_ZOOM_REQUEST,
        async handle(_message: {type: typeof SELECTION_PAGE_ZOOM_REQUEST}, context: SelectionPageZoomContext) {
            const tabId = context.sender?.tab?.id;
            if (!isBrowserTabId(tabId)) return {success: false as const};
            try {
                return {success: true as const, zoom: normalizeSelectionPageZoom(await getZoom(tabId))};
            } catch {
                // 页面缩放只影响划词卡片定位；移动版可能拒绝查询当前标签页。
                return {success: true as const, zoom: 1};
            }
        },
    };
}
