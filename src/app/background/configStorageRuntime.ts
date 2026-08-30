/**
 * @file src/app/background/configStorageRuntime.ts
 *
 * 文件职责：把后台配置 IndexedDB 端口连接到 OCR 元数据仓库和浏览器 runtime/tabs 变化广播。
 * 主要内容：创建兼容图片 OCR 批量键契约的加密存储 adapter，并用真实 browser API 安装仅携带键名的配置变化通知。
 * 模块边界：本文件是后台 composition glue，不实现加密、迁移、授权或 OCR 领域规则；纯广播策略与配置仓库分别在相邻模块中测试。
 */

import {configStorage} from '@/src/platform/storage/configStorageRuntime';
import type {ImageOcrLanguageStorage} from '@/src/features/image-translation/background/ocrLanguageRepository';
import {installConfigStorageBroadcast} from './configStorageBroadcast';

export function createConfigImageOcrLanguageStorage(): ImageOcrLanguageStorage {
    return {
        get: async key => ({[key]: await configStorage.getItem(`local:${key}`)}),
        set: async values => {
            await Promise.all(Object.entries(values).map(([key, value]) => (
                configStorage.setItem(`local:${key}`, value)
            )));
        },
    };
}

export function installBrowserConfigStorageBroadcast(): void {
    installConfigStorageBroadcast(configStorage, {
        sendRuntimeMessage: message => browser.runtime.sendMessage(message),
        queryTabs: () => browser.tabs.query({}) as Promise<Array<{id?: number}>>,
        sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
        warn: (message, error) => console.warn(message, error),
    });
}
