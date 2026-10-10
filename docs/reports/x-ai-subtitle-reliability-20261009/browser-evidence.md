# X AI 字幕：隔离浏览器证据

日期：2026-10-09。本报告把真实媒体采集、真实 Whisper 识别与受控接口夹具分别记录；不宣称已复现或修复用户未提供的具体 X 视频。

## 版本与浏览器

精确基线由 `git archive 9ce9d7b5b` 构建。完整构建路径及 `manifest/background/content/xVideoBridge/Whisper Worker` SHA-256 见 [build-provenance.json](./build-provenance.json)。

| 构建 | Whisper Worker SHA-256 前缀 | MAIN-world X bridge SHA-256 前缀 | 验证归属 |
| --- | --- | --- | --- |
| 精确基线 `9ce9d7b5b` | `792e3b0212e064cb` | `bb6ebec208353fe0` | 旧 HLS 回退、metadata-only 失败、Tiny/Base 识别 |
| fixed immutable snapshot | `80bee67c596eb5ca` | `f22318b71931cfc5` | metadata-only、挂起清单、前段预览后失败、Base 普通话与静音 |
| refactored final immutable snapshot | `80bee67c596eb5ca` | `f22318b71931cfc5` | 新一轮浏览器启动失败，未进入扩展断言；不能记为真实 UI 验收 |

fixed Tiny 的 benchmark 在最终 snapshot 之前把完整生产产物复制进独立临时目录；其 Worker SHA 与上述两个 fixed snapshot 一致。refactored final 的 content/background 字节改变，不能把此前成功记录冒充该版本整轮验收。

成功轮使用 Chrome `154.0.8037.98`、CDP unpacked extension 安装和每轮新建的临时 profile。`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`；窗口完整位于第二屏可用区域。所有页面手势通过 CDP，没有系统鼠标或 `bringToFront()`。模型 benchmark 另外记录了推理前后的非前台 PID 检查。

## 媒体与 UI 夹具

下列夹具真实运行生产扩展和浏览器的 MSE、HLS/MP4 音轨检查与 PCM 解码。ASR 与微软翻译响应明确受控，不用于评价识别或翻译服务的准确率。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 基线：两视频资源组、晚到纯视频子清单，优选音频 rendition 返回 403 后回退 | 11 项通过；没有下载无音轨 picture 分片 | [精确基线 HLS 报告](./exact-baseline-home-recovery/report.json) |
| 基线：视频只暴露 MSE blob，正确 poster media ID，仅 GraphQL 提供 MP4 variants | 失败；15 秒内未就绪，界面显示取音失败且没有字幕 | [基线失败报告](./exact-baseline-metadata-only/report.json)、[失败截图](./exact-baseline-metadata-only/failure.png) |
| fixed：相同 metadata-only 场景，包含同媒体高/低码率和另一个媒体的 MP4 | 11 项通过；只请求当前 media111 的 low.mp4，原地显示双语字幕 | [恢复报告](./fixed-metadata-only/report.json)、[截图](./fixed-metadata-only/home-video-b-bilingual.png) |
| fixed：GraphQL 中的 HLS 请求挂住 8 秒，同时提供低码率 MP4 | 12 项通过；5587ms 完成有界发现回退和 MP4 解码/字幕展示 | [挂起回退报告](./fixed-hung-master/report.json) |
| fixed：20 秒真实音频，第一窗成功，第二窗识别接口延迟后失败 | 8 项通过；识别 73% 时前段双语已显示，失败后清原文/译文并保留重试 | [预览失败报告](./fixed-preview-failure/report.json)、[前段截图](./fixed-preview-failure/early-preview.png)、[失败后截图](./fixed-preview-failure/after-preview-failure.png) |

metadata-only 与挂起清单成功轮没有未捕获 page error。播放的 `currentTime/paused/playbackRate/volume/muted` 前后相同，页面一直留在 `https://x.com/home`。预览期间点击原文下载没有 download 事件；后窗失败没有 `fluentReadSetVideoAiSubtitleCache` 请求，因此没有把半份字幕保存或导出为完整文件。

固定版本的原 normal HLS 追加回归遇到启动层超时，尚未进入产品断言；不能把它记成通过。基线的旧 HLS 回退成功只证明旧版本这一场景。

## 真实模型识别

样本是 macOS `say -v Tingting` 合成的三条普通话，语速分别为 190、190、260。源音频只保留一次，见 [samples/manifest.json](./samples/manifest.json) 和同目录的三份 AIFF。各已执行轮的 AIFF SHA 一致；manifest 还记录 16 kHz mono PCM16 与前后各加 2 秒零 PCM 的摘要。公开模型来自登记的 Modelscope/Hugging Face 来源，旧/新轮使用相同 q4 文件摘要，模型文件留在 `/private/tmp`，没有进入仓库。

### 普通话原音

Tiny 与 Base 各测三条样本，分别指定 `zh-Hans` 和使用 `auto`。成功推理均为真实 WebGPU q4。旧/新两版本的输出在这六条调用上逐字一致，原始 CER 没有回归，也没有普遍提升。

| 样本 | Tiny 原始 CER：旧 → 新 | Base 原始 CER：旧 → 新 |
| --- | --- | --- |
| “我挟天子以令诸侯，天下都给我让道。” | 20.00% → 20.00% | 33.33% → 33.33% |
| “我们正在测试中文视频字幕，识别结果应该保持完整，不要重复。” | 46.15% → 46.15% | 3.85% → 3.85% |
| “今天我们测试自动生成视频字幕……” | 36.54% → 36.54% | 28.85% → 28.85% |

原始 CER 去掉空白和标点，但保留繁简差异；它不能视为纯语音内容错误率。Tiny 把“识别”识为“10别”，并把“自动生成视频字幕”识为“自動聲誠是評自母”；Base 对后两条内容更完整，但古语样本仍错误明显。指定中文与自动语言检测在这些样本上输出相同，不能据此宣称自动检测对所有视频可靠。

详见 [基线 Tiny 完成的子运行](./baseline-tiny-asr/report.json)、[基线 Base](./baseline-base-asr/report.json)、[fixed Tiny](./fixed-tiny-asr/report.json)、[fixed Base](./fixed-base-asr/report.json)。Tiny 数据来自原 Tiny/Base 混合进程在 Tiny 完成后、准备 Base 时关闭上下文的失败轮；该整轮不计成功，Base 后来独立完整通过。

浏览器总 RSS 峰值约 2.17–2.70 GB（Tiny 各轮）；基线 Base 约 2.43–2.58 GB，fixed Base 约 3.27–3.33 GB，包含整个隔离浏览器，不能当作模型权重大小或内存上限。fixed 使用测试用离线 Cache Storage 导入，基线普通话轮使用在线流式下载，准备阶段的缓冲和冷/热状态不同；这不是可直接归因于产品的内存对照。报告有每次 wall/inference/decode、RTF 和累计 CPU，未据此宣称整体推理加速或内存下降。

### 数字静音与时轴

fixed Tiny/Base 在调用 prepare 模型之前接收 6 秒全零 PCM。分别约 85/83ms 返回空 `text`、空 `segments`、`inferenceMs=0` 和 `audioDurationMs=6000`，没有 backend/dtype；该结果确认数字静音门控在模型初始化之前生效。它不证明背景音乐会被当作非人声过滤，也不证明低音量真人语音质量。

基线 Base 的同三条原音前后各补 2 秒全零 PCM，三条识别完整运行通过，但字幕均从 0ms 开始，覆盖了前置静音，见 [baseline-base-padded-asr/report.json](./baseline-base-padded-asr/report.json)。fixed padding 轮在浏览器启动时失败，未取得实际转写或 offset 断言结果，见 [fixed-base-padded-asr/report.json](./fixed-base-padded-asr/report.json)。本报告不能给出此场景的新旧速度结论或新版本真实 offset 验收。

## 自动化限制与清理

[failed-attempts.json](./failed-attempts.json) 保留被丢弃的非精确旧 main 产物轮和每次失败明细。后续 Chrome normal HLS、fixed padding，以及串行 Edge refactored metadata 轮都在 30 秒内未生成 `DevToolsActivePort`；产品断言没有开始，属于自动化启动限制。未改用前台启动、系统鼠标或日常 profile。

已取得 session 的成功轮使用 `owned-browser-close` 的精确 PID/启动时间/profile 契约关闭，仅有关闭收据时删除临时目录。启动失败没有 CDP ownership 收据的 profile 被保留，未向这些浏览器发送信号。benchmark 早期 finally 在取得 session 前启动失败时误删其临时目录，已经补 `launchAttempted` 门禁；这一失败的浏览器残留和清理限制也在 JSON 中准确记录。

仅保留小 JSON、必要截图和一份合成原音。夹具的 MP4/HLS 分片可由测试脚本再生，已移出报告目录；公开模型缓存与临时浏览器配置没有加入仓库。

## 复现入口与仍需验证的内容

运行前通过工作区依赖工具解析 Node/Playwright 路径，使用生产扩展目录和 focus-safe helper。常用入口：

```sh
<node> scripts/run-x-home-audio-recovery-test.cjs \
  --extension-dir <immutable-production-extension> \
  --playwright-root <bundled-node-packages> \
  --focus-safe-helper scripts/testing/focus-safe-browser.cjs \
  --metadata-variants-only --artifacts-dir <evidence-dir>
```

该入口可改为 `--hung-master` 或 `--metadata-variants-only --preview-failure`。真实模型入口是 `scripts/run-video-ai-recognition-benchmark.cjs`：`--model-cache-dir` 导入带 SHA 的登记公开模型；`--silence-probe --assert-silence-gate` 验证数字静音；`--audio-padding-ms 2000 --assert-padding-offset` 供 fixed 时轴验收，基线对照省略 offset 断言。启动失败必须停止，保留证据；不能静默切到用户前台。

还需要用户实际失败帖子的原始音频、自然人声/口音/音乐/多人样本、长片、不同硬件/后端及 Firefox/Android 验证。后续识别模型实验应与本轮生产修复分开记录，参考项目设计见 [open-source-review.md](./open-source-review.md)。

## 恢复后的集成复核

服务恢复后串行重跑三个媒体/交互场景，并在集成最新 main 的 `2ef55939f` 上重跑元数据读取。上述历史启动失败及不完整尝试仍保留，未改记为通过。

同一集成产物另完成自然英文 AAC/MP4 的真实 X 夹具采集、原生 PCM16、Base WebGPU q4 Worker 和完整字幕链路，12 项检查通过。全部 22 词保留、单样本 WER 为 0%，正常产品协议下的独立 Microsoft 请求也成功。此轮 UI 翻译响应受控，实际供应商请求单独记录；没有用户故障视频或广泛语料准确率结论。构建 SHA、阶段耗时、所有权关闭和截图边界见[合并前验证](./merge-validation.md)。
