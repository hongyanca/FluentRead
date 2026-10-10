# WebGPU decoder 精度对照补充

日期：2026-10-09。**本轮三臂 GPU 对照未完成，不能判断 q8 在 GPU 上的准确率、兼容性或速度。**第一轮仅原样生产 Tiny q4 的一条普通话识别实际成功，随后报告后处理失败；修正后唯一一次授权重跑在本地缓存导入期间遇到页面关闭，推理没有开始。两轮都完成守护关闭并删除各自临时 profile，没有继续启动实例。生产默认未改变。

计划为 21 次转写：原样生产 q4 7 次、受控 q4 7 次、受控 q4 encoder / q8 decoder 7 次。每臂使用 Tiny 的三条固定合成普通话、Base 的同三条普通话，以及 Base 的一条低音量自然英文 PCM16。实际完成情况如下，模型准备调用另计。

| 运行 | 生产 q4 / 计划 7 次 | 受控 q4 / 计划 7 次 | 受控 q8 decoder / 计划 7 次 | 整轮结果 |
| --- | --- | --- | --- | --- |
| 第一轮 | 1 | 0 | 0 | 1/21，报告处理失败 |
| 修正后重跑 | 0 | 0 | 0 | 0/21，缓存导入未完成 |

来源、Worker、缓存、输入及完整原始报告的 SHA-256 见 [精简 JSON](./gpu-accuracy-experiment/summary.json)。自然音频、参考全文、权重和临时 harness 均未复制到仓库。

## 控制与实际后端

使用集成源码 `2ef55939f123d4ecdb6b9cdac081ce52a1b2cd06` 的生产产物，原样 Worker SHA 为 `ddcb25ca54475475a88c3cc0d27f90d0672a9de43e58af5d6c02d8ad50e33beb`。原样生产 q4 保留全部配置；两条临时受控 Worker 都关闭 `QDQSelectorActionTransformer`，使用相同 q4 encoder，仅切换 decoder q4/q8，并断言实际已加载 session 的 dtype。**仅后两臂可用于归因 decoder 精度；它们本轮均未完成推理。**

锁定库为 Transformers.js 3.8.1、ONNX Runtime Web 1.23.2。按文件名映射 dtype 的支持依据是 [3.8.1 getSession 源码](https://github.com/huggingface/transformers.js/blob/3.8.1/src/models.js#L193-L202)和 [q8 文件名映射](https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/dtypes.js#L49-L64)。全部 16 个公开缓存文件已校验长度和 SHA，固定 HF 快照与现有 q4 encoder/config 的一致性见 [此前快照核对](./accuracy-experiment/snapshot-verification.json)。没有下载新模型或上传音频。

每轮只启动一个新临时 Chrome profile，使用 `macos-background-cdp`、`launchservices-no-foreground`，窗口正常显示于第二屏，测试 Chrome 未成为前台。原生 adapter 身份和 Worker 实际 backend/dtype 都设有门禁，禁止软件 GPU 或 CPU 回退进入比较。第一轮实际 adapter 为 `apple / metal-3`、非 fallback，成功返回的 Worker 确认为 `webgpu / q4`；这只证明该生产 Tiny 请求，不能证明未运行的 q8 臂。

输入由提取的原生产 `decodePcm16Base64` 精确还原，随后使用未改的 Worker 音频预处理、语言选择、token 预算及停止条件。没有用近似的统一 `/32768` 解码替代生产正负样本不同的分母。

## 已取得的单条生产结果

第一条 3.47675 秒合成普通话，生产 Tiny q4、源语言 `zh-Hans`：原始 CER 与统一简繁后的 CER 均为 **3/15（20%）**。这是一次成功推理的内容结果，整轮报告仍然失败，没有得出新的普遍准确率收益。

首次新 Worker/model session 的准备耗时 1,799 ms，文件缓存已预存。显式准备后的首次推理为 2,955.4 ms、调用墙钟为 2,981 ms；按原音时长计算的推理 RTF 为 0.8500。没有后续 warm 样本，因此不能从这一观察比较 q4/q8 速度、资源峰值或跨设备表现。第一轮 16 文件缓存导入已完成，但其墙钟未单独测量；缓存导入与模型准备都没有计入上述推理时间。

`gain=0.003`、11 秒、352,000 bytes 的自然英文 PCM16 尚未进入 GPU 推理，**没有本轮 GPU WER**。该输入的 SHA 和精确解码后的 Float32 SHA 单列在 JSON 中。此前 [同输入的 Base q4 本地 WASM 对照](./full-pipeline.md#保留低音量人声和短尾)属于独立 CPU/WASM 证据，不能补成缺失的 GPU 样本结果。

## 三类失败的边界

恢复前唯一一次 [headless GPU 尝试](./accuracy-experiment/launch-report.json)在浏览器启动层超时，adapter 检查和推理均未开始。它与本轮两次正常可见后台 Chrome 运行分开保留。

本轮第一轮在模型成功返回后，报告代码调用不存在的 `/usr/bin/uconv`，出现 `ENOENT`；最后保存部分 compact 时又读取尚未赋值的归一化指标。原始脚本、报告及摘要均保留在独立目录。修正版使用经验证的 `/opt/homebrew/opt/icu4c/bin/uconv`（ICU 78.3），在启动浏览器前检查可执行程序及转换能力，并分别处理缺失的原始/归一化指标。Node 语法、输入复核和对已取得 raw 的离线回放均通过；离线回放没有新推理，原字幕和文字 SHA 保持不变。

修正后唯一一次重跑约 240.1 秒后，在本地 CacheStorage 文件导入阶段收到 `page.evaluate: Target page, context or browser has been closed`。缓存导入、原生 adapter 检查、模型准备和 21 次转写都未完成。保留证据不能确定关闭原因，不能将其归因于 q8、模型、操作系统或内存。该失败未推翻独立已通过的 [生产 Base q4 X 播放器完整链路](./post-recovery-browser-evidence.md)，也没有改变此前 [CPU/WASM 归一化指标](./accuracy-experiment.md)。

## 本机证据与后续

临时根目录为 `/private/tmp/fluentread-x-ai-gpu-ab-restored-20261009`：`first-attempt-icu-path-failure/` 保存首次脚本与失败证据，`results-corrected/` 保存有界重跑，`offline-replay/` 保存单条 raw 的指标回放。修正版 `run-gpu-worker-ab.cjs` SHA 为 `b7222c312243c2a75e34b3c18474ceb98bc21a0252a5053bc7d80ddd7900bbe6`；新输出目录不得覆盖已有报告。临时目录被清理后需重新准备，不依赖这些文件运行生产功能。

下一阶段仍应固定用户实际失败视频中的授权真人音频及人工转写，先完成相同原生 GPU 下的 decoder-only q8 对照，再在同一语料上评估 Small。现有单条 GPU 结果与独立 WASM 局部改善不足以改变默认模型或精度。
