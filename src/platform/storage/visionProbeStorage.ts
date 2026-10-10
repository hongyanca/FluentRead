/**
 * @file src/platform/storage/visionProbeStorage.ts
 * 文件职责：在独立本地存储键保存识图探测结论，使后台重启后仍能复用有效结果。
 * 主要内容：适配 WXT storage 的读取与写入端口，userscript 使用已有 GM 私有存储别名。
 * 模块边界：仅持久化能力、配置身份摘要与时间，不存图片、答案、错误、原始凭据，不进入配置历史、导出或云同步。
 */
import {storage} from '@wxt-dev/storage';
import type {VisionProbePersistence} from '@/src/services/translation/visionProbe';
export const VISION_PROBE_STORAGE_KEY = 'local:modelVisionProbe:v1';
export const visionProbeStorage: VisionProbePersistence = {
    load: () => storage.getItem(VISION_PROBE_STORAGE_KEY),
    save: records => storage.setItem(VISION_PROBE_STORAGE_KEY, records),
};
