# 扩展体积与模型下载优化

开发包增至约 166 MB 的主要原因是三份 ONNX WASM，以及开发脚本中的内联源码映射。图片合计 205,888 字节，约 0.21 MB。模型权重原本已按需下载；本次进一步统一引擎资源、开发 Worker 与模型下载来源，减少 TTS 下载缓冲和重复缓存。

## 实际产物

下表按十进制 MB 展示实际文件字节数，未把未压缩包与 ZIP 混为一项。正式包基线从 `origin/main` 的 `4d3ebdc5` 重新构建；开发包与 ZIP 基线取用户主检出现有产物。因此 ZIP 的对照不声称是同一提交重新打包。

| 产物 | 原大小 | 本次 | 减少 |
| --- | ---: | ---: | ---: |
| Chrome 开发包 | 166.40 MB | 63.44 MB | 61.88% |
| Chrome 正式包 | 107.92 MB | 60.23 MB | 44.19% |
| Chrome ZIP | 29.72 MB | 18.37 MB | 38.17% |
| Firefox 正式包 | — | 60.23 MB | — |
| 包内 WASM 合计 | 81.99 MB | 34.90 MB | 57.44% |

[正式包明细](./assets/extension-size-20261006/production.json)、[开发包明细](./assets/extension-size-20261006/development.json)、[Firefox 明细](./assets/extension-size-20261006/firefox.json)。

## 实现

- OPUS/Whisper、Kokoro 和 Paddle/LaMa 共用锁文件中已有的 Kokoro ONNX runtime，JS、WASM 与 Tensor ABI 配套，移除两份其他版本的 WASM。没有升级依赖或锁文件。
- 三个模块 Worker 在开发与生产中统一分组构建，复用共享块；已验证开发 Worker 增量重建与重新载入。
- 开发构建默认关闭内联源码映射，保持未压缩代码。需要源码调试时使用 `FLUENTREAD_DEV_SOURCEMAPS=1 pnpm dev`。
- TTS 文件流式写入 Cache Storage，下载时不再构造完整 `ArrayBuffer` 及其副本；关闭 Transformers 的第二次缓存写入，只保存固定版本。优先读取固定版本，保留旧 main-only 缓存，只清除来源头能证明属于当前固定版本的重复 main 文件。
- `pnpm analyze:bundle` 新增按文件类型和目录统计。构建结束按真实文件字节执行体积预算：正式包 65 MB，普通开发包 70 MB，显式源码映射调试 170 MB。超出时构建失败并提示运行分析器。

ONNX、wllama 与 Tesseract 共 34.90 MB WASM 是本地推理的必要执行资源。[Chrome MV3 的远程代码规则](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)要求 JS/WASM 随扩展打包，不能靠首次使用时远程下载这些执行资源缩小包。模型权重和语言包继续按需下载。保留 PDF 字体/CMap、词典、图标和许可证；剩余相同 frame CSS 约 0.1 MB，属于两个独立内容脚本的必要样式。未复制、修改或依赖参考仓库。

## 下载来源与缓存

| 数据 | 自动尝试顺序 | 文件与缓存约束 |
| --- | --- | --- |
| 本地翻译、Kokoro 模型和音色 | 简体中文浏览器：`hf-mirror.com` → `hf-mirror.net` → Hugging Face；其他语言反向优先官方 | 保留固定版本、原路径与稳定缓存键；本地翻译保留分块断点续传及 SHA-256 |
| Paddle/LaMa | 同上，继续尊重明确保存的官方/镜像优先偏好 | 保留固定版本、容量、SHA-256、离线导入与已完成文件复用 |
| Whisper Tiny/Base | 魔搭 → 按浏览器语言排序的 Hugging Face 三源 | 仅已登记的相同公开模型使用跨平台映射，保留既有魔搭缓存键与 q4/q8 文件清单 |

浏览器语言仅是顺序提示，不推断用户所在国家。下载不携带用户凭据或网页来源。网络错误、HTTP 错误、网页挑战响应和断流会切换来源；取消与磁盘容量不足立即结束。TTS/Whisper 直接流式消费响应，保留逐文件总时限和 20 秒无数据超时；本地翻译与漫画保留各自的进度、校验和取消协议。

当前机器对官方、两个镜像和魔搭的十个实际配置/字典文件 GET 全部通过，固定版本文件的摘要一致。[下载来源记录](./assets/extension-size-20261006/download-sources.json)。这不是中国大陆各运营商实测，也没有逐来源下载所有大模型；镜像是第三方服务，不能承诺每个地域始终可用。

## 推理兼容与性能边界

共享 runtime 实际验证发现其 QDQ 转置优化不兼容 OPUS q8 的合并权重。只对 OPUS 与 Whisper q8 排除 `QDQSelectorActionTransformer`，其余完整图优化仍启用，Whisper q4 保留默认设置。[锁定上游会话配置](https://github.com/microsoft/onnxruntime/blob/b7804b056c/include/onnxruntime/core/session/onnxruntime_session_options_config_keys.h)支持指定排除优化器；升级 runtime 时应重测后评估移除此兼容项。

真实生产 Worker 的 OPUS 英译中样本首次加载并翻译约 1.5 秒，复用后短句约 85 毫秒。Paddle 在 WebGPU/WASM 都识别出 `Hello world`，LaMa 两种后端均输出 12,288 个有限值。模拟 Whisper q4 初始化失败后，实际 q8 模型成功识别合成语音。当前样本耗时只用于验证可运行和模型复用，没有同条件旧版计时，不能据此声明整体推理提速；流式下载减少显式 JS 缓冲复制，未测量它对进程峰值内存的改善。[模型记录](./assets/extension-size-20261006/models.json)。

## 验证范围

15 个相关测试文件、148 个用例通过，覆盖 runtime 资源配套、下载源回退、断流、超时、校验、取消、磁盘不足、缓存升级、模型文件清单与体积预算。新增下载模块四维 V8 覆盖率均为 100%。类型检查、测试分类审计、Chrome/Firefox 构建、Chrome ZIP、油猴语言资源生成/构建/verifier 通过。

源文件头、模块边界与 provider 边界通过。验证归属审计仍有一项基线失败：十九个已有模块未登记严格覆盖边界；干净 `4d3ebdc5` 基线复现相同路径。本次新模块已登记，没有新增覆盖缺口。

隔离 Edge 验证开发与正式 Worker 的加载、消息、CPU/WebGPU Identity session 及复用。真实模型专项覆盖 Paddle/LaMa、OPUS、Kokoro 中英朗读、Whisper Tiny q4/q8，以及 GPU 不可用、初始化失败与设备丢失时的 CPU 回退。早期音频专项完成十个推理案例后，在设置页步骤触发前台保护而以失败结束；关闭截图和设置页的最终专项也完成六个 GPU/CPU/设备丢失推理案例，但最后新页焦点检查仍检测到测试 Edge 成为前台，脚本随即结束并清理。本记录只把其中的模型推理结果视为通过，未把两次完整音频浏览器脚本计为成功；Paddle/LaMa、OPUS 与 q8 限定专项完整通过。

浏览器使用自有临时 profile、第二屏正常窗口，`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`。通过的限定专项记录 `browserFrontmost=false`；音频专项的最终焦点失败另行保留，初始后台记录不能代表全程后台。结束后清理自己的浏览器和 profile。受控文字/图片/合成语音不是广泛模型质量、真实 X 音轨采集、Firefox 设备、大陆网络或商店发布验收。

## 重复测量

```sh
pnpm build
pnpm analyze:bundle .output/chrome-mv3 /path/to/baseline/.output/chrome-mv3
pnpm zip
pnpm build:firefox

# 手动加载、禁止 WXT 自动启动浏览器
FLUENTREAD_DISABLE_BROWSER_RUNNER=1 pnpm dev
pnpm analyze:bundle .output/chrome-mv3-dev
```

浏览器模型验证命令与所需离线文件见 [测试与回归](../testing.md#扩展体积与共享推理引擎)。
