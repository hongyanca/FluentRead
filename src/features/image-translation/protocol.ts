/**
 * @file src/features/image-translation/protocol.ts
 * 文件职责：汇总图片与圈选翻译共用的可取消 OCR 消息契约，避免其他 feature 通过 UI 公共入口加载图片翻译组件。
 * 主要内容：再导出 content 客户端取消发送器、background 操作注册表、Offscreen 操作参数，以及供圈选复用的阶段消息类型与阶段类型。
 * 模块边界：本文件只声明跨 feature 的协议出口，不挂载 UI、不注册 runtime listener，也不直接运行 OCR Worker。
 */
export {
    createImageOperationRegistry,
    type ImageOperationOptions,
} from './background/handlers';
export type {ImageOffscreenOperationOptions} from './background/offscreenAdapter';
export {
    sendCancellableImageOperation,
    type ImageExtensionOperationOptions,
} from './services/client';
export {
    IMAGE_PROGRESS_MESSAGE_TYPE,
    type ImageTranslationStage,
} from './progress';
