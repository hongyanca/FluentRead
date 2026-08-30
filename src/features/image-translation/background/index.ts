/**
 * @file src/features/image-translation/background/index.ts
 * 文件职责：汇总图片翻译后台所需的消息处理器、OCR 语言状态仓库和远程图片抓取能力，为 background composition root 提供单一路径。
 * 主要内容：文件完整再导出 handlers、ocrLanguageRepository 与 remoteImageFetcher，覆盖 handler 工厂、消息类型、语言包持久化接口和受限远程图片响应。
 * 模块边界：这里只建立公共出口，不注册 browser.runtime 监听或创建全局实例；Offscreen 适配器仍由应用层显式引入，具体副作用必须通过注入边界组装。
 */
export * from './handlers';
export * from './ocrLanguageRepository';
export * from './remoteImageFetcher';
