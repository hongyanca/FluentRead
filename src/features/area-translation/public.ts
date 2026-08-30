/**
 * @file src/features/area-translation/public.ts
 * 文件职责：定义圈选翻译 feature 面向其他层的最小公共表面，集中暴露必要的选区类型、截图坐标换算函数和 content 生命周期操作。
 * 主要内容：从 core.ts 导出 areaRectToImageCrop 与 AreaTranslationSelection，并从 content 入口导出 isAreaTranslatorMounted、mountAreaTranslator、unmountAreaTranslator。
 * 模块边界：此公共出口刻意不泄露后台消息细节、Vue 组件和 Offscreen 适配器；调用者应通过这里依赖稳定契约，后台 composition root 则使用 background 子路径完成注册。
 */
export {
    areaRectToImageCrop,
    type AreaTranslationSelection,
} from './core';
export {
    isAreaTranslatorMounted,
    mountAreaTranslator,
    unmountAreaTranslator,
} from './content';
