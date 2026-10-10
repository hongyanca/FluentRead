# 设置侧栏布局验证（2026-09-09）

设置页保留原有四个分组和全部 17 个入口，缩小品牌区域、图标和分组间距，菜单行高随窗口高度在 32–40 CSS 像素之间调整，文字字号保持不变。图标统一为与 Popup 一致的 24×24 画布、1.7 线宽的本地 SVG，正文使用较轻的字重，选中项使用品牌淡粉色底色，移除图标底块及悬停横移。高度不足或译名换行时，菜单区独立滚动；700 像素及以下宽度继续使用横向导航。

![1366×768 下全部入口可见](./desktop.png)

## 验证

- `pnpm compile`、`pnpm build`、`pnpm test:audit`、`pnpm docs:build` 和 `git diff --check` 通过。
- 使用生产 `.output/chrome-mv3`，清单入口 `popup.html` / `options.html`，在独立临时 Edge profile 中测试。
- 1440×900、1366×768、1280×720、1024×768、820×900 下，中文菜单全部一屏可见；17 个装饰图标均使用非空 SVG 路径并设置 `aria-hidden`。
- 1280×600 下菜单独立滚动；390×844 下导航横向滚动。全部七个尺寸均逐项点击验证 17 个入口的激活状态，无页面横向溢出。
- 1366×768 下对 default、compact、minimal、contrast 外观直接设置根节点属性进行深色布局检查，菜单全部可见。这是样式验证，不代表配置持久化验证。
- 页面错误和控制台错误均为 0。临时浏览器与 profile 已清理。
- `launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`；窗口完整位于第二块显示器。
- 完整 `--suite full` 已尝试，但技能脚本在 popup 启动断言等待旧标题“让阅读自然地流动”超时；当前源码使用“网页翻译”，尚未进入侧栏测试。不能据此宣称完整 UI 回归通过。
- 本轮没有运行 Firefox 实机验证、翻译供应商调用或多语言布局矩阵；改动仅限设置页 CSS。

