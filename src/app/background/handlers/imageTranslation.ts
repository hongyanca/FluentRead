/**
 * @file src/app/background/handlers/imageTranslation.ts
 * 文件职责：作为图片翻译后台能力的组合层入口，向 app/background/messageRuntime 暴露 feature 定义的 handler 与语言仓库契约。
 * 主要内容：统一转发图片 OCR、图片翻译、语言包管理以及相关消息类型，避免后台组合根跨越公开边界读取 image-translation 内部模块。
 * 模块边界：本文件没有图像解析、OCR Worker、翻译绘制或持久化逻辑；能力探测由 capabilityRegistry 处理，具体实现位于 image-translation feature 和 Offscreen 适配器。
 */
export * from '@/src/features/image-translation/background';
