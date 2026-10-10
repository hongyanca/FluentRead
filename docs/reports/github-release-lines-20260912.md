# GitHub 发布说明逐行双语对照

页面：[GitHub 发布页](https://github.com/mengxi-ream/read-frog/releases/tag/v1.47.0)。验证日期：2026-09-12。

## 问题与修复

GitHub 正文适配原先把含有多个 `<p>` 的 `<li>` 当成原子候选，多个段落的译文集中在条目末尾。修复后先发现列表内段落，再处理列表项直接拥有的文字；对正文段落中的直接 `<br>` 使用同一套逐行候选供悬浮和全文翻译。28 个段落中的 60 个直属换行产生 88 个对照单元。另有 2 个换行嵌在强调文字内部（包括 “All languages”）；为保留完整的行内语义和结构，继续随所在片段一起翻译。

每行原文与译文使用可恢复的 FluentRead 行内容器，原始换行节点保留，避免块级译文和原文换行叠加出额外空行。源文链接、行内代码与强调继续由本地快照保留，翻译服务不能改写链接地址。没有显式换行的段落、未启用逐行规则的网站沿用原有行为。

## 实际效果

以下截图来自生产 Chrome MV3 扩展、真实 GitHub 页面及真实微软翻译接口。

![真实页面逐行对照](./github-release-lines-20260912/release-paragraph.png)

## 验证

- 真实发布页：28 个段落均达到各自预期的译文数量；悬浮计数 `[1, 0, 1]`，相邻段落保持未翻译；全文翻译、恢复、再次翻译均通过。
- 原始节点身份和链接地址保留，恢复后的正文 HTML 与原文完全一致，无嵌套译文。
- 公开发布正文夹具：1120px 与 360px 两种内容宽度通过；动态新增两行正文被正确翻译；模拟服务失败后重试成功。窄宽度原文自身的长行内代码溢出保持原状，翻译未增加溢出。
- Edge 使用临时 profile、第二屏正常窗口；`launchMode=macos-background-cdp`，`focusPolicy=launchservices-no-foreground`，`windowPlacement.mode=background-visible-no-focus`，`browserFrontmost=false`。
- 完整单元/功能测试：300 文件、6,061 测试通过。最终严格覆盖率复跑：243 文件、4,941 测试通过，四维均为 100%。类型检查、Chrome/Firefox/Userscript 构建、Userscript verifier 和文档构建通过。
- 额外 20 个不同网站分别完成悬浮、全文翻译检查，共 40 个成功模式检查；初始矩阵为 35/40，Steam、Qt、Dart 的加载超时项重试通过，另补充 PostgreSQL 与 Bambu 两组。MDN 和维基百科未完成的组合不计入这 20 站，详见下方限制。
- `pnpm test:audit` 的既有失败：`tests/pageTranslationAdvanced.test.ts` 未登记到测试矩阵，在未修改的主分支同样复现。一次与构建并发的覆盖率运行触发了二进制文档解压测试的 5 秒超时，限制测试并发后完整覆盖率复跑通过。

[真实页面报告](./github-release-lines-20260912/live-report.json) · [夹具与恢复报告](./github-release-lines-20260912/fixture-report.json) · [20 站汇总与失败记录](./github-release-lines-20260912/site-matrix-report.json)

夹具使用确定性模拟译文，仅证明分段、布局和状态行为；真实页面报告使用微软服务，但本次任务不对逐行断句后的语义质量做额外承诺。Firefox 与 Userscript 的证据范围为构建，浏览器交互证据来自 Edge。

验证使用独立 worktree 的构建产物，依赖通过符号链接复用主检出已有的 `node_modules`；没有修改依赖清单。

以上初始验证对应基线 `8ac04042` 和修复提交 `cfb95879`；后续主分支集成结果单独记录如下。

## 合并前集成验证

已将最新主分支 `0008a791` 合入，集成提交为 `c682f8a3`。完整测试 309 文件、6,195 项通过，类型检查、Chrome/Firefox/Userscript 构建与 Userscript verifier 通过。主分支的 `pageTranslationAdvanced.test.ts` 同时登记在 unit 和 regression，本分支移除 unit 重复项、保留 regression，测试审计恢复通过。

合入后的生产扩展再次通过真实 GitHub 发布页的逐段翻译、恢复和再次翻译检查，报告无页面错误。首次隔离浏览器未报告 service worker 启动，新的临时 profile 重试通过；不将启动超时计为功能通过。[集成后真实页面报告](./github-release-lines-20260912/integration-live-report.json)。

集成后的覆盖率测试 250 文件、5,061 项通过，但全局覆盖率门槛未通过：statements/lines 99.99%、branches 99.97%、functions 100%。在未修改的主分支 `0008a791` 的独立源码快照上复跑，得到相同百分比与完全相同的缺口（`src/core/glossary/transfer.ts:29-30,37-38`、`src/core/translation/text.ts:306,309`）；本次修改的候选引擎、规则编译/校验、适配器和渲染模块均为 100%。没有调整覆盖率门槛或忽略这些缺口，也不将本次全局覆盖率命令标为通过。

## 额外站点证据的限制

MDN 的悬浮检查在主分支 `8ac04042` 上同样失败：页面初始化后 `main pre, main code` 从 312 个变成 220 个，两次运行均观察到的结构变化触发静态 DOM 契约，未归因于本次修复；没有译文节点进入这些区域。最终构建的 MDN 全文检查通过。该悬浮 case 不计入成功矩阵。

既有 `github-project-pr` case 指向 PR #428，但它期待的英文正文与该 PR 当前中文正文不一致，页面就绪契约超时；属于过期测试样本，不算本次通过或产品回归。用户指定的 GitHub Release 页面已通过独立的真实页面完整检查。

维基百科美国长页在首次全文滚动后停止进展，触发 10 分钟 watchdog；该全文 case 不计入成功样本。

合入后公开正文夹具在 1120px/360px 下通过，动态新增、服务失败重试、完整恢复均通过。[集成后夹具报告](./github-release-lines-20260912/integration-fixture-report.json) · [覆盖率基线对照](./github-release-lines-20260912/integration-coverage-report.json)。
