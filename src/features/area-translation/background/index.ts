/**
 * @file src/features/area-translation/background/index.ts
 * 文件职责：作为圈选翻译后台子模块的稳定汇总入口，向应用层转发 handlers.ts 中声明的消息常量、协议类型、校验函数和处理器工厂。
 * 主要内容：主要内容只有对 ./handlers 的完整再导出，使 background 注册表可以从单一路径组装截图与翻译处理器，同时保持具体实现文件可独立测试。
 * 模块边界：此处不得加入浏览器监听、实例化依赖或业务分支；实际 handler 逻辑留在同目录 handlers.ts，应用级消息注册与错误封装由 src/app/background 负责。
 */
export * from './handlers';
