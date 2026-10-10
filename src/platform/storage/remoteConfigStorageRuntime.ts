/**
 * @file src/platform/storage/remoteConfigStorageRuntime.ts
 * 文件职责：为内容脚本及扩展 UI 构建提供只含 runtime 代理的配置存储端口，替代同时装配后台加密数据库的通用运行时。
 * 主要内容：导出与 configStorageRuntime 同名的 configStorage，始终通过 createRemoteConfigStorage 读取和订阅后台权威配置。
 * 模块边界：内容脚本、popup、options 与 unlisted page 不是后台上下文，因此不引入 Dexie、加密仓库或旧 storage 迁移；构建期由 WXT 插件仅在这些入口的构建组替换模块，后台和独立 Worker 仍使用 configStorageRuntime。
 */
import {
    createRemoteConfigStorage,
    type ConfigStoragePort,
    type ConfigStorageRuntimePort,
} from './configStorage';

export const configStorage: ConfigStoragePort = createRemoteConfigStorage(browser.runtime as unknown as ConfigStorageRuntimePort);
