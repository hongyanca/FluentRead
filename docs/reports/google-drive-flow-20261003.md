# Google Drive 同步流程与账号记录验证

日期：2026-10-03。基础提交：`f07125b8cccdb30f50104f024be12b97571b65a2`（PR #742）。

## 产品行为

- 首次同步已有云端文件时，先选择保存本机或恢复云端，再进入独立的“确认变更”页。逐项合并是辅助入口。确认页突出本次操作、来源和目标、替换提醒及唯一主操作，差异默认折叠；可以返回重新选择。
- 首次保存和配置一致时，只显示相应说明及操作。已有共同基线时直接预览合并结果；待确认的冲突与自动选择分开显示，自动选择按需查看和调整。完整保存或恢复不再显示逐项选择提示。
- 预览行使用设置名称、可读的 MiB、毫秒、百分比及枚举名称；已知复合偏好整体比较，兼容字段按名称和推荐方向收拢但保留全部后台 ID。连接、凭据、请求参数和自定义内容仍隐藏。
- 主卡片显示上次成功同步的账号与时间，预览显示本次账号。“更换 Google 账号”先取消旧预览、清除身份缓存，再重新交互授权；期间禁用执行。取消或授权失败保留上次成功记录，成功换号同步后更新该记录。打开设置页只读本机记录，不发起授权。
- 确认页的具体操作按钮即本次确认，不追加重复的确认弹窗。“取消”结束本次操作；保持单次同步模式。
- 七种界面语言覆盖步骤、操作、账号、冲突和数量文案；中英文隐私政策同步说明本机账号记录与保留期限。

## 自动验证

Google Drive 相关 8 个测试文件共 59 个用例通过。配置差异、预览模型、同步服务、客户端、授权、Drive API、加密和后台处理器共 8 个业务模块，statements / branches / functions / lines 均为 100%。覆盖率范围明确限定上述模块，没有运行全量回归。

i18n 契约 55 个、manifest 契约 18 个、源码职责头检查 712 个用例通过。类型检查、测试归类审计、Chrome 与 Firefox 生产构建、userscript 构建与 verifier、文档构建均列入交付检查。依赖复用同仓库既有的 `node_modules`，不代表新安装验证。

## 浏览器证据与边界

使用 Codex 内置浏览器的后台临时 tab，通过 CUA 操作真实 Vue 组件、Element Plus 和七语言资源，客户端与存储响应使用合成账号和数据。不是安装到真实 Chrome 的扩展验证，没有读取用户真实配置或写入 Google Drive。

验证首次保存、首次恢复、保存本机、返回选择、首次逐项合并、共同基线合并、无冲突自动选择、批量处理冲突、配置一致、换号成功、换号取消及成功账号记录重新打开后保留。恢复详情无“请选择一端”提示，合并尚有未选项时执行按钮禁用。

桌面视口 1280×720、窄屏视口 390×844，检查中英文和明暗主题；无横向溢出，详情在弹窗内部滚动，底部操作保留在视口内。临时 viewport 覆盖在验证后重置，任务 tab 与本机服务结束。浏览器保持后台模式，没有前台抢焦点操作；未测量系统前台应用。控制台没有收集到 warn / error。

证据目录为 `/private/tmp/fluentread-drive-flow-ui-20261003`；截图为 `/private/tmp/fluentread-drive-flow-choose.jpg`、`/private/tmp/fluentread-drive-flow-desktop.jpg`、`/private/tmp/fluentread-drive-flow-mobile.jpg`、`/private/tmp/fluentread-drive-flow-mobile-dark.jpg` 和 `/private/tmp/fluentread-drive-flow-account.jpg`。

Chrome Identity 的清理语义参见 [Chrome 官方 API 文档](https://developer.chrome.com/docs/extensions/reference/api/identity#method-clearAllCachedAuthTokens)。真实 Google 账号选择窗口及实际云端读写仍需在发布客户端和实际 Chrome 账号环境中验证；模拟响应及 Firefox 构建不证明 Google OAuth 或跨设备同步已在真实环境通过。

## 已知主干失败

`tests/settingsUiArchitecture.test.ts` 的 `uses saved dynamic service profiles across document, comparison, history, usage and shared icons` 静态断言要求文档页面源码含有 `config.customModels[config.documentService]`。该测试在上述未修改的基础主干也失败，本次未修改文档翻译页面。专项同步检查通过不等同于全仓测试通过。
