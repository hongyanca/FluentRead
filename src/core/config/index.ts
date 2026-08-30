/**
 * @file src/core/config/index.ts
 *
 * 文件职责：作为 core/config 的公共聚合入口，向上层暴露经过约束的配置领域契约。
 * 主要内容：统一转出 catalog、constants、credentials、customBody、deeplx、model、selectionTts、transfer 与 validation，保持调用方不必依赖内部文件布局。 可核对的公开符号包括 聚合导出。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

export * from './catalog';
export * from './constants';
export * from './credentials';
export * from './customBody';
export * from './deeplx';
export * from './model';
export * from './selectionTts';
export * from './transfer';
export * from './validation';
