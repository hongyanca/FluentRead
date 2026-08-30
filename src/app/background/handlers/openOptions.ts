/**
 * @file src/app/background/handlers/openOptions.ts
 * 文件职责：提供“打开设置页”后台处理器的 app 层兼容入口，使消息运行时不需要直接依赖 settings feature 的内部文件布局。
 * 主要内容：转发 settings/background 的公开 handler 工厂、消息协议与响应类型，用于接收 popup 或 content 发来的设置导航请求并调用浏览器设置页入口。
 * 模块边界：此处不执行页面渲染、不解析设置表单，也不直接注册 runtime listener；具体浏览器操作由 settings feature 实现，注册顺序由 messageRuntime 决定。
 */
export * from '@/src/features/settings/background';
