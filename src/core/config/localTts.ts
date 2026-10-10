/**
 * @file src/core/config/localTts.ts
 *
 * 文件职责：定义本地 TTS 模型、朗读策略和中英音色的稳定领域契约。
 * 主要内容：维护 Kokoro v1.1 中文模型的固定版本、下载元数据、语言判断和用户可选音色。
 * 模块边界：只处理纯配置与语言转换，不访问浏览器存储、模型缓存或推理运行时。
 */

export const LOCAL_TTS_MODEL_ID = 'kokoro-v1.1-zh' as const;
export const LOCAL_TTS_MODEL_REPOSITORY = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX' as const;
export const LOCAL_TTS_MODEL_REVISION = '6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3' as const;
export const LOCAL_TTS_MODEL_DTYPE = 'fp32' as const;
// 全精度模型避免半精度在部分中英文输入上生成 NaN；GPU 与 CPU 共用同一文件。
export const LOCAL_TTS_MODEL_FILE_NAME = 'model' as const;
export const LOCAL_TTS_MODEL_STATE_KEY = 'fluentReadLocalTtsModels' as const;
export const LOCAL_TTS_MODEL_CACHE_NAME = 'transformers-cache' as const;
export const LOCAL_TTS_VOICE_CACHE_NAME = 'kokoro-voices' as const;
export const LOCAL_TTS_VOICE_PATH = `https://huggingface.co/${LOCAL_TTS_MODEL_REPOSITORY}/resolve/${LOCAL_TTS_MODEL_REVISION}/voices` as const;

export type LocalTtsMode = 'online-first' | 'local-first' | 'online-only' | 'local-only';

export const LOCAL_TTS_MODE_OPTIONS: readonly {value: LocalTtsMode; label: string; description: string}[] = [
    {
        value: 'online-first',
        label: '在线优先',
        description: '先使用在线语音；在线失败且模型已下载时改用本地语音。',
    },
    {
        value: 'local-first',
        label: '本地优先',
        description: '优先在浏览器本地合成；本地不可用时再使用在线语音。',
    },
    {
        value: 'online-only',
        label: '仅在线',
        description: '不调用本地模型，继续使用在线语音和浏览器回退。',
    },
    {
        value: 'local-only',
        label: '仅本地',
        description: '只使用已下载的本地模型，不把朗读文本发送给在线 TTS。',
    },
] as const;

export interface LocalTtsVoiceOption {
    value: string;
    label: string;
    locale: 'zh-CN' | 'en-US' | 'en-GB';
    gender: 'Female' | 'Male';
}

export const LOCAL_TTS_VOICE_OPTIONS: readonly LocalTtsVoiceOption[] = [
    {value: 'auto', label: '按语言自动选择', locale: 'en-US', gender: 'Female'},
    {value: 'zf_001', label: '中文女声 001', locale: 'zh-CN', gender: 'Female'},
    {value: 'zf_002', label: '中文女声 002', locale: 'zh-CN', gender: 'Female'},
    {value: 'zf_003', label: '中文女声 003', locale: 'zh-CN', gender: 'Female'},
    {value: 'zm_009', label: '中文男声 009', locale: 'zh-CN', gender: 'Male'},
    {value: 'zm_010', label: '中文男声 010', locale: 'zh-CN', gender: 'Male'},
    {value: 'af_maple', label: 'American English · Maple', locale: 'en-US', gender: 'Female'},
    {value: 'af_sol', label: 'American English · Sol', locale: 'en-US', gender: 'Female'},
    {value: 'bf_vale', label: 'British English · Vale', locale: 'en-GB', gender: 'Female'},
] as const;

export const LOCAL_TTS_MODEL = {
    value: LOCAL_TTS_MODEL_ID,
    repository: LOCAL_TTS_MODEL_REPOSITORY,
    revision: LOCAL_TTS_MODEL_REVISION,
    dtype: LOCAL_TTS_MODEL_DTYPE,
    modelFileName: LOCAL_TTS_MODEL_FILE_NAME,
    label: 'Kokoro 中文与英语',
    description: '浏览器本地合成中文、英语和中英混排文本；首次使用前需要主动下载模型。',
    downloadSizeMb: 343,
    voices: ['zf_001', 'zm_009', 'af_maple', 'bf_vale'],
} as const;

export type LocalTtsVoiceId = typeof LOCAL_TTS_VOICE_OPTIONS[number]['value'];

export const DEFAULT_LOCAL_TTS_MODE: LocalTtsMode = 'online-first';
export const DEFAULT_LOCAL_TTS_VOICE: LocalTtsVoiceId = 'auto';

export function normalizeLocalTtsMode(value: unknown): LocalTtsMode {
    return LOCAL_TTS_MODE_OPTIONS.some((option) => option.value === value)
        ? value as LocalTtsMode
        : DEFAULT_LOCAL_TTS_MODE;
}

export function normalizeLocalTtsVoice(value: unknown): LocalTtsVoiceId {
    return LOCAL_TTS_VOICE_OPTIONS.some((option) => option.value === value)
        ? value as LocalTtsVoiceId
        : DEFAULT_LOCAL_TTS_VOICE;
}

function normalizeLanguage(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/_/gu, '-').toLowerCase() : '';
}

export function localTtsLanguageFamily(value: unknown): 'zh' | 'en' | null {
    const language = normalizeLanguage(value);
    if (language === 'cmn' || language === 'zho' || language.startsWith('zh-') || language === 'zh') return 'zh';
    if (language === 'eng' || language === 'en' || language.startsWith('en-')) return 'en';
    return null;
}

export function supportsLocalTtsLanguage(value: unknown): boolean {
    return localTtsLanguageFamily(value) !== null;
}

export function localTtsVoiceForLanguage(language: unknown, preferredVoice: unknown): string {
    const family = localTtsLanguageFamily(language);
    const preferred = normalizeLocalTtsVoice(preferredVoice);
    if (preferred !== 'auto') {
        const preferredOption = LOCAL_TTS_VOICE_OPTIONS.find((item) => item.value === preferred);
        if (preferredOption && ((family === 'zh' && preferredOption.locale === 'zh-CN')
            || (family === 'en' && (preferredOption.locale === 'en-US' || preferredOption.locale === 'en-GB')))) {
            return preferred;
        }
    }
    return family === 'zh' ? 'zf_001' : 'af_maple';
}
