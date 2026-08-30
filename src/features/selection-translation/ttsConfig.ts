/**
 * @file src/features/selection-translation/ttsConfig.ts
 * 文件职责：保留划词朗读配置在 feature 路径下的兼容公共入口，使既有调用者可以继续取得核心配置模型而不复制类型与默认值。
 * 主要内容：文件完整再导出 src/core/config/selectionTts 中的语音服务、声音偏好和相关规范化契约，未声明新的 feature 本地状态。
 * 模块边界：该模块是单向兼容壳，不得加入浏览器存储、TTS 网络或 UI 逻辑；配置权威实现位于 core/config，新代码应优先依赖核心公共路径。
 */
/** 划词翻译 feature 对配置领域中 TTS 选项的公开出口。 */
export * from '@/src/core/config/selectionTts';
