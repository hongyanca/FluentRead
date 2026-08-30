/**
 * @file src/features/full-page-translation/content/layout.ts
 * 文件职责：提供全文译文显示时解除宿主页面截断的兼容入口，使 line-clamp、固定高度或 overflow 限制不会遮住已经插入的双语内容。
 * 主要内容：文件汇集需观察的布局属性与祖先选择规则，并通过 ensureTranslationTruncationLayout 委托 state 模块申请、协调和复核共享样式覆盖。
 * 模块边界：这里不持有翻译文本和 DOM 生命周期，只是布局策略门面；覆盖所有权、MutationObserver 与恢复逻辑集中在 state.ts，译文节点创建由 renderer.ts 负责。
 */
import {
    ensureTranslationTruncationLayout as ensureStateTranslationTruncationLayout,
} from "@/src/features/full-page-translation/content/state";

/**
 * 全文翻译布局出口。
 *
 * 步骤 1：runtime/renderer 只依赖 content/layout 这个稳定命名。
 * 步骤 2：现阶段实际租约状态仍由 state 模块持有，后续可继续从 state 拆出。
 */
export function ensureTranslationTruncationLayout(owner: HTMLElement): boolean {
    return ensureStateTranslationTruncationLayout(owner);
}
