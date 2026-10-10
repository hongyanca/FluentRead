# 漫画提前翻译验证记录

[实施与产品报告](../../maintainers/manga-prefetch-compatibility-20261003) · [全部 235 项站点清单](../../maintainers/manga-sites-20261003) · [浏览器摘要](./browser-summary.json) · [机器可读清单](./site-scope.json)

浏览器摘要只提交测试状态与指标，不提交漫画页面图片、原文或浏览器个人配置。完整本地截图与阶段日志保留在工作区 `artifacts/manga-prefetch-20261003/`。

## 已确认验证

| 项目 | 结果 | 日志或证据 |
| --- | --- | --- |
| 受影响 13 文件 | 351 项通过 | `/private/tmp/fluentread-manga-prefetch-tests-final.log` |
| 真实 sender 来源优先于伪造消息地址 | 10 项通过 | `/private/tmp/fluentread-manga-prefetch-source-auth-final.log` |
| 严格漫画覆盖 | 10 文件、133 项通过；13 核心模块四维 100% | `/private/tmp/fluentread-manga-prefetch-coverage-final.log` |
| MANGA Plus 实页与真实 Google | 7 项通过；当前加后三张；准备后下一译页 89ms | `mangaplus-verified/` |
| Pixiv 实页与真实 Google | 7 项通过；只处理展开阅读器三页；无字页原图保留；面板命中通过 | `pixiv-verified/` |
| 受控阅读器和真实 PaddleOCR | 7 项通过；仅处理四张，后两张与无关图片未处理；下一译页进入视口、暂停恢复、3→0 持久化 | `fixture-verified/` |
| 模型网络与前台隔离 | 上述三组均模型请求 0、使用临时 profile，结束清理；第二屏可见但不抢焦点 | 同上浏览器摘要 |

## 构建与仓库检查

| 项目 | 最终结果 | 日志 |
| --- | --- | --- |
| 类型检查 | `pnpm compile` 通过 | `/private/tmp/fluentread-manga-prefetch-compile-final.log` |
| Chrome MV3 | `pnpm build` 通过 | `/private/tmp/fluentread-manga-prefetch-chrome-final.log` |
| Firefox MV2 | `pnpm build:firefox` 通过 | `/private/tmp/fluentread-manga-prefetch-firefox-final.log` |
| 扩展清单 | `pnpm verify:extension-manifests` 通过 | `/private/tmp/fluentread-manga-prefetch-manifests-final.log` |
| userscript | `pnpm test:userscript` 构建与 verifier 通过 | `/private/tmp/fluentread-manga-prefetch-userscript-final.log` |
| 文档 | `pnpm docs:build`、`pnpm docs:check` 通过 | `/private/tmp/fluentread-manga-prefetch-docs-final.log`、`/private/tmp/fluentread-manga-prefetch-docs-check-final.log` |
| 测试清单审计 | 446 文件、5742 项登记；通过，不等于执行全量测试 | `/private/tmp/fluentread-manga-prefetch-audit-final.log` |

Chrome 与 Firefox 的打包产物不意味着 Firefox 实机验证；userscript 构建通过不代表支持漫画本地模型链路。最后一轮实页验证后，仅追加站点目录七个已核对官网域名，既有两站适配、会话、识别与绘制代码不变；追加后重跑严格覆盖、类型和三种发布出口。

架构检查共 30 文件，1219 项通过、5 项失败：`content runtime` 历史行数上限，三个旧脚本未登记验证归属，十个既有非组装模块未登记四维严格覆盖，划词测试脚本旧设置锚点断言，以及划词界面的 wheel passive 旧断言。后两项的测试/源码与集成的 `origin/main` 相同；前三项已有前轮主分支快照失败记录。本轮另核对 17 个相关文件与主分支相同；runtime 按测试相同计数法为主分支 282、本轮 281，旧上限 277，见[基线文件证据](./architecture-baseline.json)。未修改阈值或忽略断言。

工作树从前轮 PR #770 继续，集成主分支 `00e59e31`。新增语言资源快照提交 `d46b49c8a34537f2c9d3ef025f2247f0dda16d01`，userscript 资源 URL 固定到该提交。只提交本轮源代码、测试、文档和语言资源；主检出和参考仓库未由本轮改写。

## 质量和覆盖边界

仅有 MANGA Plus 与用户指定 Pixiv 页面通过实页链路验收。209 项是通用检测目标，24 个品牌名称待域名确认；不是 235 个网站都已可用。Pixiv 日文仍有“口”误识别、“敬語”误读为“散語”及背景修补块。manga-ocr 是待评测候选，没有集成，不报告其质量提升。没有全球逐国网络验收、真实 Firefox、登录账户或商店发布证据。
