# Google Drive 同步卡片布局与隐私说明

同步账号和时间对齐卡片内容区右侧；窄屏上下排列并保持文字右对齐。隐私徽标支持悬停和键盘聚焦，变为绿色并显示本机加密、仅访问应用数据区、临时授权缓存清理，以及不参与同步的数据说明。提示覆盖 7 种界面语言。

[卡片布局](./card-1440.png)、[隐私提示](./card-privacy-hover.png)、[窄屏提示](./card-privacy-mobile.png)。截图使用虚构账号。

验证：类型检查通过；2 个语言测试文件共 59 项通过；Chrome、Firefox 和文档构建通过；生产 Chrome 扩展在独立 Edge 临时配置中完成 15 项 UI 检查，无页面或控制台错误。包含 1440、820、600、390 CSS 像素布局、长邮箱、绿色反馈、键盘提示、深色模式和 7 种界面语言。

浏览器启动采用 `macos-background-cdp`，焦点策略为 `launchservices-no-foreground`，窗口完整位于第二个显示器的可用区域，`browserFrontmost=false`。只替换本次测试页的同步状态响应，未授权或连接真实 Google 账号，未重新验证云端同步和加密流程。Firefox 仅完成构建验证。测试结束后清理本次实例及临时 profile。

本次调整沿用 FluentRead 的 Vue、Element Plus、主题变量和 i18n，未借鉴或修改参考仓库。
