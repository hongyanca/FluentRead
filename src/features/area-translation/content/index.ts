/**
 * @file src/features/area-translation/content/index.ts
 * 文件职责：提供圈选翻译网页运行时的 content 公共出口，让 feature registry 只依赖挂载、卸载和挂载状态三个生命周期能力。
 * 主要内容：文件从 runtime.ts 精确再导出 isAreaTranslatorMounted、mountAreaTranslator 与 unmountAreaTranslator，不暴露内部 Vue 实例、挂载 Promise 或请求所有权计数。
 * 模块边界：这里是无副作用的 barrel，不读取配置也不操作 DOM；Shadow UI 创建和迟到挂载清理由 runtime.ts 负责，更高层启停判断由 content composition root 统一编排。
 */
export {
    isAreaTranslatorMounted,
    mountAreaTranslator,
    unmountAreaTranslator,
} from './runtime';
