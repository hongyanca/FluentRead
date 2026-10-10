# 网站适配 JSON：实施与验证

FluentRead 现在使用统一 JSON 描述网址范围、正文目标、保护区域和动态观察边界，悬浮与全文翻译共用同一候选引擎。设置入口为「网站规则 → 网站适配」，支持搜索和停用内置规则、自定义替换、导入导出、草稿撤销、字段错误提示及网址匹配预览。

目录包含 **181 组规则、208 个主机匹配模式、12 份共享模板**。其中 8 组迁自 FluentRead 已有专用适配器，其余 173 组独立编写。提供的配置数据只用于提取需求类别与网站线索，没有移入其选择器、脚本、样式、个人状态、服务配置或历史合并格式；未使用其他参考仓库的代码。

## 目录与覆盖口径

| 新增规则类别 | 组数 |
| --- | ---: |
| 文档与开发资料 | 78 |
| 新闻与文章 | 29 |
| 社区、搜索与消息 | 26 |
| 学术研究 | 18 |
| 商品与评论 | 8 |
| AI 对话 | 6 |
| 百科 | 5 |
| 邮件 | 3 |

一组规则可以匹配多个主机；主机模式可能覆盖子域。以上数字不能等同于实站验证数量，也不表示提供数据中的所有网站与专项能力都已实现。完整需求审计、通用处理范围及明确缺口记录在 `src/core/site-adaptation/catalog/coverage.json` 的 `scopeAudit` 中。

提供数据含 774 个混合条目，其中包含重叠能力、历史补丁与内部页面线索；183 个条目涉及字幕、156 个涉及图片文字。这些功能依赖各自运行时，不能由正文选择器代替。登录后的当前页面、封闭 Shadow DOM、跨域 frame、Canvas、字幕和 OCR 不在本次正文规则实站证明范围内。

## 设计与行为

- 版本固定为 `1`，使用显式主机边界及路径通配符；不接受任意正则、脚本或样式注入。
- `augment` 补充通用正文识别，`focus` 限定明确正文目标；模板只允许一层引用，避免历史补丁式层叠。
- 同 ID 自定义项完整替换内置项；不同规则共同保护原文，优先级不能绕过保护区域。
- 编辑草稿与已保存配置分离。保存等待真实持久化成功，失败保留草稿；较晚完成的导入不会覆盖用户新输入。
- 规则保存后取消旧请求、恢复原文并重新发布候选边界；真实路由改变会重新匹配。
- 属性、兄弟结构与开放 Shadow DOM 更新会重新检查候选，撤销失效译文并取消在途请求。非原子消息容器保留独立段落及前后直接文字。
- 实站发现同网址 `replaceState` 会通过提交前导航事件误取消请求。路由桥现观察提交后的网址并统一去重，正常保存滚动状态不会丢弃译文；路径、查询参数和片段真正变化仍会通知。

完整字段说明与使用示例见 [网站适配](../config/site-adaptation)。编辑器校验文件为 `docs/public/site-rule-pack.schema.json`。运行 `node scripts/export-site-rule-pack.mjs` 生成可直接导入的完整 `.output/site-rule-pack.json`。

## 验证方法

目录测试消费实际编译器与候选引擎，覆盖所有规则的主机边界、每一种模板，以及所有 `focus` 规则的正文、控制和元数据保护。独立构造的 47 个域名夹具加上原有 8 站和自定义规则，共 56 个生产扩展浏览器案例。

浏览器使用临时 Edge profile，正常大小的第二屏后台窗口；启动方式为 `macos-background-cdp`，焦点策略为 `launchservices-no-foreground`。真实快捷键验证悬浮和全文的「翻译 → 恢复 → 再翻译」、邻段不被悬浮误触、保护内容不进入请求、动态新增、属性重新分类、规则即时生效、迟到结果取消与 SPA 路径变化。

实站模式加载公开页面，翻译供应商响应由本地确定性替身返回；因此证明的是实际 DOM、候选、请求和渲染链路，不评价远程供应商可用性或译文质量。初次实站检查保留了站点自动选择中文、列表内段落归属、广告引起鼠标落点移动等诊断，随后使用英文页面、独立正文段落和命中校验复验。

通用 UI 技能脚本也执行过，但其「默认目标语言」旧定位器已不对应当前设置页，其他专项还被当前语言引导层阻挡，不能记为完整 UI 脚本通过。本次专用生产包用例独立覆盖新设置的非法草稿、保存失败重试、持久化回读、导入导出、撤销、内置规则开关、复制和移动布局；这些结果与旧脚本限制分别记录。

## 最终结果与复验记录

| 验证 | 结果 |
| --- | --- |
| 全量 Vitest | 184 个文件、3,215 项通过 |
| 严格覆盖率门禁 | 139 个测试文件、2,508 项通过；statements、branches、functions、lines 均为 100% |
| 测试归属审计、类型检查 | 通过 |
| Chrome MV3 / Firefox MV2 | 构建与 manifest 校验通过 |
| userscript | 构建与 verifier 通过 |
| 生产扩展域名夹具 | 56 个案例通过；后续路由变更和设置用最终产物再次重点验收 |
| 公开实站 | 20 个不同站点均有完整通过记录，使用本地翻译响应 |

最后一轮 20 站矩阵为 19/20 通过：Wikipedia 的第三次全文触发出现一次 15 秒超时。同一个网址随后单独复验，完整悬浮及全文循环均通过；当前没有可重复的失败根因，因此保留这次波动，不能表述为整轮零失败。pnpm 在版本标记和移动目录精确保护更新后再次通过，并额外断言这两个区域保持原文。逐站地址、翻译循环和保护区数量已记录在目录维护文件的 `browserVerification` 中。

本机证据目录：

- `/private/tmp/fluentread-site-adaptation-browser-complete/`：56 个隔离夹具及新设置截图。
- `/private/tmp/fluentread-site-adaptation-acceptance/`：最终规则更新、SPA、迟到请求和设置验收。
- `/private/tmp/fluentread-site-adaptation-live-final/`：最后一次 20 站矩阵及失败诊断。
- `/private/tmp/fluentread-site-adaptation-live-focused-final/`：Wikipedia 与 pnpm 完整复验。
- `/private/tmp/fluentread-fastapi-diagnostic/evidence-routes/diagnostics-summary.json`：同网址历史更新误取消在途译文的根因证据。

运行浏览器脚本需提供 `--extension-dir`、`--playwright-root`、`--focus-safe-helper` 与 `--artifacts-dir`。默认执行自建夹具；添加 `--live` 才访问公开实站，`--cases` 可用逗号指定站点 ID。所有记录均区分合成网页、实际网页和本地供应商响应。

## 文档与合并前整合复验（2026-09-05）

在主线 `5704bb8` 上整合本功能后，新增[用户自定义教程](../guide/custom-site-rules)和[贡献指南](../contributing/site-adaptation)。官网首页、导航、设置页和中英文 README 均接入文档入口。指南中的规则包与夹具通过实际 schema、编译器及候选引擎验证，检查正文、保护、URL 排除、悬浮一致性与等价重挂载。

| 复验 | 结果 |
| --- | --- |
| 全量 Vitest | 210 个文件、3,659 项通过 |
| 严格覆盖率 | 165 个文件、2,911 项通过，四维均 100% |
| 测试审计、类型检查 | 通过 |
| Chrome / Firefox / userscript | 构建、manifest 与 userscript verifier 通过 |
| 官网构建与浏览器 | 5 个页面分别检查 1280 与 390 像素宽度，共 10 项；26 个内部链接及手机导航通过，无页面溢出或脚本异常 |
| 生产扩展夹具与设置 | 56 项通过；保存失败重试、持久化、导入导出、内置复制及移动布局通过 |
| 重点实站 | FastAPI、Wikipedia、pnpm 的悬浮及全文翻译、恢复、再翻译和保护区检查均通过 |

首次并行执行测试与构建时，覆盖率运行中的一项压缩包测试达到 5 秒超时；取消并行构建负载后完整覆盖率门禁通过。首次三站复验中，pnpm 客户端接管替换了带测试标记的节点，保护断言因定位丢失超时；单站复验通过。浏览器脚本现等待 Docusaurus 的 `data-has-hydrated` 状态后再标记正文与保护区，最终三站同轮通过。本次没有据此修改产品翻译逻辑。

证据：`/private/tmp/fluentread-site-adaptation-pr-browser/`、`/private/tmp/fluentread-site-adaptation-pr-docs-browser/`、`/private/tmp/fluentread-site-adaptation-pr-live/`、`/private/tmp/fluentread-site-adaptation-pr-pnpm/`、`/private/tmp/fluentread-site-adaptation-pr-live-ready/`，以及 `/private/tmp/fluentread-site-adaptation-doc-example-review.json`。浏览器继续使用临时 Edge、`macos-background-cdp`、`launchservices-no-foreground`，窗口正常显示在第二屏且 `browserFrontmost=false`。
