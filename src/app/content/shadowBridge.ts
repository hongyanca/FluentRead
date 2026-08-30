/**
 * @file src/app/content/shadowBridge.ts
 * 文件职责：提供 WXT MAIN-world 入口可调用的 Shadow 与路由桥启动别名，把平台实现纳入 app 层明确的 composition 命名。
 * 主要内容：将 platform/shadow-ui/pageBridge 的 installShadowAndRouteBridge 重导出为 startShadowBridgeApp，使 entrypoint 只负责启动而不依赖平台内部函数名。
 * 模块边界：此文件是单一别名出口，不安装 content feature、不创建 Shadow UI 组件，也不包含宿主 API 包装逻辑；桥的幂等安装和恢复完全由 platform 模块实现。
 */
export {installShadowAndRouteBridge as startShadowBridgeApp} from '@/src/platform/shadow-ui/pageBridge';
