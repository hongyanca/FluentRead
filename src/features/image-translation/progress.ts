/**
 * @file src/features/image-translation/progress.ts
 * 文件职责：定义图片翻译阶段通知并校验跨上下文数据，防止界面显示与实际处理步骤脱节。
 * 主要内容：统一模型准备、识别、翻译、生成译图阶段和消息类型；通知只包含请求标识、阶段与可选真实百分比，不广播图片或文字。
 * 模块边界：纯协议模块不监听浏览器消息；Offscreen 发布进度，后台按请求所有者转发，客户端负责订阅与清理。
 */
export const IMAGE_PROGRESS_MESSAGE_TYPE = 'fluentReadImageProgress' as const;
export type ImageTranslationStage = 'preparing' | 'initializing' | 'recognizing' | 'translating' | 'cleaning' | 'rendering';
export function isImageTranslationStage(value: unknown): value is ImageTranslationStage {
    return value === 'preparing' || value === 'initializing' || value === 'recognizing' || value === 'translating' || value === 'cleaning' || value === 'rendering';
}

/** 仅接受引擎提供的有效百分比，兼容仅有阶段的旧消息。 */
export function normalizeImageProgress(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
        ? Math.floor(value) : undefined;
}
