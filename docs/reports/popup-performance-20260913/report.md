# 菜单栏启动与显示性能优化

基线：`dee0b232`，生产 Chrome MV3 产物。优化在 `perf/popup-startup-20260913` 分支实现，没有修改版本号或用户配置结构。

## 改动

- 配置读取、界面语言资源准备与主界面模块加载并行，仍在配置就绪后挂载，保留第一帧的皮肤、主题、语言和布局。
- 快捷抽屉及其样式在首次打开时加载，移除未使用的数字输入组件注册。
- 语言选择器关闭时直接显示当前语言标签，不创建完整选项列表；选项与标签的计算由独立组件缓存，保留搜索、键盘操作和外部配置同步。
- 中文界面跳过无效的旧文案 DOM 全树扫描；其他语言切回中文时恢复一次。抽屉使用页面已有的文案观察器，避免重复扫描。

按需组件加载参考 [Vue 官方性能指南](https://vuejs.org/guide/best-practices/performance.html#code-splitting)，实现仍使用 FluentRead 现有 Vue、Element Plus 和配置服务。

## 本机前后对照

真实 Microsoft Edge、独立临时 profile、生产扩展，未加载 options 或 popup 脚本预热。通过扩展自带图片文档和后台配置协议完成语言引导准备，然后打开菜单；每轮关闭 HTTP 缓存，记录首次文档及另外 6 次打开。原始结果见本目录 JSON。

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 正常后台、首次菜单 DOM 就绪（两轮） | 155–171 ms | 96–108 ms |
| 正常后台、首次菜单 rAF 采样（两轮） | 167–194 ms | 98–110 ms |
| 后台休眠、首次菜单 DOM 就绪（单轮） | 251 ms | 193 ms |
| 后台休眠、首次菜单 rAF 采样（单轮） | 262 ms | 195 ms |
| 7 次打开的 rAF 中位数（正常后台两轮） | 77–78 ms | 49–50 ms |
| 首屏 DOM 元素 | 393 | 167 |
| 关闭菜单的语言选项元素 | 105 | 0 |
| 中文首屏旧文案 TreeWalker 扫描 | 1 | 0 |
| 首屏实际解析的 JavaScript | 952,776 B | 928,929 B |

DOM 就绪取真实主界面挂载时刻；rAF 是其后首个动画帧回调，不能等同于显示器实际呈现像素的时刻。数据从 popup 文档创建开始，不包含浏览器工具栏点击分发的耗时。后台休眠用例使用 [CDP ServiceWorker 协议](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/) 在隔离实例中停止后台，并确认 stopped 后再打开菜单。单轮休眠数据与两轮普通数据都是本机样本，不能代表所有设备。

## 验证

- popup、缓存操作、语言显示及 i18n：4 个测试文件、26 个用例通过；涉及样式注册、入口与保存交接的架构专项 3 个用例通过。
- 生产首帧专项 6 个场景通过：配置延迟、深色/自动主题、读取失败降级、正常打开；另通过首次安装引导、连续两次修改后快速关闭、无修改关闭、三个抽屉焦点进入与恢复。
- 生产语言菜单专项通过：搜索、ArrowDown/Enter 选择、Escape 关闭、关闭时零选项 DOM、外部配置同步、英文/中文往返、深色与重开持久化。
- `compile`、`test:audit`、Chrome/Firefox 构建、清单校验、userscript 构建与 verifier、文档构建和 `git diff --check` 通过。
- `launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`。截图与原始报告包含显示器边界；仅关闭本次临时实例并删除对应 profile。控制台错误为 0。

未执行全量回归，也没有 Firefox 的真实运行时证据。完整 `settingsUiArchitecture.test.ts` 有 3 项已有失败，已在未修改的 `dee0b232` 主目录复现，涉及旧服务设置保存文案和 Chrome 本地模型配置的源码断言；与本次 popup 修改无关，未扩展修改范围。

## 截图

优化前：[before.png](./before.png)。优化后：[after.png](./after.png)。深色英文与关闭菜单同步：[dark-en.png](./dark-en.png)。布局与外观保持原有样式，正常菜单为 360 × 478 CSS px，无横向溢出。
