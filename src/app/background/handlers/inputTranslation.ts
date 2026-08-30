/**
 * @file src/app/background/handlers/inputTranslation.ts
 * 文件职责：为输入框翻译的后台消息处理器提供 app 层重导出入口，让总消息运行时通过统一 handlers 路径完成组装。
 * 主要内容：转发 input-translation feature 暴露的 createInputBoxTranslationHandler、协议类型及依赖契约，供后台注入 translateWithCache 等实现。
 * 模块边界：这里只维护模块公开面，不读取输入框 DOM、不选择文本语言，也不执行供应商请求；页面交互属于 content feature，翻译执行属于服务与 provider 层。
 */
export * from '@/src/features/input-translation/background';
