# 免费翻译内部新增网页候选验证

日期：2026-09-08。基础提交：`10dbc4f`。分支：`feat/free-translation-web-providers`。

## 交付范围

腾讯交互翻译、Yandex、火山翻译仅加入免费翻译内部候选，可启停和排序，默认关闭。没有新增独立服务，没有 Apertium 或 LibreTranslate 变更。保留已有顺序和凭据，沿用超时、取消、冷却和配置快照。

## 自动验证

- 专项 58 项通过；新适配器、免费编排与免费配置 statements/branches/functions/lines 均为 100%。
- 测试审计通过；架构 27 文件、888 项通过。
- 全量 277 文件通过、1 文件失败：5,358 项通过、1 项失败。
- 完整覆盖率套件 4,386 项通过、1 项失败，因同一失败不能声明全仓覆盖率通过。
- 唯一失败为 `tests/model.test.ts:539` 仍期待图片翻译默认开启，生产配置默认关闭；将未修改的基础提交归档到独立临时目录后，同一测试复现。没有修改断言来掩盖失败。
- TypeScript/Vue 编译、Chrome MV3、Firefox MV2、userscript 构建与 verifier、文档构建通过。

## 生产扩展实测

使用 `scripts/testing/run-service-catalog-ui-test.cjs --live true`，临时 Edge profile、生产 MV3 产物。验证七个内部候选、三个新增候选默认关闭、独立目录无新项、启用排序及刷新持久化、390px 无横向溢出。逐一只启用一家，通过扩展“检查连接”完成内置测试句真实翻译，三家均成功。没有使用用户网页内容、账号密钥、代理或日常浏览器 profile。

- transmart：连接正常，已完成真实翻译请求（230 ms）。
- yandexFree：连接正常，已完成真实翻译请求（2284 ms）。
- volcengineFree：连接正常，已完成真实翻译请求（394 ms）。

运行边界：`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`。证据目录 `/tmp/freeweb-ui-live`，包含 report.json 与截图。实测不代表长期可用性或无限额度。

完整 UI 技能脚本已尝试，因第 533 行仍等待旧标题“让阅读自然地流动 / 翻译功能已暂停”而超时，未计为通过；当前服务目录专项通过。Firefox 和 userscript 仅有构建证据，未声称实际运行验证。
