/**
 * @file src/services/translation/context/index.ts
 *
 * 文件职责：作为页面翻译上下文服务的聚合入口，对外暴露浏览器捕获实现与纯策略构建器。
 * 主要内容：统一转出 browser.ts 和 policy.ts，使调用方从单一入口获得上下文抓取、缓存重置、预算限制和文本规范化能力。 可核对的公开符号包括 聚合导出。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

export * from './browser';
export * from './policy';
