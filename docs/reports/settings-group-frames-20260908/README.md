# 设置页分组边框

设置分组的标题、说明和选项现在位于同一个圆角框内。浅底标题栏与组内细分隔线区分阅读层级，组间留白为 24px，窄屏为 18px。无标题的分组保留完整圆角。颜色沿用主题变量，增强外框边界，不改变配置、导航或保存行为，也未借鉴参考仓库。

## 验证

- 类型检查、测试归类审计、设置 UI 架构测试 28 项通过。
- Chrome MV3 与 Firefox MV2 生产构建通过；Firefox 未运行真实 UI 测试。
- Chrome MV3 产物在临时 Edge profile 中验证通用设置、翻译设置、高级选项；覆盖 1440px / 390px 和浅色 / 深色，共 12 个截图场景。断言分组边框为 1px、没有横向溢出，无页面异常。
- 启动模式 `macos-background-cdp`，焦点策略 `launchservices-no-foreground`，窗口位于第二屏，`browserFrontmost=false`。测试结束关闭本次实例并删除临时 profile。
- 完整 `--suite full` 已尝试，在旧 Popup 标题 `让阅读自然地流动|翻译功能已暂停` 定位处超时，未进入设置检查，不算完整回归通过。
- 本机专项证据：`/private/tmp/settings-frames-visual/`；完整套件证据：`/private/tmp/settings-frames-full/`。
