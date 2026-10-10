# 写作入口、正文空间与双语回复验证（2026-10-03）

三个需求在独立 worktree `FluentRead-writing-entry-menu-20261003` 实现。交互参考用户截图，没有读取或复制 read-frog / kiss-translator 的代码。

- 写作按钮右侧增加独立三点入口，支持本次关闭、当前网站禁用与永久禁用；取消不保存。网站规则仅影响写作助手，设置页可逐站恢复；永久关闭保留偏好。
- 本次关闭保存在文档内存，跨暂停/重新挂载保持，刷新后恢复。持久化使用共享配置后台通道与现有失败回滚；后台同时拒绝被写作规则禁用的网站请求。
- 面板默认 640 × 600 CSS px，收紧标题、语言和工具栏，正文字号保持 14px。改写输入平时一行，聚焦或有内容时展开。
- 插入菜单支持双语插入/复制，只有当前正文对应的完整对照译文可用。组合为正文、空行、译文；GitHub 保留 Markdown，Gmail 转换为可读纯文本。默认仍只插入正文，不自动发送。

验证范围：

- 8 个相关单元/功能测试文件：260 项通过。另 5 个相关架构/配置文件：829 项通过、4 项失败；最新代码的 6 文件、99 项复跑通过。没有运行全量回归。
- 四项架构失败已在修改前源码快照 `0ceae21b` 复现：文档入口额外依赖、content/runtime.ts 既有行数超过上限、verify-brand-copy.mjs 无验证归属、8 个既有模块未进入严格覆盖率清单。本次没有放宽门禁或修改无关模块。
- writing.ts、writingRuntime.ts、entrySession.ts 与 entryPlacement.ts 的针对性 V8 statements/branches/functions/lines 覆盖率均为 100%。
- 类型检查、测试审计、Chrome/Firefox 生产构建、userscript 构建和 verifier、文档构建通过。依赖复用主 checkout 的 node_modules，不是 clean-install 证明。
- 生产扩展在临时后台 Edge profile 中执行 `entry-menu,compact,bilingual,i18n,presentation` 五个专项：ok=true，16 条组合场景、62 张截图、0 条 pageerror。涵盖快速关闭、跨页同步、最新值保存、三种关闭和恢复、多编辑器、双语插入、译文加载保护、改稿/版本/语言/重试、七种界面语言、深色及 390px 窄屏。
- 整合 `origin/main` 的 `00973fff` 后，7 文件、107 项针对性测试通过，并重新构建 Chrome/Firefox/userscript。最终生产扩展复跑 `entry-menu,compact` 两个专项通过，证据另存于 `integrated/`；原五专项证据保留。语言资源由合并后的目录重新生成并固定到首次包含这些文件的提交。

| 网站 | 视口宽 | 正文预览高 | 面板高 | 正文比例 |
| --- | ---: | ---: | ---: | ---: |
| GitHub | 1440 | 392.8px | 600px | 65.5% |
| Gmail | 1440 | 392.8px | 600px | 65.5% |
| GitHub | 390 | 374.8px | 600px | 62.5% |
| Gmail | 390 | 374.8px | 600px | 62.5% |

比例在改写输入为空且未聚焦、正文完成时测量；展开改写输入或显示异常提示时，正文会分配部分空间给这些操作。

浏览器 `launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`。窗口完整位于第二屏，测试前后前台应用保持不变；仅关闭测试创建的实例和临时 profile。

浏览器证据来自 GitHub/Gmail DOM 夹具与 loopback 模拟流式模型，不代表真实登录账号、真实服务质量、Firefox 运行期或商店版本验证。未发送真实邮件或评论。

本地证据目录为 `writing-ui-review-20261003/`，详细记录见 `report.json`；截图与报告中的环境信息未加入版本控制。
