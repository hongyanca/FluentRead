# X AI 字幕：decoder q8 准确率路线实验

日期：2026-10-09。新增本地 Node-hosted WASM 完整对照 28 次均成功：固定 q4 encoder、仅切换 q4/q8 decoder，三条合成普通话共 12 次、官方参考自然英文共 4 次、两个公开 X 视频无人工真值观察共 12 次。在有参考的语料上得到局部内容改善。**这些是 CPU/WASM 精度路线证据，不能当作 WebGPU 或浏览器交互验收，也不足以决定整体最佳模型。生产默认未改变。**

此前唯一一次 headless WebGPU 尝试在浏览器启动层超时，原生 GPU 检查和推理均未开始；其“没有准确率结果”结论仍然有效，见本文独立记录。

## 已完成的生产对照

[生产 Worker 普通话对照](./browser-evidence.md#普通话原音)使用同 SHA 的三条 macOS 合成普通话，Tiny/Base 分别测 `zh-Hans` 与 `auto`。旧、新 Worker 的输出逐字相同；修复可靠性和交互不能据此宣称提升了字词准确率。原始 CER 包含简繁差异，不能当作纯内容错字率。

原始记录：[基线 Tiny 已完成子运行](./baseline-tiny-asr/report.json)、[基线 Base](./baseline-base-asr/report.json)、[fixed Tiny](./fixed-tiny-asr/report.json)、[fixed Base](./fixed-base-asr/report.json)。Tiny 基线的整轮因后续准备 Base 时关闭上下文而失败，只有已完成的 Tiny 子运行用于文本对照。样本与 PCM 摘要见 [samples/manifest.json](./samples/manifest.json)。

## A/B 控制与版本

| 实验臂 | encoder_model | decoder_model_merged | Worker 诊断 dtype |
| --- | --- | --- | --- |
| A | q4 | q4 | `encoder:q4,decoder:q4` |
| B | q4 | q8 | `encoder:q4,decoder:q8` |

锁定运行库为 `@huggingface/transformers 3.8.1` 和 `onnxruntime-web 1.23.2`。Transformers.js 的 [3.8.1 getSession 源码](https://github.com/huggingface/transformers.js/blob/3.8.1/src/models.js#L193-L202)按 session 文件名读取 `dtype` 对象；[同版本 dtype 映射](https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/dtypes.js#L49-L64)将 q8 对应到 `_quantized.onnx`。这是参数支持的源码证据，不是本实验组合已成功运行的证据。

两臂都设置 `session_options.extra.optimization.disable_specified_optimizers = 'QDQSelectorActionTransformer'`，避免把优化器差异混入 decoder 精度对照。普通话两臂使用同一份现有 encoder/config 缓存、预处理、固定 PCM、`zh-Hans`、token 预算、停止条件及运行库；本地 WASM A 的六份普通话输出已核对，与生产 WebGPU q4 文本相同。没有把 Python Whisper 的参数直接套到浏览器实现。

**来源控制已核对：**固定 HF commit 的 Tiny/Base q4 encoder/decoder、五项 config/tokenizer 和 q8 decoder，共 16 份文件，与现有缓存的 SHA-256 和字节数全部一致。大权重核对固定 commit API 的 LFS SHA-256；小配置实际下载后计算 SHA-256，不把 Git blob SHA 当作 SHA-256。见 [快照核对报告](./accuracy-experiment/snapshot-verification.json)。推理本身只读取已有本地缓存，不下载或上传音频。

计划必须核对两臂实际使用相同原生 WebGPU adapter/vendor，禁止软件 GPU 或 CPU 恢复结果进入 GPU 对比。纯 Worker 直接返回混合 dtype 诊断，不把 B 标为“全 q8”。实验不通过 offscreen 的自动 CPU 回退；模型、配置和样本由带 SHA 的本地缓存提供，浏览器中的公网请求被阻断。

## 已完成的本地 CPU/WASM A/B

默认 Node 入口绑定 `onnxruntime-node 1.21.0`，与生产锁定的 Web ORT 版本不同，本轮没有用它推理。临时 harness 通过 [3.8.1 后端的 runtime host 钩子](https://github.com/huggingface/transformers.js/blob/3.8.1/src/backends/onnx.js#L57-L63)注入本机 `onnxruntime-web 1.23.2`，显式指定 `executionProviders=['wasm']`、单线程；Transformers 的实际 env 同时确认 Web/common 版本均为 1.23.2。两臂同一 backend、优化器、encoder/config、生产预处理和 token 预算，保持现有 15 秒解码限制；实际 session dtype 写入报告。

先用首条 Tiny 完成实际 A/B，再完整执行 Tiny/Base × 三条普通话 × 两种 decoder，共 12 次，全部成功。q4 臂的六份输出与此前生产 WebGPU q4 文本逐字相同。完整精简数据见 [node-wasm-report.json](./accuracy-experiment/node-wasm-report.json)。这不验证 WebGPU q8 兼容性、浏览器媒体采集或扩展 UI。

| 模型 / 样本 | 原始 CER：q4 → q8 | 统一简繁后的内容错误数：q4 → q8 |
| --- | --- | --- |
| Tiny / 15 字短句 | 20.00% → 33.33% | 3 → 3 |
| Tiny / 26 字句 | 46.15% → 34.62% | 2 → 1 |
| Tiny / 52 字连续对白 | 36.54% → 36.54% | 7 → 7 |
| Base / 15 字短句 | 33.33% → 20.00% | 5 → 3 |
| Base / 26 字句 | 3.85% → 42.31% | 1 → 0 |
| Base / 52 字连续对白 | 28.85% → 28.85% | 1 → 1 |

原始 CER 保留简繁差异。另用 `uconv v2.1 / ICU 78.3` 的 `Traditional-Simplified` 对参考和预测统一字形，再排除标点及空白计算 CER；这是**指标处理**，没有转换生产字幕或改变识别输出。统一字形后，Tiny 三句合计 12/93 → 11/93（12.90% → 11.83%），Base 合计 7/93 → 4/93（7.53% → 4.30%）。例如 Base 在第二句将错误“实别”变为正确的繁体“識別”，原始 CER 因其余字形变化反而升高；Tiny 的同一个词仍然识错，第三句仍严重失真。三个合成样本不能证明真人视频的普遍收益。

报告保留每次推理时间，但只有一轮按顺序执行的 A/B，没有重复、随机化或完整 CPU 资源验收；不能据此承诺浏览器速度、峰值内存或硬件间收益。

## 自然语音补充

### 有官方参考的 JFK 英文片段

固定公开数据集 revision `542437c29cc5273cfd29e25c77696f2b349badd7`，本地 PCM 为 11 秒、16 kHz mono、176,000 samples，SHA-256 为 `f00f8677a6e16874c36dd7946d8f4c74a762eb4aafc106d41088f1005a8ffe38`。参考来自 [Transformers.js 3.8.1 官方 ASR 文档](https://huggingface.co/docs/transformers.js/v3.8.1/en/api/pipelines#transformers.AutomaticSpeechRecognitionPipeline)，下列 22 词只引用一次；媒体和模型生成的完整转写不进入仓库。

> And so my fellow Americans ask not what your country can do for you ask what you can do for your country

| 模型 | q4 decoder WER | q8 decoder WER |
| --- | --- | --- |
| Tiny | 1/22（4.55%） | 0/22 |
| Base | 0/22 | 0/22 |

四次均实际检测到最高语言 token 为英文（置信度约 0.9198–0.9698），使用相同生产预处理、英文 token 预算和 WASM backend。WER 在参考与预测中统一小写、移除 Unicode 标点/符号并按空白分词；它只描述这个 22 词参考片段，不能泛化为自然英文整体准确率。来源、PCM、文字 hash、预算和每次 WER 见 [jfk-wasm-summary.json](./accuracy-experiment/jfk-wasm-summary.json)。

### 无人工真值的两个公开 X 视频

样本独立取自公开 yt-dlp 测试与可公开访问的媒体，不来自账号 HAR。声稿视频比较同范围 0–12 秒的 32/128 kbps 音轨；动画视频使用实际 4.458 秒片段。Tiny/Base、q4/q8 共 12 次均返回非空且未触发重复退化，完整原文只留 `/private/tmp`。仓库中的 [public-x-wasm-summary.json](./accuracy-experiment/public-x-wasm-summary.json)只保存来源、PCM/文字摘要、字数、语言检测及参数，未引用公开视频正文。

声稿的最高语言 token 为英文，置信度约 0.9081–0.9911；Base 在两种码率、两种 decoder 下四份输出逐字相同。Tiny 的文字存在差异，没有人工转写，不能判断哪份更正确。32 kbps 原音为 mono，128 kbps 为 stereo，混音后 RMS 还存在约 29% 差异，码率不是唯一变量，不能据此宣称高码率带来准确率收益。

动画的最高语言 token 也为英文，但置信度仅约 0.6322–0.7342，低于生产跨窗固定语言的 0.8 门槛。取得的原生 `en-US` 字幕明确为自动生成，四份模型输出均未与其在忽略大小写、标点和空白后完全一致；自动字幕不是人工真值。这些观察不计算 WER/CER，也不冒充人工听辨语言或准确率验收。

## 公开权重与摘要

仅新增两个 decoder 文件，合计 **84,412,556 bytes**。固定 Hugging Face commit 下载；导入时沿用生产登记的 Modelscope Cache Storage key。源 URL、缓存 key、完整 SHA 和 A/B Worker 摘要见 [小型实验清单](./accuracy-experiment/manifest.json)。权重二进制未加入仓库。

| 模型 | 固定 HF commit | `decoder_model_merged_quantized.onnx` bytes | SHA-256 |
| --- | --- | --- | --- |
| Tiny | `ff4177021cc41f7db950912b73ea4fdf7d01d8e7` | 30,719,241 | `25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3` |
| Base | `1846881b6b3a3024392c1eea3ad983695bc23925` | 53,693,315 | `fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b` |

公开文件来源：[Tiny 固定版本](https://huggingface.co/onnx-community/whisper-tiny/blob/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/onnx/decoder_model_merged_quantized.onnx)、[Base 固定版本](https://huggingface.co/onnx-community/whisper-base/blob/1846881b6b3a3024392c1eea3ad983695bc23925/onnx/decoder_model_merged_quantized.onnx)。原 q4 文件继续使用生产对照的相同摘要。

## 恢复前未完成的 WebGPU 运行与限制

显式启动方式为 `launchMode=headless-worker-benchmark`，使用新建临时 profile、localhost 静态资源和纯 Dedicated Worker。这不是扩展 UI 或 Service Worker 验收，不接用户日常浏览器，也不激活前台。

命令明确以 `require_escalated` 执行。Chrome `launchPersistentContext` 在 30,000 ms 超时，没有返回 context；原生 GPU 检查和 A/B 两臂均未开始。保留的 [精简启动报告](./accuracy-experiment/launch-report.json)记录 `checks=[]`、`arms=[]`，没有完整环境、启动参数或 stack。

日志给出的本次 PID 随后精确只读查询已不存在；没有 CDP ownership 或 guarded-close 收据，临时 profile 按约定保留，未猜测 PID 发送信号。未追加浏览器实例。不能由这一启动失败判断 q8 精度或兼容性，也尚未确定启动失败原因。

## 本机复跑指针

两类临时 harness、staged Worker 和权重只在本机 `/private/tmp` 保存，不进入生产运行时或仓库。Node/WASM 的结果已经完成上面的精度路线验证；WebGPU 的准备产物仍不能作为已完成验收。临时目录被清理后需要重新准备。

| 内容 | 本机位置 |
| --- | --- |
| 纯 Worker headless harness | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/run-headless-worker-ab.cjs` |
| 已运行的 Node/WASM harness 与纯参数 helper | `/private/tmp/fluentread-x-ai-node-wasm-q8-20261009` |
| A staged extension assets | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/encoder-q4-decoder-q4/chrome-mv3` |
| B staged extension assets | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/encoder-q4-decoder-q8/chrome-mv3` |
| 公开 q4/q8 模型缓存 | `/private/tmp/fluentread-x-ai-decoder-q8-model-cache-20261009` |
| 完整产物与文件摘要 | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/artifact-manifest.json` |
| 原始启动失败报告 | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/headless-worker-ab/report.json` |

WebGPU headless harness 已做 Node 语法检查，但没有完成浏览器推理验证。当前准备版移除了 Playwright 默认的 `--enable-unsafe-swiftshader`；它与唯一已尝试版的 SHA 不同，且尚未复跑。两份摘要在小型清单与启动报告中分别记录，不能把准备版当成已执行版。各已执行 Node/WASM 报告单独记录其 harness SHA，避免将后续临时修改冒充原运行版本。

在启动限制恢复后，通过工作区依赖工具解析 Node/Playwright 路径，先核对清单中的权重、样本和 Worker SHA，再用对应 Node 执行该临时 harness。它仍须通过相同原生 adapter、实际 backend/dtype 和 CPU 回退门禁，才可比较结果；启动失败立即保留证据并停止。

CPU/WASM 合成语料可复跑：用本机对应 Node 执行 `run-node-wasm-ab.cjs --models tiny,base --samples 0,1,2 --report <new-report-name.json>`，先保留已有来源/权重摘要和脚本归一化的原始报告，不覆盖它们。公开自然音频的临时 manifest 与完整原文报告均留在同一目录；精简 JSON 记录原报告摘要供核对。

下一阶段最值得做的是固定用户实际失败视频中的授权真人音频和人工转写，覆盖口音、背景音乐及句尾，验证 decoder-only q8 在浏览器真实后端的效果与资源，再在同一语料上试 [Small q4](https://huggingface.co/onnx-community/whisper-small/tree/main/onnx)。本轮 CPU/WASM 的局部改善足以支持继续验证这条路线，尚不足以盲目更改默认；继续保持本地推理且不增加服务依赖。

## 恢复后的独立 GPU 复核

共享服务恢复后，最终集成扩展的 Base WebGPU q4 已通过一条自然英文的真实播放器完整链路，见[浏览器验收](./post-recovery-browser-evidence.md)。这与 q4/q8 控制实验分别记录。

三臂 21 次调用的 GPU 对照第一次只完成一条原样 Tiny q4，随后字符归一化工具路径错误中止；两组控制实验尚未开始。修正驱动、通过离线回放与独立审查后，唯一有界重跑在 CacheStorage 导入时报告页面/context/browser 关闭，0 次模型准备、0 次识别；不能据此判定 q8 不兼容或归因内存。两轮均通过所有权关闭并清理新 profile，未追加实例，默认模型及精度未变。精简指标、阶段、SHA 和失败边界见[GPU 复核记录](./gpu-accuracy-experiment.md)。本节没有新增 q4/q8 GPU 准确率或速度结论。
