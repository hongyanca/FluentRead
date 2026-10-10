import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_CACHE_MAX_BYTES,
  DEFAULT_TRANSLATION_CACHE_MAX_ENTRIES,
  MAX_TRANSLATION_CACHE_MAX_BYTES,
  MAX_TRANSLATION_CACHE_MAX_ENTRIES,
  MIN_TRANSLATION_CACHE_MAX_BYTES,
  MIN_TRANSLATION_CACHE_MAX_ENTRIES,
  normalizeTranslationCacheLimits,
} from '@/src/core/config/translationCache';

describe('translation cache capacity normalization', () => {
  it.each([undefined, null, false, 42, '5', [], {}, { maxBytes: Infinity, maxEntries: NaN },
    { maxBytes: '5000000', maxEntries: '2000' }])('defaults invalid or missing limits: %j', (value) => {
    expect(normalizeTranslationCacheLimits(value)).toEqual({
      maxBytes: DEFAULT_TRANSLATION_CACHE_MAX_BYTES,
      maxEntries: DEFAULT_TRANSLATION_CACHE_MAX_ENTRIES,
    });
  });

  it('preserves smaller saved limits and caps legacy oversized settings', () => {
    expect(normalizeTranslationCacheLimits({ maxBytes: 5 * 1024 * 1024, maxEntries: 2000 }))
      .toEqual({ maxBytes: 5 * 1024 * 1024, maxEntries: 2000 });
    expect(normalizeTranslationCacheLimits({ maxBytes: 100 * 1024 * 1024, maxEntries: 50000 }))
      .toEqual({ maxBytes: 10 * 1024 * 1024, maxEntries: 10000 });
  });

  it('clamps finite values to the supported minimum and maximum', () => {
    expect(normalizeTranslationCacheLimits({ maxBytes: -1, maxEntries: 0 })).toEqual({
      maxBytes: MIN_TRANSLATION_CACHE_MAX_BYTES, maxEntries: MIN_TRANSLATION_CACHE_MAX_ENTRIES,
    });
    expect(normalizeTranslationCacheLimits({ maxBytes: Number.MAX_VALUE, maxEntries: 50001 })).toEqual({
      maxBytes: MAX_TRANSLATION_CACHE_MAX_BYTES, maxEntries: MAX_TRANSLATION_CACHE_MAX_ENTRIES,
    });
  });

  it('rounds valid fractional limits down independently', () => {
    expect(normalizeTranslationCacheLimits({ maxBytes: 2 * 1024 * 1024 + 0.5, maxEntries: 999.9 })).toEqual({
      maxBytes: 2 * 1024 * 1024, maxEntries: 999,
    });
    expect(normalizeTranslationCacheLimits({ maxBytes: 3 * 1024 * 1024 })).toEqual({
      maxBytes: 3 * 1024 * 1024, maxEntries: DEFAULT_TRANSLATION_CACHE_MAX_ENTRIES,
    });
  });
});
