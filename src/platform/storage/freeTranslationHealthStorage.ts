/**
 * @file src/platform/storage/freeTranslationHealthStorage.ts
 * 文件职责：持久保存免费翻译服务的冷却与性能统计，使后台重启后继续遵守恢复时间和动态分配。
 * 主要内容：提供独立本地存储键与读取、写入端口；userscript 通过现有 WXT 存储别名使用 GM 私有存储。
 * 模块边界：只存服务身份摘要、错误类别、时间与平滑成功率和耗时，不存原文、译文、Cookie、用户密钥或个人配置。
 */
import {storage} from '@wxt-dev/storage';
import type {FreeHealthPersistence} from '@/src/services/translation/freeFallback';

export const FREE_TRANSLATION_HEALTH_STORAGE_KEY = 'local:freeTranslationHealth:v1';
export const freeTranslationHealthStorage: FreeHealthPersistence = {
    load: () => storage.getItem(FREE_TRANSLATION_HEALTH_STORAGE_KEY),
    save: entries => storage.setItem(FREE_TRANSLATION_HEALTH_STORAGE_KEY, entries),
};
