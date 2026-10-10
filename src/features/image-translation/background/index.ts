/**
 * @file src/features/image-translation/background/index.ts
 * 文件职责：汇总图片翻译后台所需的消息处理器和 OCR 语言状态仓库，为 background composition root 提供单一稳定引用路径。
 * 主要内容：文件完整再导出 handlers 与 ocrLanguageRepository，覆盖 OCR/翻译 handler 工厂、取消消息类型和语言包持久化接口。
 * 模块边界：这里只建立公共出口，不注册 browser.runtime 监听或创建全局实例；Offscreen 适配器仍由应用层显式引入，具体副作用必须通过注入边界组装。
 */
export * from './handlers';
export * from './ocrLanguageRepository';
