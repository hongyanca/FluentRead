# Popup Logo 原始轮廓修复

2026-10-04。Popup 将 32px Logo 再用 12px CSS 圆角裁剪，导致原本的圆角方形图标显得过圆。

菜单品牌区和启动等待页现在直接呈现 `/icon/128.png` 自带的透明轮廓。紧凑、简约和 Emoji 皮肤不再覆盖 Logo 圆角；皮肤仍沿用原有图标尺寸。后续皮肤应保留品牌图片的原始轮廓。

验证使用 Chrome MV3 生产产物和独立临时 Edge profile，通过 `macos-background-cdp` 与 `launchservices-no-foreground` 在第二个显示器运行。窗口保持正常尺寸且完整位于显示器可用区域，`browserFrontmost=false`；测试后已关闭本次创建的浏览器。

- 14 种内置皮肤分别验证亮色、深色主题，共 28 个组合；每次保存配置后重载 Popup，确认实际皮肤和主题已生效。
- 品牌图片源始终为 `/icon/128.png`，四角计算圆角均为 `0px`，无 `clip-path` 或 mask；简约风格为 38px，其余为 32px，均保持正方形。
- 暂停首个 Popup 模块加载后检查真实启动外壳：24px Logo 同样没有额外圆角裁剪。
- 28 个组合均无横向溢出；全部截图已复核，页面控制台错误为 0。
- `pnpm compile`、`pnpm test:audit`、`pnpm build` 和 `pnpm build:firefox` 通过。

原始截图和逐组合数据保存在 `/private/tmp/fluentread-popup-logo-ui-production/`。本轮为 Logo 显示专项，未运行全量回归；Firefox 仅验证构建，未验证真实 Firefox 窗口。未借鉴或修改参考项目。
