/**
 * @file entrypoints/background.ts
 * 文件职责：声明 FluentRead 的 WXT 后台入口，并把 service worker 生命周期委托给后台应用组合根。
 * 主要内容：配置 Safari 非持久后台行为，调用 startBackgroundApp 组装消息路由、菜单、缓存与维护任务；配置存储会根据 MV3 worker 或 MV2 background page 身份选择后台数据库端口。
 * 模块边界：本文件只保存 WXT 元数据和唯一启动委托，不直接注册业务 handler、访问存储或调用翻译服务。
 */
import {startBackgroundApp} from '@/src/app/background/runtime';
export default defineBackground({
    persistent: {
        safari: false,
    },
    main: startBackgroundApp,
});
