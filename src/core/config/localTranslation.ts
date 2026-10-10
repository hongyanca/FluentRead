/**
 * @file src/core/config/localTranslation.ts
 *
 * 文件职责：定义浏览器本地翻译模型目录、下载状态键和产品语言到模型语言码的映射。
 * 主要内容：提供中英/日英轻量语言包、混元翻译和旧模型兼容目录，定义持久下载任务与语言转换契约。
 * 模块边界：只处理纯配置与语言转换，不访问浏览器存储、模型缓存或推理运行时。
 */
import {detectlang} from '@/src/core/language/detect';
import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';
import {normalizeDetectedLanguageCode} from '@/src/core/language/codes';

export const LOCAL_TRANSLATION_SERVICE_ID = 'localTranslation' as const;
export const LOCAL_TRANSLATION_MODEL_STATE_KEY = 'fluentReadLocalTranslationModels' as const;
export const LOCAL_TRANSLATION_DOWNLOAD_STATE_KEY = 'fluentReadLocalTranslationDownloadsV2' as const;
export const LOCAL_TRANSLATION_DTYPE = 'q8' as const;
export const LOCAL_TRANSLATION_MODEL_REMOTE_HOST = 'https://huggingface.co/' as const;
export const LOCAL_TRANSLATION_MODEL_REVISION = 'main' as const;

export const LOCAL_TRANSLATION_MODEL_IDS = {
    opusZhEn: 'fluentread/opus-zh-en',
    opusJaEn: 'fluentread/opus-ja-en',
    hunyuan: 'tencent/Hy-MT2-1.8B-GGUF',
    m2m100: 'Xenova/m2m100_418M',
    nllb: 'Xenova/nllb-200-distilled-600M',
} as const;

export type LocalTranslationModelId = typeof LOCAL_TRANSLATION_MODEL_IDS[keyof typeof LOCAL_TRANSLATION_MODEL_IDS];

export interface LocalTranslationModel {
    value: LocalTranslationModelId;
    label: string;
    descriptionKey: string;
    nameKey?: string;
    languagesKey: string;
    downloadSizeMb: number;
    memoryMb: readonly [number, number];
    engine: 'opus' | 'hunyuan' | 'legacy';
    repositories: readonly string[];
    legacy?: boolean;
}

export type LocalTranslationDownloadPhase = 'idle' | 'queued' | 'downloading' | 'verifying' | 'paused' | 'ready' | 'error' | 'removing';
export interface LocalTranslationDownloadState {
    model: LocalTranslationModelId;
    phase: LocalTranslationDownloadPhase;
    downloadedBytes: number;
    totalBytes: number;
    bytesPerSecond: number;
    updatedAt: number;
    error?: 'network' | 'storage' | 'integrity' | 'unknown';
}
export interface LocalTranslationDownloadSnapshot {
    version: 2;
    tasks: LocalTranslationDownloadState[];
}

export const LOCAL_TRANSLATION_MODELS: readonly LocalTranslationModel[] = [
    {
        value: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn,
        label: 'OPUS-MT Chinese / English',
        nameKey: 'settings.localTranslation.opusZhEn',
        descriptionKey: 'settings.localTranslation.opusZhEnDescription',
        languagesKey: 'settings.localTranslation.languagesZhEn',
        downloadSizeMb: 239,
        memoryMb: [500, 2000],
        engine: 'opus',
        repositories: ['Xenova/opus-mt-en-zh', 'Xenova/opus-mt-zh-en'],
    },
    {
        value: LOCAL_TRANSLATION_MODEL_IDS.hunyuan,
        label: 'Hy-MT2 1.8B',
        nameKey: 'settings.localTranslation.hunyuan',
        descriptionKey: 'settings.localTranslation.hunyuanDescription',
        languagesKey: 'settings.localTranslation.languagesHunyuan',
        downloadSizeMb: 1133,
        memoryMb: [1500, 2500],
        engine: 'hunyuan',
        repositories: ['tencent/Hy-MT2-1.8B-GGUF'],
    },
    {
        value: LOCAL_TRANSLATION_MODEL_IDS.opusJaEn,
        label: 'OPUS-MT Japanese / English',
        nameKey: 'settings.localTranslation.opusJaEn',
        descriptionKey: 'settings.localTranslation.opusJaEnDescription',
        languagesKey: 'settings.localTranslation.languagesJaEn',
        downloadSizeMb: 214,
        memoryMb: [500, 2000],
        engine: 'opus',
        repositories: ['Xenova/opus-mt-ja-en', 'Xenova/opus-mt-en-jap'],
    },
    {
        value: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
        label: 'M2M100 418M',
        descriptionKey: 'settings.localTranslation.model.m2m100Description',
        downloadSizeMb: 630,
        memoryMb: [1200, 2200],
        languagesKey: 'settings.localTranslation.languagesLegacy',
        engine: 'legacy', repositories: ['Xenova/m2m100_418M'], legacy: true,
    },
    {
        value: LOCAL_TRANSLATION_MODEL_IDS.nllb,
        label: 'NLLB-200 Distilled 600M',
        descriptionKey: 'settings.localTranslation.model.nllbDescription',
        downloadSizeMb: 990,
        memoryMb: [1800, 3000],
        languagesKey: 'settings.localTranslation.languagesLegacy',
        engine: 'legacy', repositories: ['Xenova/nllb-200-distilled-600M'], legacy: true,
    },
] as const;

export const DEFAULT_LOCAL_TRANSLATION_MODEL = LOCAL_TRANSLATION_MODEL_IDS.opusZhEn;

export function getLocalTranslationModel(value: unknown): LocalTranslationModel {
    return LOCAL_TRANSLATION_MODELS.find((model) => model.value === value) || LOCAL_TRANSLATION_MODELS[0]!;
}

export function isLocalTranslationModel(value: unknown): value is LocalTranslationModelId {
    return LOCAL_TRANSLATION_MODELS.some((model) => model.value === value);
}

export function normalizeLocalTranslationModel(value: unknown): LocalTranslationModelId {
    return isLocalTranslationModel(value) ? value : DEFAULT_LOCAL_TRANSLATION_MODEL;
}

export function normalizeLocalTranslationDownloadSnapshot(value: unknown): LocalTranslationDownloadSnapshot | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const snapshot = value as Partial<LocalTranslationDownloadSnapshot>;
    if (snapshot.version !== 2 || !Array.isArray(snapshot.tasks)) return undefined;
    const phases: readonly string[] = ['idle', 'queued', 'downloading', 'verifying', 'paused', 'ready', 'error', 'removing'];
    const tasks: LocalTranslationDownloadState[] = [];
    for (const item of snapshot.tasks) {
        if (!item || !isLocalTranslationModel(item.model) || !phases.includes(item.phase)) return undefined;
        if (tasks.some((task) => task.model === item.model)) return undefined;
        const numbers = [item.downloadedBytes, item.totalBytes, item.bytesPerSecond, item.updatedAt];
        if (numbers.some((number) => typeof number !== 'number' || !Number.isFinite(number) || number < 0)) return undefined;
        if (item.downloadedBytes > item.totalBytes) return undefined;
        tasks.push({
            model: item.model, phase: item.phase, downloadedBytes: item.downloadedBytes,
            totalBytes: item.totalBytes, bytesPerSecond: item.bytesPerSecond, updatedAt: item.updatedAt,
            error: ['network', 'storage', 'integrity', 'unknown'].includes(item.error || '') ? item.error : undefined,
        });
    }
    return {version: 2, tasks};
}

// 本地模型词表沿用 ISO 639-1 旧写法：挪威语为 no，他加禄语/菲律宾语为 tl。
const LOCAL_MODEL_BASE_ALIASES: Readonly<Record<string, string>> = {nb: 'no', fil: 'tl'};

const M2M100_LANGUAGE_CODES: Readonly<Record<string, string>> = {
    af: 'af', ar: 'ar', bg: 'bg', bn: 'bn', cs: 'cs', da: 'da', de: 'de', el: 'el',
    en: 'en', es: 'es', et: 'et', fa: 'fa', fi: 'fi', fr: 'fr', he: 'he', hi: 'hi',
    hr: 'hr', hu: 'hu', id: 'id', it: 'it', ja: 'ja', ko: 'ko', kn: 'kn', lt: 'lt',
    lv: 'lv', ml: 'ml', mr: 'mr', ms: 'ms', nl: 'nl', no: 'no', pa: 'pa', pl: 'pl',
    pt: 'pt', ro: 'ro', ru: 'ru', si: 'si', sk: 'sk', sl: 'sl', sr: 'sr', sv: 'sv',
    sw: 'sw', ta: 'ta', te: 'te', th: 'th', tr: 'tr', uk: 'uk', ur: 'ur', vi: 'vi',
    zh: 'zh',
};

const NLLB_LANGUAGE_CODES: Readonly<Record<string, string>> = {
    af: 'afr_Latn', ar: 'arb_Arab', bg: 'bul_Cyrl', bn: 'ben_Beng', cs: 'ces_Latn',
    da: 'dan_Latn', de: 'deu_Latn', el: 'ell_Grek', en: 'eng_Latn', es: 'spa_Latn',
    et: 'est_Latn', fa: 'pes_Arab', fi: 'fin_Latn', fr: 'fra_Latn', he: 'heb_Hebr',
    hi: 'hin_Deva', hr: 'hrv_Latn', hu: 'hun_Latn', id: 'ind_Latn', it: 'ita_Latn',
    ja: 'jpn_Jpan', kn: 'kan_Knda', ko: 'kor_Hang', lt: 'lit_Latn', lv: 'lvs_Latn',
    ml: 'mal_Mlym', mr: 'mar_Deva', ms: 'zsm_Latn', nl: 'nld_Latn', no: 'nno_Latn',
    pa: 'pan_Guru', pl: 'pol_Latn', pt: 'por_Latn', ro: 'ron_Latn', ru: 'rus_Cyrl',
    si: 'sin_Sinh', sk: 'slk_Latn', sl: 'slv_Latn', sr: 'srp_Cyrl', sv: 'swe_Latn',
    sw: 'swh_Latn', ta: 'tam_Taml', te: 'tel_Telu', th: 'tha_Thai', tr: 'tur_Latn',
    uk: 'ukr_Cyrl', ur: 'urd_Arab', vi: 'vie_Latn',
    'zh-Hans': 'zho_Hans', 'zh-Hant': 'zho_Hant', zh: 'zho_Hans',
};

function languageBase(value: string): string {
    const canonical = normalizeDetectedLanguageCode(value) || value.trim().toLowerCase();
    const base = canonical.split('-')[0]!;
    return LOCAL_MODEL_BASE_ALIASES[base] ?? base;
}

function modelFamily(model: LocalTranslationModelId): 'm2m100' | 'nllb' {
    return model === LOCAL_TRANSLATION_MODEL_IDS.nllb ? 'nllb' : 'm2m100';
}

/** 把 FluentRead 的语言码转换为所选模型 tokenizer 接受的语言码。 */
export function resolveLocalTranslationLanguageCode(
    modelValue: unknown,
    languageValue: unknown,
    textForAutoDetection = '',
): string {
    const model = normalizeLocalTranslationModel(modelValue);
    const raw = typeof languageValue === 'string' ? languageValue.trim() : '';
    let normalized = raw && raw.toLowerCase() !== 'auto'
        ? normalizeChineseLanguageCode(raw)
        : '';
    if (!normalized) {
        if (!textForAutoDetection.trim()) throw new Error('本地模型无法自动识别空文本，请指定源语言');
        normalized = detectlang(textForAutoDetection);
    }

    const base = languageBase(normalized);
    const engine = getLocalTranslationModel(model).engine;
    if (engine === 'opus') {
        const allowed = model === LOCAL_TRANSLATION_MODEL_IDS.opusZhEn ? ['zh', 'en'] : ['ja', 'en'];
        if (allowed.includes(base)) return base;
        throw new Error('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED');
    }
    if (engine === 'hunyuan') {
        if (normalized === 'zh-Hant') return 'zh-Hant';
        if (HUNYUAN_LANGUAGE_NAMES[base]) return base;
        throw new Error('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED');
    }
    if (modelFamily(model) === 'nllb') {
        const nllbKey = normalized === 'zh-Hans' || normalized === 'zh-Hant' ? normalized : base;
        const code = NLLB_LANGUAGE_CODES[nllbKey];
        if (code) return code;
    } else {
        const code = M2M100_LANGUAGE_CODES[base];
        if (code) return code;
    }

    throw new Error(`本地模型暂不支持语言：${raw || normalized}`);
}

export const HUNYUAN_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
    zh: 'Chinese', en: 'English', ja: 'Japanese', fr: 'French', pt: 'Portuguese',
    es: 'Spanish', tr: 'Turkish', ru: 'Russian', ar: 'Arabic', ko: 'Korean', th: 'Thai',
    it: 'Italian', de: 'German', vi: 'Vietnamese', ms: 'Malay', id: 'Indonesian', tl: 'Filipino',
    hi: 'Hindi', 'zh-Hant': 'Traditional Chinese', pl: 'Polish', cs: 'Czech', nl: 'Dutch',
    km: 'Khmer', my: 'Burmese', fa: 'Persian', gu: 'Gujarati', ur: 'Urdu', te: 'Telugu',
    mr: 'Marathi', he: 'Hebrew', bn: 'Bengali', ta: 'Tamil', uk: 'Ukrainian',
    bo: 'Tibetan', kk: 'Kazakh', mn: 'Mongolian', ug: 'Uyghur', yue: 'Cantonese',
};

export function resolveOpusTranslationRepository(model: unknown, source: string, target: string): string {
    const item = getLocalTranslationModel(model);
    const pair = `${source}-${target === 'ja' ? 'jap' : target}`;
    const repository = `Xenova/opus-mt-${pair}`;
    if (item.engine !== 'opus' || !item.repositories.includes(repository)) {
        throw new Error('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED');
    }
    return repository;
}

export function localTranslationErrorKey(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('LOCAL_TRANSLATION_NOT_DOWNLOADED')) return 'settings.localTranslation.error.notDownloaded';
    if (message.includes('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED')) return 'settings.localTranslation.error.language';
    if (/LOCAL_TRANSLATION_(REPETITION|OUTPUT_LIMIT|EMPTY)/u.test(message)) return 'settings.localTranslation.error.repetition';
    if (message.includes('LOCAL_TRANSLATION_TIMEOUT') || /超时|超过|timeout/iu.test(message)) return 'settings.localTranslation.error.timeout';
    if (message.includes('LOCAL_TRANSLATION_MODEL_REMOVED')) return 'settings.localTranslation.error.removed';
    if (message.includes('LOCAL_TRANSLATION_BROWSER_UNSUPPORTED')) return 'settings.localTranslation.error.browser';
    return 'settings.localTranslation.trialError';
}
