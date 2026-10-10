# 安装体积与启动性能优化验收

日期：2026-09-13。基线：`d4fcddd7e093a8e8a4bbc11067a07211e2b90644`，生产 Chrome MV3。所有改动在独立分支 `codex/performance-lightweight-20260913` 完成，未修改参考仓库，未升级依赖、修改版本号或发布商店。

## 测量结果

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 扩展目录实际文件字节 | 85,216,632 B（81.27 MiB） | 47,957,998 B（45.74 MiB） |
| ZIP 下载体积 | 24,256,989 B（23.13 MiB） | 23,901,906 B（22.79 MiB） |
| 设置页初始 DOM 元素 | 5,379 | 873 |
| 设置页初次加载 JavaScript | 1,802,094 B | 1,041,083 B |
| 设置页初次加载 CSS | 822,560 B | 252,909 B |
| Popup 初次加载 JavaScript | 1,068,566 B | 952,087 B |
| Popup 初次加载 CSS | 477,180 B | 161,986 B |

安装目录减少 **43.7%**。ZIP 原本已经压缩，因此下载体积只减少 **1.46%**；不能将安装目录节省量当作网络下载节省量。浏览器商店的签名、压缩和磁盘块分配可能产生不同的展示数字。

| 本机测量 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 设置页首次可用 | 485.4 ms | 154.6 ms |
| 设置页可用时间中位数 | 368.0 ms | 150.2 ms |
| Popup 首次可用 | 279.1 ms | 228.2 ms |
| Popup 可用时间中位数 | 122.8 ms | 82.4 ms |
| 普通网页 content 就绪中位数 | 165.5 ms | 169.0 ms |

首开指独立临时 profile 中的第一次打开；中位数取同一浏览器内五次新建页面。文件可能已在操作系统缓存中，不是清空系统缓存后的硬件冷启动，也不是跨设备性能保证。可用时间以关键 DOM 出现后的首个动画帧为准。每页还等待 800 ms 再采集 CDP 指标，随后观察 1,200 ms 空闲窗口。

普通网页夹具包含 1,000 个段落，content 就绪时间没有明确改善，不宣称所有场景都更快。Popup 的瞬时 JS heap 采样也没有下降；GC 时机和 renderer 复用会影响该值，不能把本次数据当作所有界面的内存占用下降。网页侧的改进是禁用功能不注册监听器，以及图片连续指针事件每帧仅检测一次，这些边界由生命周期测试验证。

原始记录：[基线启动](./performance-20260913/baseline-startup.json)、[最终启动](./performance-20260913/optimized-startup.json)、[目录字节](./performance-20260913/bundle.json)、[ZIP](./performance-20260913/archive.json)。基线报告的 content `scriptBytes=0` 是 CDP Network 不记录声明式注入导致的旧采集缺口，不表示没有内容脚本；最终脚本已按 manifest 补算，此项不直接用两个原始字段做百分比比较。

## 三份 WASM 与 GPU

三份文件不是同一个引擎的三个副本。OPUS/Whisper 依赖 Transformers 3.8.1 的 ORT 1.22；Kokoro 依赖 Transformers 4.2.0 的 ORT 1.26；混元使用 wllama/llama.cpp。统一 ORT 版本需要另行验证模型与库兼容性，而 wllama 不能替换为 ORT。

| 使用方 | 最终文件 | 随包字节 |
| --- | --- | ---: |
| OPUS / Whisper | ORT 1.22 JSEP WASM gzip | 5,046,898 |
| Kokoro | ORT 1.26 Asyncify WASM gzip | 5,699,349 |
| 混元 | wllama.wasm | 8,457,512 |

按用户选择保留 GPU 兼容能力。首次模型初始化才读取扩展内的压缩二进制，通过浏览器 `DecompressionStream` 解压并注入 ORT；MJS 仍是扩展本地静态文件，CSP 未放宽，也没有从远程下载执行代码。初始化结束后清空注入引用，同一个 Worker 后续复用 ORT，不重复加载成功初始化过的二进制。加载失败有次数限制，损坏或缺失的静态资源不会无限重试。

真实浏览器验证还修复了原有版本匹配问题：Kokoro 导入的 ORT 1.26 WebGPU backend 需要 Asyncify pair，原 JSEP pair 的 GPU 初始化会报 `webgpuInit is not a function`。最终改用同一精确依赖中的 Asyncify MJS/WASM，仍只有一份 TTS 二进制，CPU 与 WebGPU 共用。锁定依赖的本地源码 `lib/wasm/wasm-utils-import.ts` 和 `wasm-core-impl.ts` 是本次版本选择依据。

最终生产资源在扩展 Worker 中通过 **两套 ORT × CPU/WebGPU 共四项**微型 ONNX Identity 会话检查；输出为 42，删除注入引用后第二次创建会话输出 -7。解压后的 SHA-256 与对应依赖中的 WASM 一致。这里证明资源配对、初始化和会话复用，不代表完整 OPUS 翻译、Whisper 转写、Kokoro 合成质量或 GPU 加速倍率已重新实测。记录见 [ONNX 运行时验证](./performance-20260913/onnx-runtime.json)。

当前模型策略保持：OPUS 用 WASM；Whisper 既有实验 GPU 开关仍关闭；Kokoro 仍用稳定 WASM 默认值；混元保留 GPU 优先与 CPU 回退。浏览器的页面硬件加速不会自动选择模型的 WebGPU backend，模型推理需要单独配置。[ONNX Runtime WebGPU 文档](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

## 启动与设置界面

Options 等待已保存配置和界面语言就绪后挂载，首次只创建当前分区。服务、视频、字体、数据及学习中心按访问加载，访问后的编辑状态保留。SettingsSections 与 LearningCenter 使用不同 KeepAlive key，避免缓存碰撞造成标题切换但内容停留在上一页。Popup/Options 按实际使用的 Element Plus 组件引入 CSS；UI 配置通过现有后台权威持久化协议读写，后台继续持有加密数据库与迁移能力。

按用户最后指出的问题，移除通用设置中“译文显示”的额外子标题与说明，将“翻译语言”及说明放在左侧、选择器放在右侧。七种界面语言的字段名称同步，原有目标语言值、翻译模式和样式均保留。

![翻译语言单行布局](./performance-20260913/translation-language-single-row.png)

真实生产扩展的 17 项检查通过，包含未访问分区不挂载、深链接、学习中心缓存、About 互斥显示、设置快速关闭重开、连续写入保留最后值、Options/Popup 实时同步、选择器与抽屉交互，以及上述单行布局的实际几何关系。没有 page/console errors。[UI 记录](./performance-20260913/settings-ui.json)

## 验证范围与复现

- TypeScript/Vue compile、测试唯一归类审计和架构边界检查通过；内容生命周期与图片交互共 139 项、模型/构建/focus 契约 133 项，以及最终 UI/i18n/源码头检查 684 项均通过。这些是分别执行的定向组，有部分共享测试，不将其简单相加为不重复总数。
- 新增 `wasmBinary.ts` 和 `optionalFeatures.ts` 的 14 项定向测试通过，两模块 statements/branches/functions/lines 均为 100%，不是整个仓库覆盖率声明。
- Chrome MV3、Firefox MV2、userscript 构建通过；扩展 manifest 与 userscript verifier 通过。Firefox 本次为构建验证，没有重新运行 Firefox 的真实模型或 UI。
- 浏览器使用临时 Edge profile；`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement=background-visible-no-focus`，窗口正常显示于第二屏，`browserFrontmost=false`，测试前后前台应用均为 ChatGPT。未连接日常 profile。
- 未运行全量联网模型下载或完整 provider 质量回归；这次功能回归与运行时 smoke 不冒充此类证据。已有设置、模型权重、OCR、PDF、词典及授权文件保留。

在项目根目录先构建，再执行（真实浏览器工具需要本机 Playwright 与 focus-safe helper 路径）：

```sh
pnpm build
pnpm build:firefox
pnpm build:userscript
pnpm verify:extension-manifests
node scripts/verify-userscript-build.mjs
pnpm analyze:bundle .output/chrome-mv3 /path/to/baseline
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-startup-performance.cjs --extension-dir .output/chrome-mv3 --runs 5 --playwright-root /path/to/node_modules --focus-safe-helper /path/to/focus-safe-browser.cjs
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-lazy-options-ui-test.cjs --extension-dir .output/chrome-mv3 --playwright-root /path/to/node_modules --focus-safe-helper /path/to/focus-safe-browser.cjs
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-ort-runtime-smoke.cjs --extension-dir .output/chrome-mv3 --playwright-root /path/to/node_modules --focus-safe-helper /path/to/focus-safe-browser.cjs
```

ZIP 使用 JSZip DEFLATE level 9，前后参数一致；最终校验值为 `a5e298ec00c5a74b1ea1dd9c7d1b1097c21e3611e2710d16370796d45d6dd868`。完整原始日志和覆盖率报告位于本次本地证据目录 `/private/tmp/fluentread-perf-20260913`。该安装包未进行商店发布。


## 最新主线集成验收

用户授权合并后，先整合 `origin/main` 的 `07d253b47b65315c9efd6e37a4cd43fcbc69d394`；验证代码提交为 `658cb469dc656557c9c9794ca9d4eff8fc721130`。保留主线新合入的服务目录、写作设置、翻译卡片和右键菜单改动。唯一文本冲突位于 `browserFocusSafety.test.ts`，合并时保留双方检查。

整合后重新执行 12 个定向测试文件，**970 项全部通过**；TypeScript/Vue compile、Chrome/Firefox/userscript 构建和测试审计的工具退出码均为 0。另通过扩展 manifest、userscript verifier，真实隔离 Edge 的 17 项设置 UI 与 4 项 ONNX CPU/WebGPU 检查。新模块源码未在此次主线整合中改变，前述 100% 专项覆盖率仍针对同一实现。早先定位过程中出现的失败已修复，这轮聚合检查为最终全绿记录，未运行全量回归。

合并版本安装目录为 **47,955,344 B（45.73 MiB）**。前文五轮性能与 ZIP 对比保留原始 `d4fcddd7 -> 543dce6d` 的测量口径；本节整合了之后的主线功能，不将两组提交视为同一份产物。

证据：[退出码与范围](./performance-20260913/integration-validation.json)、[最新目录字节](./performance-20260913/integration-bundle.json)、[设置 UI](./performance-20260913/integration-settings-ui.json)、[ONNX 运行时](./performance-20260913/integration-onnx-runtime.json)。日志保存在 `/private/tmp/fluentread-perf-merge-20260913`。
