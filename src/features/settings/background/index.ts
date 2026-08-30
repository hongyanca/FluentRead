/**
 * @file src/features/settings/background/index.ts
 * 文件职责：作为设置 feature 的后台公共入口，向应用消息注册表转发打开 Options 页面及定位具体设置分区所需的完整契约。
 * 主要内容：文件完整再导出 openOptionsHandler.ts 中的消息常量、允许分区类型、依赖接口和 createOpenOptionsPageHandler 工厂。
 * 模块边界：该 barrel 不调用 browser.runtime.openOptionsPage 或 tabs.update；实际导航由 handler 通过注入依赖完成，Options 页面自身的 hash 解析由 model/navigation 管理。
 */
export * from './openOptionsHandler';
