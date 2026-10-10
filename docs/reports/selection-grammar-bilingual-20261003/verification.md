# 句法双标签与原文译文对照验证

实现依据为用户提供的句法分组截图和对“读懂”滚动行为的确认。本次独立实现，未引用 read-frog 或 kiss-translator 的实现。

- 原文片段显示本地化的作用与词性：主语 · 名词短语、谓语 · 动词、宾语 · 名词短语、后置定语 · 不定式短语。保留原文顺序与标点。
- 默认句法提示词按有意义的完整短语分组；识别并升级旧内置格式，保留用户自定义正文。真实模型是否遵循格式仍取决于供应方，本报告的模型回答是确定性夹具。
- 点击读懂后保留上方原文与普通译文，默认定位到解读。上滚和查看原文可对照；提前进入学习不会中止正在进行的普通翻译。译文晚到时保持回答位置，也不会抢回用户上滚的位置。
- 译文仅用于匹配的原文；历史原文或扩展整句不同于当前选区时，不套用旧译文。

真实浏览器范围见 report.json：生产扩展、独立临时 Edge profile、后台 CDP、第二屏可见窗口、前台保护；中文、英文、390px 深色布局及两种译文晚到情形通过，宿主页面未滚动，页面错误为 0。翻译与 AI 使用本地确定性夹具；未验证真实供应方回答质量或 Firefox 运行时。

针对性自动化：阅读展示、学习面板生命周期、提示词配置与运行、i18n、划词生命周期；核心句法锚定、词性与默认提示词四维覆盖率均为 100%。另验证源码注释与 provider 边界、类型检查、测试登记审计、Chrome / Firefox / Userscript 构建、Userscript verifier 与文档构建。未运行全量回归。

依赖通过临时链接复用主检出的 node_modules；交付前移除链接。本报告不代表干净安装验证。原先的单词查询修复保留在同一分支的先前提交中。

Final integration verified b96d912167cad0c5c31272d585fa89e3283545d8 against main 3809af1249642c6dcd768c725c53671bdb2ef976. Refreshed language assets are pinned to 450eb0b86bdc476a1f218d17d673eb6405987cfd. All 291 affected tests and 9 production-extension browser fixtures passed with no page errors. Type checking, Chrome / Firefox / Userscript builds, Userscript verifier, docs build and docs link audit passed (75 pages, 3810 links, 708 anchors, 90 images). This subsequent commit records evidence only and does not change runtime code.
