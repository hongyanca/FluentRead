/**
 * @file src/features/vocabulary/protocol.ts
 * 文件职责：定义内容页、设置页和后台之间使用的精简词书消息协议，避免前端调用者依赖完整 Dexie 领域实现及其浏览器副作用。
 * 主要内容：包含消息常量、收藏输入、列表与导出选项、动作联合、RuntimeMessage、统一成功/失败响应和 VocabularyBookChangedMessage。
 * 模块边界：协议文件只承载可序列化类型，不校验数据库记录、不计算复习计划也不发送消息；后台 handler 负责验证，learningModel/repository 保持权威领域状态。
 */
export const VOCABULARY_BOOK_MESSAGE = 'fluentReadVocabularyBook' as const;
export const VOCABULARY_BOOK_CHANGED_MESSAGE = 'fluentReadVocabularyBookChanged' as const;

export type VocabularyStatus = 'new' | 'learning' | 'mastered';
export type VocabularyReviewRating = 'again' | 'good' | 'manual-mastered' | 'relearn';
export type VocabularyScheduledReviewRating = Extract<VocabularyReviewRating, 'again' | 'good'>;

export interface VocabularyContextInput {
    text?: string;
    sourceUrl?: string;
    pageTitle?: string;
    capturedAt?: number;
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

export interface VocabularyExportOptions {
    includePrivateContext?: boolean;
    now?: number;
}

export type VocabularyBookErrorCode =
    | 'invalid-input'
    | 'not-found'
    | 'limit-exceeded'
    | 'invalid-export'
    | 'storage-error';

export type VocabularyBookAction =
    | 'list'
    | 'get'
    | 'getByTerm'
    | 'upsert'
    | 'review'
    | 'setMastery'
    | 'relearn'
    | 'getReviewLogs'
    | 'remove'
    | 'removeWithSnapshot'
    | 'clear'
    | 'exportData'
    | 'importData';

export interface VocabularyBookRuntimeMessage {
    type: typeof VOCABULARY_BOOK_MESSAGE;
    action?: VocabularyBookAction | unknown;
    entryId?: unknown;
    term?: unknown;
    word?: unknown;
    sourceLanguage?: unknown;
    rating?: unknown;
    input?: unknown;
    options?: unknown;
    data?: unknown;
}

export type VocabularyBookResponse<T = unknown> =
    | {success: true; data: T}
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
