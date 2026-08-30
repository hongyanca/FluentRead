/**
 * @file src/features/vocabulary/learningModel.ts
 * 文件职责：定义单词本学习领域的完整数据模型与纯状态算法，覆盖收藏条目、上下文、掌握度、复习队列、会话推进、导入导出和错误协议。
 * 主要内容：包含容量与版本常量、Anki TSV 和 cloze 构建、复习队列协调、会话进度、生命周期 token guard，以及 VocabularyEntry、ReviewLog、BookRequest/Response 等权威类型。
 * 模块边界：此文件不访问 IndexedDB、浏览器消息或 UI；repository 负责持久化和清洗，protocol 提供轻量运行时镜像，VocabularyBook.vue 只调用这些纯函数驱动学习流程。
 */
export const VOCABULARY_BOOK_MESSAGE = 'fluentReadVocabularyBook' as const;
export const VOCABULARY_BOOK_CHANGED_MESSAGE = 'fluentReadVocabularyBookChanged' as const;

export const VOCABULARY_BOOK_EXPORT_FORMAT = 'fluentread-vocabulary-book' as const;
export const VOCABULARY_BOOK_EXPORT_VERSION = 1 as const;
export const VOCABULARY_ENTRY_SCHEMA_VERSION = 1 as const;

export const VOCABULARY_BOOK_MAX_ENTRIES = 5_000;
export const VOCABULARY_ENTRY_MAX_CONTEXTS = 8;
export const VOCABULARY_REVIEW_LOG_MAX_PER_ENTRY = 100;
export const VOCABULARY_LARGE_IMPORT_WARNING_BYTES = 20 * 1024 * 1024;

function sanitizeAnkiTsvCell(value: unknown): string {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/** 构建 Anki 文本导入格式，列名写入指令而不会被生成为卡片。 */
export function buildAnkiTsv(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const columnHeader = columns.map(sanitizeAnkiTsvCell).join('\t');
  const dataRows = rows.map(row => row.map(sanitizeAnkiTsvCell).join('\t'));
  return [
    '#separator:tab',
    '#html:false',
    `#columns:${columnHeader}`,
    ...dataRows,
  ].join('\n');
}

export function vocabularyImportNeedsConfirmation(fileSize: number): boolean {
  return Number.isFinite(fileSize) && fileSize > VOCABULARY_LARGE_IMPORT_WARNING_BYTES;
}

const VOCABULARY_WORD_CONTINUATION_CLASS = "\\p{L}\\p{M}\\p{N}'’‘\\-‐‑‒–—";

function vocabularyTermPattern(term: string): string {
  return [...term].map(character => {
    if ("'’‘".includes(character)) return "['’‘]";
    if ('-‐‑‒–—'.includes(character)) return '[-‐‑‒–—]';
    return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
}

/** 仅替换完整单词；无法安全生成挖空文本时返回空字符串。 */
export function buildVocabularyCloze(context: string, term: string): string {
  const source = String(context || '');
  const normalizedTerm = String(term || '').trim();
  if (!source || !normalizedTerm) return '';
  const termPattern = vocabularyTermPattern(normalizedTerm);
  const matcher = new RegExp(
    `(^|[^${VOCABULARY_WORD_CONTINUATION_CLASS}])(?:${termPattern})(?=$|[^${VOCABULARY_WORD_CONTINUATION_CLASS}])`,
    'giu',
  );
  let replacements = 0;
  const cloze = source.replace(matcher, (_match, prefix: string) => {
    replacements += 1;
    return `${prefix}____`;
  });
  return replacements > 0 ? cloze : '';
}

export type VocabularyMasteryLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type VocabularyStatus = 'new' | 'learning' | 'familiar' | 'mastered';
export type VocabularyReviewRating = 'again' | 'good' | 'manual-mastered' | 'relearn';
export type VocabularyScheduledReviewRating = Extract<VocabularyReviewRating, 'again' | 'good'>;

export interface VocabularyTranslationSnapshot {
  text: string;
  updatedAt: number;
}

export type VocabularyTranslations = Record<string, VocabularyTranslationSnapshot>;

export interface VocabularyContextInput {
  text: string;
  sourceUrl?: string;
  pageTitle?: string;
  capturedAt?: number;
}

export interface VocabularyContext {
  text: string;
  sourceUrl?: string;
  pageTitle?: string;
  capturedAt: number;
}

export interface VocabularyEntry {
  id: string;
  identityKey: string;
  sourceLanguage: string;
  term: string;
  normalizedTerm: string;
  translations: VocabularyTranslations;
  phonetic: string;
  partOfSpeech: string;
  contexts: VocabularyContext[];
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  encounterCount: number;
  masteryLevel: VocabularyMasteryLevel;
  status: VocabularyStatus;
  nextReviewAt: number | null;
  lastReviewedAt: number | null;
  reviewCount: number;
  lapseCount: number;
  schemaVersion: typeof VOCABULARY_ENTRY_SCHEMA_VERSION;
}

/**
 * 保持进行中的复习批次稳定，同时用最新持久化快照替换待复习卡片。已在其他位置
 * 删除或复习的卡片不再等待处理，无关的新到期卡片留到下一批次。
 */
export function reconcileVocabularyReviewQueue(
  queue: readonly VocabularyEntry[],
  latestEntries: readonly VocabularyEntry[],
  now = Date.now(),
): VocabularyEntry[] {
  const latestById = new Map(latestEntries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const reconciled: VocabularyEntry[] = [];

  for (const queuedEntry of queue) {
    if (seen.has(queuedEntry.id)) continue;
    seen.add(queuedEntry.id);
    const latest = latestById.get(queuedEntry.id);
    if (!latest || latest.nextReviewAt === null || latest.nextReviewAt > now) continue;
    reconciled.push(latest);
  }

  return reconciled;
}

export interface VocabularyReviewSessionState {
  queue: VocabularyEntry[];
  completed: number;
  answerVisible: boolean;
}

export interface VocabularyReviewSessionProgress {
  current: VocabularyEntry | null;
  position: number;
  total: number;
}

export function createVocabularyReviewSession(
  queue: readonly VocabularyEntry[],
): VocabularyReviewSessionState {
  return {
    queue: [...queue],
    completed: 0,
    answerVisible: false,
  };
}

export function advanceVocabularyReviewSession(
  session: VocabularyReviewSessionState,
  entryId: string,
): VocabularyReviewSessionState {
  const containsEntry = session.queue.some((entry) => entry.id === entryId);
  return {
    queue: session.queue[0]?.id === entryId
      ? session.queue.slice(1)
      : session.queue.filter((entry) => entry.id !== entryId),
    completed: session.completed + (containsEntry ? 1 : 0),
    answerVisible: false,
  };
}

export function reconcileVocabularyReviewSession(
  session: VocabularyReviewSessionState,
  latestEntries: readonly VocabularyEntry[],
  now = Date.now(),
): VocabularyReviewSessionState {
  const previous = session.queue[0];
  const queue = reconcileVocabularyReviewQueue(session.queue, latestEntries, now);
  const next = queue[0];
  const currentChanged = !previous
    || !next
    || previous.id !== next.id
    || previous.updatedAt !== next.updatedAt
    || previous.reviewCount !== next.reviewCount;
  return {
    queue,
    completed: session.completed,
    answerVisible: currentChanged ? false : session.answerVisible,
  };
}

export function vocabularyReviewSessionProgress(
  session: VocabularyReviewSessionState,
): VocabularyReviewSessionProgress {
  const current = session.queue[0] ?? null;
  const total = session.completed + session.queue.length;
  return {
    current,
    position: current ? Math.min(session.completed + 1, total) : total,
    total,
  };
}

export interface VocabularyLifecycleGuard {
  isActive(): boolean;
  dispose(): void;
  runAfterReady(
    ready: PromiseLike<unknown>,
    initialize: () => void | PromiseLike<void>,
  ): Promise<boolean>;
}

/** 防止异步 mounted hook 在组件卸载后继续注册任务。 */
export function createVocabularyLifecycleGuard(): VocabularyLifecycleGuard {
  let active = true;
  return {
    isActive: () => active,
    dispose: () => {
      active = false;
    },
    async runAfterReady(ready, initialize) {
      await ready;
      if (!active) return false;
      await initialize();
      return active;
    },
  };
}

export interface VocabularyReviewLog {
  id: string;
  entryId: string;
  rating: VocabularyReviewRating;
  reviewedAt: number;
  beforeLevel: VocabularyMasteryLevel;
  afterLevel: VocabularyMasteryLevel;
  nextReviewAt: number | null;
}

export interface VocabularyUpsertInput {
  sourceLanguage: string;
  targetLanguage: string;
  term: string;
  translation: string;
  phonetic?: string;
  partOfSpeech?: string | string[];
  context?: VocabularyContextInput;
  contexts?: VocabularyContextInput[];
}

export interface VocabularyListOptions {
  status?: VocabularyStatus | VocabularyStatus[];
  sourceLanguage?: string;
  targetLanguage?: string;
  search?: string;
  dueOnly?: boolean;
  now?: number;
  order?: 'recent' | 'due' | 'term';
  offset?: number;
  limit?: number;
}

export interface VocabularyReviewResult {
  entry: VocabularyEntry;
  log: VocabularyReviewLog;
}

export interface VocabularyRemovalSnapshot {
  entry: VocabularyEntry;
  reviewLogs: VocabularyReviewLog[];
}

/**
 * 导出中的上下文字段可选：隐私安全导出默认省略页面内容和位置，只保留采集时间。
 */
export interface VocabularyExportContext {
  capturedAt: number;
  text?: string;
  sourceUrl?: string;
  pageTitle?: string;
}

export type VocabularyExportEntry = Omit<VocabularyEntry, 'contexts'> & {
  contexts: VocabularyExportContext[];
};

export interface VocabularyBookExport {
  format: typeof VOCABULARY_BOOK_EXPORT_FORMAT;
  version: typeof VOCABULARY_BOOK_EXPORT_VERSION;
  exportedAt: number;
  includesPrivateContext: boolean;
  entries: VocabularyExportEntry[];
  reviewLogs: VocabularyReviewLog[];
}

export interface VocabularyExportOptions {
  includePrivateContext?: boolean;
  now?: number;
}

export interface VocabularyImportResult {
  inserted: number;
  updated: number;
  /** 无效、重复、发生冲突或因保留上限被裁剪的词条与日志数量。 */
  skipped: number;
  /** 按词条执行保留上限裁剪后仍存在的已导入复习日志数量。 */
  reviewLogsImported: number;
}

export type VocabularyBookErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'limit-exceeded'
  | 'invalid-export'
  | 'storage-error';

export type VocabularyGetByTermRequest = {
  type: typeof VOCABULARY_BOOK_MESSAGE;
  action: 'getByTerm';
  sourceLanguage: string;
  /** Beta 消息协议迁移期间保留，兼容仍使用 word 术语的调用方。 */
  targetLanguage?: string;
} & ({ term: string; word?: never } | { word: string; term?: never });

export type VocabularyBookRequest =
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'list'; options?: VocabularyListOptions }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'get'; entryId: string }
  | VocabularyGetByTermRequest
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'upsert'; input: VocabularyUpsertInput }
  | {
      type: typeof VOCABULARY_BOOK_MESSAGE;
      action: 'review';
      entryId: string;
      rating: VocabularyScheduledReviewRating;
    }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'setMastery'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'relearn'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'getReviewLogs'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'remove'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'removeWithSnapshot'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'clear' }
  | {
      type: typeof VOCABULARY_BOOK_MESSAGE;
      action: 'exportData';
      options?: VocabularyExportOptions;
    }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'importData'; data: unknown };

export type VocabularyBookResponse<T = unknown> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: VocabularyBookErrorCode;
        message: string;
      };
    };

export interface VocabularyBookChangedMessage {
  type: typeof VOCABULARY_BOOK_CHANGED_MESSAGE;
  reason:
    | 'upsert'
    | 'review'
    | 'manual-mastered'
    | 'relearn'
    | 'remove'
    | 'clear'
    | 'import';
  entryId?: string;
}
