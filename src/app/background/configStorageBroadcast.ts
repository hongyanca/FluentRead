/**
 * @file src/app/background/configStorageBroadcast.ts
 *
 * 文件职责：把后台加密配置仓库的键级变化通知给已打开的扩展页面和网页 content，使各上下文重新向后台拉取授权后的明文快照。
 * 主要内容：监听配置、凭据、历史、备份与 OCR 元数据键，向 extension runtime 广播无值通知，并仅把公开主配置变化发送到普通标签页。
 * 模块边界：本文件不携带配置值、不判断凭据读取权限、不写 IndexedDB；读取授权由 configStorage handler 承担，运行时装配由 messageRuntime 调用。
 */

import {
    CONFIG_INDEXED_DB_KEYS,
    CONFIG_STORAGE_CHANGED_MESSAGE,
    type ConfigStoragePort,
} from '@/src/platform/storage/configStorage';

export interface ConfigStorageBroadcastRuntime {
    sendRuntimeMessage(message: unknown): Promise<unknown>;
    queryTabs(): Promise<Array<{id?: number}>>;
    sendTabMessage(tabId: number, message: unknown): Promise<unknown>;
    warn(message: string, error: unknown): void;
}

export function installConfigStorageBroadcast(
    storage: ConfigStoragePort,
    runtime: ConfigStorageBroadcastRuntime,
): () => void {
    const unsubscribers = CONFIG_INDEXED_DB_KEYS.map(key => storage.watch(key, () => {
        const message = {type: CONFIG_STORAGE_CHANGED_MESSAGE, key};
        void runtime.sendRuntimeMessage(message).catch(error => {
            // 没有打开的扩展页面时 Chrome 会报告 Receiving end；这是正常空广播。
            if (!(error instanceof Error) || !error.message.includes('Receiving end')) {
                runtime.warn('[FluentRead] 扩展配置变化广播失败', error);
            }
        });
        if (key !== 'local:config') return;
        void runtime.queryTabs().then(tabs => Promise.all(tabs.map(tab => (
            typeof tab.id === 'number'
                ? runtime.sendTabMessage(tab.id, message).catch(() => undefined)
                : Promise.resolve()
        )))).catch(error => runtime.warn('[FluentRead] 网页配置变化广播失败', error));
    }));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
