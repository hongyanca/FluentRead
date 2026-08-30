/**
 * @file src/app/background/handlers/fullPageTranslationState.ts
 * 文件职责：提供全文翻译标签页状态 handler 的 app 层稳定入口，供后台消息运行时与右键菜单组合代码统一引用。
 * 主要内容：转发 full-page-translation feature 的状态查询、状态更新消息处理器及其公开类型，使翻译中、已翻译和恢复态可以按 tab 维护。
 * 模块边界：此文件只重导出公开后台契约，不保存状态、不操作 DOM、不触发全文翻译；状态规则属于 feature，实现存储由 TabTranslationStateStore 等依赖负责。
 */
export * from '@/src/features/full-page-translation/background';
