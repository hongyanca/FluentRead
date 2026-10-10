/**
 * @file src/features/local-translation/offscreen/modelCache.ts
 *
 * 文件职责：检查和清除本地翻译模型的 Transformers.js 缓存文件。
 * 主要内容：固定 q8 文件清单与远程文件地址，使用 Transformers.js 共用的 Cache Storage 判断完整性并按模型删除；带进度的下载由 downloads.ts 负责。
 * 模块边界：只负责模型文件缓存，不初始化 ONNX session，也不持有 Worker 或页面状态。
 */
import {
    LOCAL_TRANSLATION_MODEL_REMOTE_HOST,
    LOCAL_TRANSLATION_MODEL_REVISION,
    normalizeLocalTranslationModel,
} from '@/src/core/config/localTranslation';

export const LOCAL_TRANSLATION_MODEL_CACHE_NAME = 'transformers-cache';
export const LOCAL_TRANSLATION_MODEL_FILES = [
    'config.json',
    'generation_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
] as const;

export function getLocalTranslationModelFileUrl(modelValue: unknown, file: string): string {
    const model = normalizeLocalTranslationModel(modelValue);
    return `${LOCAL_TRANSLATION_MODEL_REMOTE_HOST}${model}/resolve/${LOCAL_TRANSLATION_MODEL_REVISION}/${file}`;
}

export async function isLocalTranslationModelCached(modelValue: unknown): Promise<boolean> {
    if (typeof caches === 'undefined') return false;
    const model = normalizeLocalTranslationModel(modelValue);
    const cache = await caches.open(LOCAL_TRANSLATION_MODEL_CACHE_NAME);
    const matches = await Promise.all(LOCAL_TRANSLATION_MODEL_FILES.map((file) => (
        cache.match(getLocalTranslationModelFileUrl(model, file))
    )));
    return matches.every(Boolean);
}

/** 只删除指定模型的文件，保留视频 Whisper 等其他 Transformers.js 缓存。 */
export async function removeLocalTranslationModelFiles(modelValue: unknown): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
    const model = normalizeLocalTranslationModel(modelValue);
    const cache = await caches.open(LOCAL_TRANSLATION_MODEL_CACHE_NAME);
    await Promise.all(LOCAL_TRANSLATION_MODEL_FILES.map((file) => (
        cache.delete(getLocalTranslationModelFileUrl(model, file))
    )));
}
