/**
 * @file src/app/background/tabTranslationState.ts
 * 文件职责：维护后台内存中的按标签页全文翻译状态，为右键菜单展示和运行时消息提供轻量、可清理的状态来源。
 * 主要内容：定义 isTranslated、isSiteDisabled 的状态结构，使用 Map 实现 get/set/delete，并在读写时规范化部分状态；同时从 platform 重新导出合法 tabId 判断。
 * 模块边界：该 store 不持久化到浏览器存储、不操作页面 DOM，也不触发翻译；它只保存当前 worker 生命周期内的展示状态，业务会话仍由 full-page feature 管理。
 */
export {isBrowserTabId} from '@/src/platform/browser/ids';

export interface TabTranslationState {
    isTranslated: boolean;
    isSiteDisabled: boolean;
}

interface PartialTabTranslationState {
    isTranslated?: boolean;
    isSiteDisabled?: boolean;
}

/**
 * 保存后台 service worker 的标签页瞬时状态；持久真值仍由 content script 提供。
 */
export class TabTranslationStateStore {
    private readonly states = new Map<number, PartialTabTranslationState>();

    hasCompleteState(tabId: number): boolean {
        const state = this.states.get(tabId);
        return typeof state?.isTranslated === 'boolean'
            && typeof state.isSiteDisabled === 'boolean';
    }

    get(tabId: number): TabTranslationState {
        const state = this.states.get(tabId);
        return {
            isTranslated: state?.isTranslated === true,
            isSiteDisabled: state?.isSiteDisabled === true,
        };
    }

    set(tabId: number, state: TabTranslationState): TabTranslationState {
        const snapshot = {...state};
        this.states.set(tabId, snapshot);
        return snapshot;
    }

    setTranslated(tabId: number, isTranslated: boolean): TabTranslationState {
        const current = this.states.get(tabId) || {};
        current.isTranslated = isTranslated;
        this.states.set(tabId, current);
        return this.get(tabId);
    }

    setSiteDisabled(tabId: number, isSiteDisabled: boolean): TabTranslationState {
        const current = this.states.get(tabId) || {};
        current.isSiteDisabled = isSiteDisabled;
        if (isSiteDisabled) current.isTranslated = false;
        this.states.set(tabId, current);
        return this.get(tabId);
    }

    reset(tabId: number): TabTranslationState {
        return this.set(tabId, {isTranslated: false, isSiteDisabled: false});
    }

    delete(tabId: number): void {
        this.states.delete(tabId);
    }
}
