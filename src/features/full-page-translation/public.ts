/**
 * @file src/features/full-page-translation/public.ts
 * 文件职责：汇总全文翻译 feature 给其他模块使用的稳定能力，覆盖页面翻译控制、进度面板生命周期和进度状态订阅。
 * 主要内容：精确再导出 autoTranslateEnglishPage、handleTranslation、restoreOriginalContent、活动状态与悬浮取消函数，以及进度面板 mount/unmount 和 progress 的读写订阅契约。
 * 模块边界：公共出口不暴露 FullPageSession、DOM 状态机或指示器实现；content composition root 与 floating-ball 应依赖此处，内部 renderer/state/background 仍通过各自子路径组装。
 */
export {
    autoTranslateEnglishPage,
    cancelPendingHoverTranslation,
    handleTranslation,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from './content/runtime';
export {
    mountTranslationProgressPanel,
    unmountTranslationProgressPanel,
} from './content/progressPanel';
export {
    finishFullPageTranslationProgress,
    getFullPageTranslationProgress,
    startFullPageTranslationProgress,
    subscribeFullPageTranslationProgress,
    updateFullPageTranslationProgress,
    type FullPageTranslationProgress,
} from './progress';
