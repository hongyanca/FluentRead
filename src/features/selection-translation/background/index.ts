/**
 * @file src/features/selection-translation/background/index.ts
 * 文件职责：汇总划词翻译后台需要的语音播放和词典查询处理器，供应用级 background registry 从一个 feature 路径完成消息注册。
 * 主要内容：文件完整再导出 ttsHandler 与 wordLookupHandler 中的消息常量、协议类型、依赖接口和 handler 工厂。
 * 模块边界：此处不创建 Offscreen 适配器、不访问词典网络也不监听 runtime；具体实现留在对应文件，统一注册、错误封装和能力选择由 src/app/background 负责。
 */
export * from './ttsHandler';
export * from './wordLookupHandler';
