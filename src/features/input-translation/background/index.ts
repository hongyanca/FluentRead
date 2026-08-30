/**
 * @file src/features/input-translation/background/index.ts
 * 文件职责：作为输入框翻译后台子模块入口，集中转发 handler.ts 的消息协议、依赖类型和处理器工厂给应用级后台注册表。
 * 主要内容：主要内容只有对 ./handler 的完整再导出，确保调用方无需耦合具体文件名即可注册 inputBoxTranslation 消息。
 * 模块边界：该 barrel 不创建 handler 实例、不访问 browser.runtime 也不调用翻译；实例化与路由属于 src/app/background，输入框交互保留在 content 模块。
 */
export * from './handler';
