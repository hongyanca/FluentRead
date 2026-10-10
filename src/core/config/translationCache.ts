/**
 * @file src/core/config/translationCache.ts
 * 文件职责：定义翻译结果缓存的默认容量与用户可调范围，统一配置迁移和运行期的阈值校验。
 * 主要内容：导出字节数、条目数双重上限及 TranslationCacheLimits；非法值恢复默认，有限数值取整并限制在支持范围。
 * 模块边界：纯配置策略，不访问浏览器、持久层或 UI；配置服务、缓存服务和设置界面共享同一规则。
 */

export const DEFAULT_TRANSLATION_CACHE_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TRANSLATION_CACHE_MAX_ENTRIES = 10_000;
export const MIN_TRANSLATION_CACHE_MAX_BYTES = 1024 * 1024;
export const MAX_TRANSLATION_CACHE_MAX_BYTES = DEFAULT_TRANSLATION_CACHE_MAX_BYTES;
export const MIN_TRANSLATION_CACHE_MAX_ENTRIES = 100;
export const MAX_TRANSLATION_CACHE_MAX_ENTRIES = DEFAULT_TRANSLATION_CACHE_MAX_ENTRIES;

export interface TranslationCacheLimits {
  maxBytes: number;
  maxEntries: number;
}

function normalizeLimit(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function normalizeTranslationCacheLimits(value: unknown): TranslationCacheLimits {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    maxBytes: normalizeLimit(candidate.maxBytes, DEFAULT_TRANSLATION_CACHE_MAX_BYTES,
      MIN_TRANSLATION_CACHE_MAX_BYTES, MAX_TRANSLATION_CACHE_MAX_BYTES),
    maxEntries: normalizeLimit(candidate.maxEntries, DEFAULT_TRANSLATION_CACHE_MAX_ENTRIES,
      MIN_TRANSLATION_CACHE_MAX_ENTRIES, MAX_TRANSLATION_CACHE_MAX_ENTRIES),
  };
}
