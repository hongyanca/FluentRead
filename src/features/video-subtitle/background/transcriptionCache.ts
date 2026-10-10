/**
 * @file src/features/video-subtitle/background/transcriptionCache.ts
 * 文件职责：在后台私有 IndexedDB 中持久化 X 视频完整本地 AI 字幕结果。
 * 主要内容：规范化稳定视频身份、模型/语言/schema 缓存键，限制完整 cue、TTL 与 LRU，并提供 get/set/stats/clear。
 * 模块边界：只保存已完成字幕 cue 和身份元数据，不保存音频、partial/error 状态，也不访问网页播放器或配置凭据。
 */
import Dexie, {type Table} from 'dexie';
import type {VideoSubtitleCue} from '@/src/features/video-subtitle/content/youtubeSubtitleData';
import {
  buildVideoAiSubtitleCacheIdentity,
  buildVideoAiSubtitleCacheKey,
  normalizeCompletedVideoAiSubtitleCues,
  type VideoAiSubtitleCacheIdentity,
  type VideoAiSubtitleCacheRequest,
} from '@/src/features/video-subtitle/transcriptionCache';

export type {VideoAiSubtitleCacheIdentity, VideoAiSubtitleCacheRequest} from '@/src/features/video-subtitle/transcriptionCache';

export const VIDEO_AI_SUBTITLE_CACHE_DATABASE_NAME = 'FluentReadVideoAiSubtitleCache' as const;
export const VIDEO_AI_SUBTITLE_CACHE_DATABASE_VERSION = 1 as const;
export const VIDEO_AI_SUBTITLE_CACHE_MAX_ENTRIES = 32 as const;
export const VIDEO_AI_SUBTITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredVideoAiSubtitleCache extends VideoAiSubtitleCacheIdentity {
  key: string;
  cues: VideoSubtitleCue[];
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  bytes: number;
}

export interface VideoAiSubtitleCacheStats {
  entries: number;
  bytes: number;
  maxEntries: number;
  ttlMs: number;
}

export class FluentReadVideoAiSubtitleCacheDatabase extends Dexie {
  entries!: Table<StoredVideoAiSubtitleCache, string>;

  constructor(name: string = VIDEO_AI_SUBTITLE_CACHE_DATABASE_NAME) {
    super(name);
    this.version(VIDEO_AI_SUBTITLE_CACHE_DATABASE_VERSION).stores({
      entries: '&key, videoKey, lastAccessedAt, expiresAt',
    });
  }
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export class VideoAiSubtitleCacheRepository {
  constructor(readonly database: FluentReadVideoAiSubtitleCacheDatabase = new FluentReadVideoAiSubtitleCacheDatabase()) {}

  private async pruneExpired(now: number): Promise<void> {
    await this.database.entries.where('expiresAt').belowOrEqual(now).delete();
  }

  private async pruneLru(): Promise<void> {
    const entries = await this.database.entries.orderBy('lastAccessedAt').toArray();
    const excess = entries.length - VIDEO_AI_SUBTITLE_CACHE_MAX_ENTRIES;
    if (excess > 0) await this.database.entries.bulkDelete(entries.slice(0, excess).map((entry) => entry.key));
  }

  async get(request: VideoAiSubtitleCacheRequest, now = Date.now()): Promise<VideoSubtitleCue[] | null> {
    const identity = buildVideoAiSubtitleCacheIdentity(request);
    if (!identity) return null;
    const key = buildVideoAiSubtitleCacheKey(identity);
    return this.database.transaction('rw', this.database.entries, async () => {
      await this.pruneExpired(now);
      const entry = await this.database.entries.get(key);
      if (!entry) return null;
      await this.database.entries.update(key, {lastAccessedAt: now});
      return structuredClone(entry.cues);
    });
  }

  async set(request: VideoAiSubtitleCacheRequest, cues: unknown, now = Date.now()): Promise<boolean> {
    const identity = buildVideoAiSubtitleCacheIdentity(request);
    const normalizedCues = normalizeCompletedVideoAiSubtitleCues(cues);
    if (!identity || normalizedCues.length === 0) return false;
    const key = buildVideoAiSubtitleCacheKey(identity);
    return this.database.transaction('rw', this.database.entries, async () => {
      await this.pruneExpired(now);
      const existing = await this.database.entries.get(key);
      await this.database.entries.put({
        ...identity,
        key,
        cues: normalizedCues,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastAccessedAt: now,
        expiresAt: now + VIDEO_AI_SUBTITLE_CACHE_TTL_MS,
        bytes: serializedBytes(normalizedCues),
      });
      await this.pruneLru();
      return true;
    });
  }

  async stats(now = Date.now()): Promise<VideoAiSubtitleCacheStats> {
    return this.database.transaction('rw', this.database.entries, async () => {
      await this.pruneExpired(now);
      const entries = await this.database.entries.toArray();
      return {
        entries: entries.length,
        bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
        maxEntries: VIDEO_AI_SUBTITLE_CACHE_MAX_ENTRIES,
        ttlMs: VIDEO_AI_SUBTITLE_CACHE_TTL_MS,
      };
    });
  }

  async clear(): Promise<void> {
    await this.database.entries.clear();
  }
}

export const videoAiSubtitleCacheRepository = new VideoAiSubtitleCacheRepository();
