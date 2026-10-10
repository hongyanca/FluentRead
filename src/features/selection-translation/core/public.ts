/**
 * @file src/features/selection-translation/core/public.ts
 * 文件职责：向其他阅读功能提供不加载 Vue 覆盖层的选区纯算法出口。
 * 主要内容：再导出选区上下文裁剪纯算法；英文词形规范化由词典与学习收藏各自的来源模块提供，页面挂载和词典请求不在这个入口初始化。
 * 模块边界：保持无浏览器副作用，供 Harness 的正文快照复用选区位置及字符预算规则。
 */
export {summarizeSelectionContext} from '../core';
