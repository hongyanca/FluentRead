/**
 * @file src/app/background/handlers/selectionWordLookup.ts
 * 文件职责：把划词词典查询的后台 handler 接入 app 层 handlers 命名空间，供后台总路由按统一路径进行注册。
 * 主要内容：转发 wordLookupHandler 中的消息常量、请求响应类型和处理器工厂，使 messageRuntime 可以注入 lookupWord 服务而无需复制协议。
 * 模块边界：此处是纯重导出，不执行词典请求、不处理选中文本，也不渲染词典卡片；查询服务归 selection-translation feature，页面呈现归 content UI。
 */
export * from '@/src/features/selection-translation/background/wordLookupHandler';
