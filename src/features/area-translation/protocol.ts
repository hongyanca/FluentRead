/**
 * @file src/features/area-translation/protocol.ts
 * 文件职责：提供圈选截图与 Offscreen 图片处理之间可跨 feature 复用的纯坐标协议，避免调用方加载圈选翻译的 content 运行时。
 * 主要内容：从纯 core 模块导出 AreaTranslationSelection 类型和 areaRectToImageCrop 坐标换算函数。
 * 模块边界：该协议不导出 UI 挂载函数、不读取配置或浏览器 storage；内容页生命周期继续由 area-translation/public.ts 暴露。
 */
export {
    areaRectToImageCrop,
    type AreaTranslationSelection,
} from './core';
