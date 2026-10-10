# pnpm zip 打包速度优化（2026-09-30）

在同一台 macOS arm64 机器上交替运行原版和优化版各三次，`pnpm zip` 的总耗时中位数从 47.314 秒降到 34.310 秒，减少 27.5%。最终扩展 ZIP 仍略小，四份原始 WASM 的 SHA-256 与原版完全一致。

## 改动及依据

- `wxt.config.ts` 将 ZIP 的 DEFLATE 压缩等级从 WXT 默认的 9 调整为 6。继续使用 WXT 自带的完整构建与归档流程，保留 Firefox 源码包和全部扩展文件。
- 在 `entrypoints:grouped` 中将 `localTranslationWorker`、`localTtsWorker`、`videoTranscriptionWorker` 组合为一个 ESM 构建组。三个调用方原本均使用 `new Worker(..., {type: 'module'})`；合并构建使重复的 Transformers/ORT 依赖只解析、输出一次。运行时仍是各自独立的 Worker 实例。
- 只对生产构建命令启用分组，开发服务器沿用原有行为。白名单之外的入口、内容脚本、classic background 和扩展 UI 分组均保留原有构建方式。
- 未更换框架、压缩库或依赖版本；Kokoro 使用的 Transformers 4.2.0 与翻译/转录使用的 3.8.1 保持独立。没有新增跨仓库依赖，也未借鉴参考仓库代码。

核对了 [WXT 官方打包说明](https://wxt.dev/guide/essentials/publishing.html) 和本项目实际安装的 WXT 0.20.18 源码：`core/zip.mjs`、`core/utils/building/group-entrypoints.mjs`、`core/utils/building/build-entrypoints.mjs`、`core/builders/vite/index.mjs` 以及 `types.d.mts` 的公开 hook 定义。当前文档版本更新，因此具体兼容性以锁定版本的源码为准。`wxt zip` 每次重新完整构建，没有跳过构建或复用旧 ZIP。

## 测量方法

基线提交：`df5552de23ddd33f9aeded5dec7afd631ba5afc8`。Node 20.11.1、pnpm 9.12.1、WXT 0.20.18、Vite 5.4.19。依赖通过任务 worktree 中临时 `node_modules` 链接复用现有安装，未计入安装时间。

在同一 worktree 中交替使用基线和最终 `wxt.config.ts`，顺序为原版 1、优化版 1、原版 2、优化版 2、原版 3、优化版 3。各次执行相同的 `pnpm zip`；Python `time.monotonic()` 记录整个进程墙钟时间，编译和压缩分项取 WXT 日志。任务自身未并行运行其他重型验证。机器整体负载仍有波动，因此保留全部测量，不将本机结果视为所有机器的固定收益。初步探索测量未纳入以下三轮统计。

| 轮次 | 原版编译 | 优化版编译 | 原版压缩 | 优化版压缩 | 原版总耗时 | 优化版总耗时 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 27.6 s | 32.8 s | 18.2 s | 5.954 s | 47.314 s | 40.697 s |
| 2 | 28.6 s | 26.8 s | 12.4 s | 6.051 s | 42.393 s | 34.310 s |
| 3 | 39.3 s | 25.6 s | 11.7 s | 6.257 s | 52.509 s | 33.307 s |
| 各列中位数 | 28.6 s | 26.8 s | 12.4 s | 6.051 s | 47.314 s | 34.310 s |

编译分项中位数减少 6.3%，压缩减少 51.2%。这些是分别统计的中位数，分项之和不等于总耗时中位数。编译收益较小且波动明显，主要稳定收益来自压缩阶段。

## 体积与完整性

以下取第三轮的完整产物，MB 使用十进制。不同轮次原版后台 JS 本身存在少量 minifier 输出差异，未承诺 ZIP 逐字节可复现。

| 产物 | 原版 | 优化版 | 减少 |
| --- | ---: | ---: | ---: |
| Chrome 未压缩目录 | 80,577,140 B | 79,688,436 B | 888,704 B |
| Chrome ZIP | 22,942,403 B | 22,884,595 B | 57,808 B |

降低压缩等级本身会轻微增大归档；共享 Worker 依赖抵消了这部分增加。最终 Chrome 包约 22.88 MB，Firefox 包为 22,884,744 B。

两种扩展 ZIP 均有 365 个文件，已通过 CRC 校验，所有归档文件逐字节等于对应构建目录；不存在嵌套 `.gz`、`.br`、`.zip`。Firefox 源码包也通过 CRC 校验，配置、锁文件、package.json 与构建辅助脚本均与本地一致。

Chrome manifest 与基线一致。三个 Worker 的静态 import 递归检查全部指向包内已有文件，新增加的三个共享 chunk 均被归档。OCR、Wllama 和两份 ONNX WASM 的路径及 SHA-256 保持不变。

## 验证

- `pnpm zip` 三轮成功；`pnpm zip:firefox` 成功。这两个命令均执行完整生产构建，Firefox 同时生成源码归档。
- `pnpm compile`、`pnpm test:audit`、`pnpm verify:extension-manifests --require-firefox-archives` 通过。
- 7 个相关测试文件、81 项用例通过；新增 4 项分组测试覆盖顺序与对象保留、重复调用、部分入口、同名非 Worker 和未知入口的边界。
- 生产包真实 Edge 验证通过：三个 Worker 各创建两个独立实例，启动前排队消息，验证空输入错误、后续响应及请求号隔离，共 16 条预期响应。
- 原有 ORT 微型 Identity 图验证通过：两套 runtime 各在 WASM/WebGPU 上建会话，计算 `[42]`，释放后再建会话计算 `[-7]`，共 4 组。
- `pnpm docs:build`、`git diff --check` 通过。

相关测试命令：

```bash
pnpm test tests/extensionManifestContract.test.ts tests/localTranslationInference.test.ts tests/localTranslationArtifacts.test.ts tests/localTtsWorker.test.ts tests/videoAiWorker.test.ts tests/onnxWasmBinary.test.ts tests/wasmDiagnostics.test.ts
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-ort-runtime-smoke.cjs --extension-dir .output/chrome-mv3 --artifacts-dir /private/tmp/fluentread-ort-smoke
```

浏览器使用临时 profile 和生产目录副本，测试页通过 focus-safe helper 创建，保持原始 CSP：`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`，窗口完整位于第二块屏幕。测试结束后关闭此次实例并清理临时 profile/副本。

真实 Worker 测试覆盖模块加载和无模型消息，ORT 推理使用独立探针 Worker；本轮未下载完整翻译、语音或转录模型，未验证模型质量、Firefox 真实浏览器推理或商店审核。没有运行全量业务回归或修改用户配置。

本次原始本机证据位于 `/private/tmp/fluentread-zip-speed-20260930/`：`paired-results.json`、六份 `*-paired-*.log`、`archive-validation.json`、`all-archive-validation.json`、`worker-imports.json`、`browser/report.json` 和相关检查日志。
