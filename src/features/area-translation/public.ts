/**
 * @file src/features/area-translation/public.ts
 * 文件职责：定义圈选翻译 feature 面向内容组合根的最小公共表面，只暴露按需入口与 content 生命周期操作。
 * 主要内容：从 content 入口导出入口状态、注册、卸载与右键触发操作；选区类型和截图坐标换算由 protocol 提供。
 * 模块边界：此公共出口刻意不泄露后台消息细节、Vue 组件和 Offscreen 适配器；userscript 以同名不支持实现替换本文件，后台 composition root 使用 background 子路径完成注册。
 */
export {
    isAreaTranslatorMounted,
    mountAreaTranslator,
    startAreaTranslationFromContextMenu,
    unmountAreaTranslator,
} from './content';
