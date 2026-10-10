# 性能、体积与链路审计（2026-09-30）

本轮基于 `83a7783a23e4b440e2422d7b8ed1e1adb55706db`，在独立分支 `codex/performance-size-audit-20260929` 实施。未修改主工作区、参考仓库、依赖版本、用户配置或已安装扩展。

扫描脚本遍历 **684 个自有运行时源码文件、9,900 个函数体**，包含回调及 Vue script；逐项记录原始文件行号、文件摘要、循环、异步等待、DOM 读取、订阅、调度和清理操作，解析错误为零。覆盖扩展入口、全部 feature、core、services、providers、platform、shared/UI、Userscript 与 Obsidian。见 [扫描汇总](./function-summary.json)。

这里的“逐函数扫描”指自动结构扫描和热点索引；人工审查重点是高频调用、异步所有权、清理、缓存、跨端打包和可疑未使用符号。它不等于逐函数人工证明，也不等于所有文件 100% 测试覆盖或零缺陷。第三方预构建资源、生成目录、Vue 模板表达式与仅声明的类型签名不计入函数总数；它们分别由资源验证、构建和组件测试约束。

## 已实施的优化

| 位置 | 原因与结果 | 验证 |
| --- | --- | --- |
| 视频原生字幕匹配 | 原来每次更新都规范化整个字幕时间线的文字。现在先筛时间范围，命中当前字幕时仅规范化候选，未命中才检查陈旧文字 | 6,000 条字幕每次命中的文本读取从 6,000 次降至 1 次；向前、向后跳转和原地文本修改回归 |
| API Key 请求编排 | 单 Key 或关闭轮询时省去服务身份和全部 Key 摘要、健康池操作 | 保留显式单 Key 检测、多 Key 重试、取消及凭据隔离；证明普通单 Key 不读取无关服务端点 |
| SHA-256 | 七处热路径改用现有 noble-hashes，统一一个纯函数入口 | 与 Node 和旧实现比对已知值、中文、Unicode、分组边界及长文本；孤立代理项按标准 UTF-8 替换处理 |
| 请求限速 | 最近一秒的开始时间已按序保存，直接索引限速边界，去掉每次倒序统计 | 现有调度、取消、公平性和回拨时钟测试 |
| 内容脚本依赖 | 快捷键与 frame 直接导入所属功能的 public API，避免经总入口携带无关 UI 副作用 | 保留原行为断言，更新实际边界 mocks；架构、frame、快捷键与构建验证 |
| OCR 打包 | 把 Base64 内嵌 WASM 拆成扩展本地 JS 与原始 WASM；保持原 vendor 文件、引擎字节与 corePath | 二进制相等、WebAssembly.validate、Chrome/Firefox 路径、未知格式拒绝、真实 OCR 对比 |
| 死代码 | 删除已经由 Userscript 入口内联解压取代的 `prepareUserscriptCss` | 全仓引用检查、严格未使用符号检查、Userscript 构建与 verifier |

CryptoJS 仍用于其他签名/加密算法，未整体删除。未把“只被测试或构建使用”的导出当作死代码，也未合并不同版本的本地 AI 引擎。

## 已修复的缺陷

- SPA 新标题写入后、MutationObserver 回调前，迟到翻译可能覆盖新标题。提交前新增当前标题快照核对；源标题变化立即取消旧请求，包括新标题为空或已是目标语言时。
- 语言统计使用系统 locale 的小写转换，在土耳其语环境中会改变英文大写 I 的归一化结果。改用稳定的 Unicode 小写转换，并补充真实统计检测回归。
- 本地翻译旧 Worker 被取消后，其迟到错误会终止新 Worker。仅允许当前实例处理生命周期错误；回归同时验证新实例的真实错误仍正常上报。
- 文档翻译只快照语言，默认服务和可变参数中的服务/模型可能在后续批次变化。现在快照解析后的服务与模型，批量和并发逐段路径都沿用同一选择。
- 基线 Userscript 构建缺少当前界面文案对应的五个语言资源文件。先补齐内容寻址资源；合并准备时纳入主分支的术语库和写作更新，再把资源版本指向包含最终文案资源的已发布提交 `25cb9134a9e90400e719836ecda04e950f409760`。

标题、系统 locale、Worker 和文档服务测试均先在旧行为上失败，修复后通过。

## CPU 实测

同一机器、依赖和 Node 版本，基线与工作树分别打包实际模块，先预热，再交替顺序测量七轮，取中位数。原始样本和环境见 [benchmark.json](./benchmark.json)。

| 合成工作负载 | 基线 | 当前 | 耗时降低 |
| --- | ---: | ---: | ---: |
| 6,000 条字幕，匹配 500 次 | 333.99 ms | 25.01 ms | 92.5% |
| 单 Key 编排 10,000 次 | 81.92 ms | 8.99 ms | 89.0% |
| 64 UTF-16 单元 SHA-256，5,000 次 | 28.94 ms | 13.56 ms | 53.1% |
| 1,024 UTF-16 单元 SHA-256，5,000 次 | 266.12 ms | 86.04 ms | 67.7% |
| 50,000 UTF-16 单元 SHA-256，200 次 | 521.81 ms | 148.15 ms | 71.6% |

这些是局部 CPU 成本，不能解释为网页整体快了相同比例；不包括网络、供应商推理、DOM 布局与设备差异。没有以不稳定的墙钟时间作为单元测试通过门槛。

## 体积实测

| 测量口径 | 基线 | 当前 | 减少 |
| --- | ---: | ---: | ---: |
| Chrome 构建目录全部文件 | 81,507,626 B | 80,514,636 B | 992,990 B（1.218%） |
| 同参数 ZIP：JSZip 3.10.1，DEFLATE 6 | 23,489,848 B | 23,098,455 B | 391,393 B（1.666%） |

见 [构建明细](./bundle-size.json) 和 [ZIP 口径](./zip-comparison.json)。ZIP 使用排序路径和固定时间戳，只做可比测量，不是商店发布包。OCR JS 不再解析、保留约 3.83 MB 的 Base64 文本；独立 WASM 为 2,871,377 B，字节与原内嵌二进制一致。未单独宣称浏览器峰值内存下降数值，因为没有做可靠的堆/进程内存采样。

三份不同用途的 AI WASM 仍合计 53,620,581 B，是剩余体积主要来源。重复的 frame CSS 仍有 78,629 B，但现有 frame 加载路径分别引用各自资源，未为了省文件直接删掉。进一步削减引擎或合并不同 ABI 需要独立兼容性验证。

## 验证结果与边界

- 全量 Vitest：**400 文件 / 8,550 项通过**。随后加入 OCR 拆包、Worker 和文档快照修复，按相关范围增量验证：OCR 45 项、Worker/文档/下载 95 项、最终改动范围 13 文件 / 241 项均通过。前后数字有交集，不相加为一次全量结果。
- 严格覆盖配置：**318 文件 / 7,101 项通过**，配置所列模块 statements/branches/functions/lines 均 100%。文档最后一次修改单独复测 26 项，文档服务四维仍 100%；不把这个比例泛化为全仓覆盖。
- 测试分类审计：400 文件，29 架构 / 261 单元 / 79 功能 / 31 回归；无重复分类、`.only` 或违规忽略。脚本统计 5,136 个声明用例，参数化展开数量与 Vitest 不同。
- 最终 Chrome、Firefox、Userscript、Obsidian 与文档构建，Userscript verifier、扩展 manifest 验证、Vue/TypeScript 类型检查与 `noUnusedLocals/noUnusedParameters` 通过。
- ACP bridge 本地夹具 **7/7**。初次沙箱禁止监听 `127.0.0.1`，获准运行本地端口后通过；未使用真实 ACP 账号。
- 隔离真实 Edge：字幕夹具 **29 项**通过；九种语言的悬浮、全文、相邻段落开关、动态改写、标题、语言切换及排除验证通过。翻译响应受控，不代表真实 YouTube 或在线供应商质量。见 [字幕报告](./youtube-browser.json)、[多语言报告](./multilingual-browser.json)。
- 隔离真实 Edge OCR：原始/拆包引擎都识别为 `流畅阅读 FluentRead 123`，置信度均 91，重复识别一致；移除临时 Worker 中的语言模型后正确拒绝并保留错误。使用本地中英模型和打印体图片，不代表任意图片准确率。见 [OCR 报告](./ocr-browser.json)。
- 浏览器均为临时 profile、后台启动、第二屏正常可见窗口，报告记录 `macos-background-cdp` / `launchservices-no-foreground` / `background-visible-no-focus` / `browserFrontmost:false`。已检查字幕及多语言截图。

扫描覆盖配置/迁移/凭据、provider 和 broker、缓存/统计、全文/悬浮/划词/输入、图片/圈选、文档、视频/本地推理/TTS、阅读/写作、词书、界面与存储边界。没有证据支持改写的路径保持现状，由全量套件和构建约束。未执行所有真实供应商、Firefox 实机、移动设备或商店发布验证；未修改参考项目，也未借用参考项目实现。

## 复核

```sh
node scripts/testing/inventory-runtime-functions.mjs /tmp/fluentread-functions.json
node scripts/testing/benchmark-runtime-hotpaths.mjs 83a7783a /tmp/fluentread-benchmark.json
node scripts/testing/analyze-bundle-size.mjs .output/chrome-mv3 /path/to/baseline-chrome
pnpm test tests/sha256.test.ts tests/apiKeyRotation.test.ts tests/fullPageTitleTranslation.test.ts tests/languageStatistical.test.ts tests/videoSubtitleLogic.test.ts tests/translationRequestScheduler.test.ts tests/wasmDiagnostics.test.ts tests/localTranslationRuntime.test.ts tests/documentTranslationApi.test.ts
```

完整逐函数 JSON、原始日志、截图和基线构建保存在本机 `/private/tmp/fluentread-audit-20260929/`。扫描脚本可在任意检出重新生成精确到函数行号的清单。构建使用当前机器已有依赖的临时链接，不代表一次全新安装依赖的验证。

合并准备时额外纳入主分支 `25cb9134`（术语库与写作界面更新）。上述性能、体积及函数总数是审计提交 `8e764388` 相对 `83a7783a` 的测量，不包含这两项独立主分支功能的新增成本；集成验证另行记录在 PR 中。
