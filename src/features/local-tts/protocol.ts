/**
 * @file src/features/local-tts/protocol.ts
 * 文件职责：定义本地 TTS 跨后台、Offscreen 与其他 feature 共享的公开契约。
 * 主要内容：稳定错误码、对应的错误类、按错误码识别跨消息边界错误的 localTtsErrorCode，以及合成音频结果类型。
 * 模块边界：只包含可序列化数据和纯判定，不创建 Worker、不访问 Cache Storage；错误穿过 runtime 消息后只保留 code，
 * 调用方必须按错误码判断，不能依赖 instanceof。
 */

import type {SpeechCue} from '@/src/core/tts/speechProgress';

export const LOCAL_TTS_MODEL_NOT_DOWNLOADED_CODE = 'local-tts-model-not-downloaded' as const;
export const LOCAL_TTS_LANGUAGE_UNSUPPORTED_CODE = 'local-tts-language-unsupported' as const;

export class LocalTtsModelNotDownloadedError extends Error {
    readonly code = LOCAL_TTS_MODEL_NOT_DOWNLOADED_CODE;

    constructor() {
        super('本地 TTS 模型尚未下载，请先在设置中的朗读与语音里下载模型');
        this.name = 'LocalTtsModelNotDownloadedError';
    }
}

export class LocalTtsLanguageUnsupportedError extends Error {
    readonly code = LOCAL_TTS_LANGUAGE_UNSUPPORTED_CODE;

    constructor(language: string) {
        super(`本地 TTS 暂不支持语言：${language || '未知语言'}`);
        this.name = 'LocalTtsLanguageUnsupportedError';
    }
}


export interface LocalTtsAudio {
    readonly audio: ArrayBuffer;
    readonly timings?: SpeechCue[];
    readonly contentType: 'audio/wav';
    readonly voice: string;
    readonly backend?: 'webgpu' | 'wasm';
}

/** 读取本地错误类实例或 Offscreen 响应重建的普通 Error 上的稳定错误码。 */
export function localTtsErrorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && typeof (error as {code?: unknown}).code === 'string'
        ? (error as {code: string}).code
        : undefined;
}
