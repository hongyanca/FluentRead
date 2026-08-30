/**
 * @file src/app/background/handlers/selectionTts.ts
 * 文件职责：汇总划词朗读在后台侧的公开协议与构造器，给 app 组合根提供单一、稳定的 Selection TTS 导入面。
 * 主要内容：重导出 Google TTS URL、播放/停止/状态消息常量、音频与上下文类型、ArrayBuffer 编码工具以及 createSelectionTtsBackgroundHandlers 工厂。
 * 模块边界：本文件只转发 selection-translation feature 的公开实现，不合成语音、不播放音频，也不维护请求路由；网络合成、Offscreen 传输和播放器分别由 feature service 与 app/offscreen 负责。
 */
export {
    arrayBufferToBase64,
    createSelectionTtsBackgroundHandlers,
    googleSelectionTtsUrl,
    SELECTION_TTS_GOOGLE_MESSAGE_TYPE,
    SELECTION_TTS_MESSAGE_TYPE,
    SELECTION_TTS_PLAYBACK_STATE_MESSAGE_TYPE,
    SELECTION_TTS_STOP_MESSAGE_TYPE,
    type SelectionTtsAudio,
    type SelectionTtsBackgroundDependencies,
    type SelectionTtsContext,
    type SelectionTtsRuntimeMessage,
} from '@/src/features/selection-translation/background/ttsHandler';
