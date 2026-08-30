<!--
 * @file src/features/README.md
 * 文件职责：说明 FluentRead 纵向业务模块的目录约定、生命周期契约与公共出口规范，帮助维护者判断新增能力应落在哪个 feature 层级。
 * 主要内容：文档列出 content、background、ui、services、domain 的职责，约定 isEnabled、mount、unmount、isMounted 等接口，并指向 composition root、Shadow UI 和迁移白名单规则。
 * 模块边界：这里只记录 src/features 的组织和依赖原则，不实现任何运行时代码；完整的全仓分层、入口约束和验证责任仍以 docs/architecture.md 及架构测试为准。
 -->
# FluentRead Feature 目录

FluentRead 的功能模块按“能力边界”组织，而不是按入口脚本堆放：

- `content/`：只保存该 feature 的网页运行时，例如划词、悬浮、圈选或字幕挂载。
- `background/`：只保存该 feature 的后台 handler；消息协议放在 `protocol.ts`。
- `ui/`：保存该 feature 自己的 Vue 组件、composable 和 CSS。
- `services/`：保存该 feature 的消息客户端、远程资源读取或本地处理服务。
- `domain/`：保存不依赖 WXT、Vue 和 browser API 的纯模型与算法。

每个 feature 应优先暴露这些契约：

- `isEnabled()`：只判断配置或运行时条件，不产生副作用。
- `mount(runtime)`：挂载 DOM、监听器、观察器或消息循环。
- `unmount()`：释放本 feature 拥有的资源。
- `isMounted()`：可选，用于异步 UI 挂载的幂等检查。

content 入口通过 `src/app/content/featureRegistry.ts` 提供运行时和生命周期，再由 `src/app/content/features.ts` 暴露给 WXT entrypoint。feature 不直接持有全局入口状态；Vue content overlay 统一使用 `src/platform/shadow-ui` 挂载，组件与 CSS 保留在所属 feature。仍需旧 `translateApi` 或词典的迁移代码，必须按“具体文件 + 具体 import”登记在架构测试中，不能扩大为目录白名单。完整边界与目录示例见 [架构设计](../../docs/architecture.md)。
