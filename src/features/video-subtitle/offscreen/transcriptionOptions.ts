/**
 * @file src/features/video-subtitle/offscreen/transcriptionOptions.ts
 * 文件职责：构建每次 Whisper 转写调用独立的 generation options，隔离显式语言与 auto 模式。
 * 主要内容：规范化视频源语言、读取语言置信度、保留 Tiny 时长预算和 Base/Small 多语种解码容量，固定 transcribe 任务并限制 n-gram 循环。
 * 模块边界：只处理纯参数，不访问 Worker、模型、浏览器 API 或页面配置。
 */

import {normalizeVideoLocalTranscriptionModel} from '@/src/features/video-subtitle/transcription';

// Base/Small decoder context 为 448；当前 transcribe/timestamps prompt 为 3。
// 留出 5 个位置；Tiny 保留已验证的时长预算，避免高容量放大弱模型的重复输出。
const MAX_WHISPER_NEW_TOKENS = 440;

export interface WhisperTranscriptionGenerationOptions {
  [key: string]: unknown;
  return_timestamps: true;
  force_full_sequences: false;
  max_new_tokens: number;
  do_sample: false;
  num_beams: 1;
  no_repeat_ngram_size: number;
  stopping_criteria: unknown;
  language: string | null;
  task: 'transcribe';
}

export interface WhisperLanguageLogits {
  readonly data: ArrayLike<number>;
  readonly dims?: readonly number[];
}

export interface WhisperLanguageDetectionConfig {
  readonly isMultilingual?: unknown;
  readonly langToId?: unknown;
}

export interface WhisperDetectedLanguage {
  readonly language: string;
  readonly confidence: number;
}

export function normalizeWhisperSourceLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'auto' || normalized === 'automatic') return null;
  return normalized.split(/[-_]/, 1)[0] || null;
}

function languageCodeFromToken(value: string): string | null {
  const match = value.trim().match(/^<\|([^|]+)\|>$/u);
  if (!match) return null;
  const language = normalizeWhisperSourceLanguage(match[1]);
  return /^[a-z]{2,3}$/u.test(language || '') ? language : null;
}

/**
 * 读取 Whisper 首个 decoder step 的语言 token logits。Transformers.js
 * 3.8.1 在 language 为空时直接写死 en；调用方必须先用此 helper 做一次
 * language-token 选择，再把结果传给正常 transcribe generation。
 */
export function chooseWhisperSourceLanguage(
  logits: WhisperLanguageLogits | null | undefined,
  config: WhisperLanguageDetectionConfig,
): WhisperDetectedLanguage | null {
  if (!logits || config.isMultilingual === false) return null;
  if (!logits.data || typeof (logits.data as {length?: unknown}).length !== 'number') return null;
  if (!config.langToId || typeof config.langToId !== 'object') return null;
  const candidates = Object.entries(config.langToId as Record<string, unknown>)
    .flatMap(([token, value]) => {
      const language = languageCodeFromToken(token);
      const id = typeof value === 'number' && Number.isInteger(value) ? value : Number(value);
      return language && Number.isSafeInteger(id) && id >= 0 ? [{language, id}] : [];
    });
  if (candidates.length === 0) return null;
  const dimensions = logits.dims || [];
  const vocabSize = dimensions.length > 0 ? dimensions[dimensions.length - 1] : logits.data.length;
  if (!Number.isInteger(vocabSize) || vocabSize <= 0 || vocabSize > logits.data.length) return null;
  const offset = logits.data.length - vocabSize;
  let best: {language: string; score: number} | null = null;
  let normalizer = -Infinity;
  for (const candidate of candidates) {
    const score = Number(logits.data[offset + candidate.id]);
    if (!Number.isFinite(score)) continue;
    normalizer = Math.max(normalizer, score);
    if (!best || score > best.score) best = {language: candidate.language, score};
  }
  if (!best || !Number.isFinite(normalizer)) return null;
  let probabilitySum = 0;
  for (const candidate of candidates) {
    const score = Number(logits.data[offset + candidate.id]);
    if (Number.isFinite(score)) probabilitySum += Math.exp(score - normalizer);
  }
  const confidence = Math.exp(best.score - normalizer) / probabilitySum;
  return {language: best.language, confidence};
}

export function buildWhisperTranscriptionGenerationOptions(
  model: unknown,
  sourceLanguage: unknown,
  audioSeconds: number,
  stoppingCriteria: unknown,
): WhisperTranscriptionGenerationOptions {
  const language = normalizeWhisperSourceLanguage(sourceLanguage);
  const tinyBudget = language === 'zh' || language === 'ja' || language === 'ko'
    ? {maximum: 128, perSecond: 10}
    : {maximum: 64, perSecond: 6};
  const seconds = Number.isFinite(audioSeconds) ? Math.max(0, audioSeconds) : 0;
  const maxNewTokens = normalizeVideoLocalTranscriptionModel(model) === 'tiny'
    ? Math.min(tinyBudget.maximum, Math.max(24, Math.ceil(seconds * tinyBudget.perSecond)))
    : MAX_WHISPER_NEW_TOKENS;
  return {
    return_timestamps: true,
    force_full_sequences: false,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    num_beams: 1,
    // 在当前 Transformers.js 3.8.1 支持的 logits processor 层阻止长串重复，保留普通叠词。
    no_repeat_ngram_size: 8,
    stopping_criteria: stoppingCriteria,
    language,
    task: 'transcribe',
  };
}
