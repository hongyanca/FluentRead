# 实际 Small 模型隔离控制

两个 Small 臂各完成同一组 39 条自然语音、48 个原生产 14s 调度窗口，自动语言、实际 Apple/Metal-3 WebGPU，全部 ready/complete 取消与 owned browser close。39 个完整 PCM 和 48 个窗口边界、顺序及 PCM SHA 与 Base 预算 440 对照全部一致。[精简配对数据](./small-model-paired.json)保留实际模型来源、文件、缓存、构建和输入 SHA、分语种计分及耗时。

**实际模型是 onnx-community/whisper-small，Base 只是临时控制器、缓存键与 RPC 兼容别名。** 所有七个配置/tokenizer/权重都来自 Small 固定 revision 36050c46d777d46dc4b5f43f6d90574fc38f8732；每臂全新隔离扩展缓存，原 Base 文件和缓存没有改动。扩展页回读 config SHA，确认 d_model=768、12 层 encoder/decoder。没有向真实 Base/其他模型公网下载或隐式混入权重。这没有正式接入 Small 的模型登记、菜单、类型或默认选择。

Small q4 相对 Base q4/440：31 个片段误差更低、7 个相同、1 个更高（印地语 hi0001）。Small FP32 编码器/q4 解码器相对 Base：33 个更低、5 个相同、1 个更高（hi0002）；相对 Small q4 则为 11 更低、24 相同、4 更高。两 Small 臂的身份和精度分别保存，旧返回字段 model=base/dtype=q4 不能用来代表实际 Small 或 FP32 编码器。

| 语言 | 指标 | Base q4/440 | Small q4 | Small FP32/q4 |
| --- | --- | ---: | ---: | ---: |
| 中文 | CER | 29/81 | 12/81 | 13/81 |
| 英语 | WER | 8/73 | 8/73 | 7/73 |
| 日语 | CER | 66/162 | 30/162 | 28/162 |
| 韩语 | CER | 30/127 | 5/127 | 5/127 |
| 西语 | WER | 26/102 | 10/102 | 9/102 |
| 法语 | WER | 27/109 | 9/109 | 9/109 |
| 德语 | WER | 16/62 | 1/62 | 2/62 |
| 阿拉伯语 | WER | 33/69 | 31/69 | 24/69 |
| 印地语 | WER | 96/93 | 142/93 | 76/93 |
| 俄语 | WER | 9/45 | 7/45 | 7/45 |
| 越南语 | CER | 55/209 | 29/209 | 21/209 |
| 泰语 | CER | 161/355 | 102/355 | 96/355 |
| 葡语 | WER | 20/75 | 11/75 | 11/75 |

印地语仍是显著边界：Small FP32/q4 汇总 76/93 WER，约 81.7%。首例 hi0000 由 Small q4 的 24/24 降到 14/24，输出 50 个字母全部 Devanagari、检测 hi/0.945，但仍有大量词错误；首例 warm session 2545.7ms、inference 3048.5ms、总 wall 5656.2ms。hi0002 相对 Base 的 29/29 变成 33/29，保留为回归。不能把多数片段改善写成全部多语言准确或默认模型切换依据。

Small q4 缓存导入 302101039B/550ms，FP32/q4 为 588744805B/972ms。在这轮历史控制运行时，FP32 encoder 单文件 352825870B 超过通用 256MiB 限制，因此只在临时 helper 副本中对该文件的 exact key、Small source URL/revision、bytes、SHA 提供 384MiB 例外；其余文件与 PUT/export 仍保持 256MiB，10 个 exact 描述与变异拒绝检查通过，当时仓库通用 helper 没有扩大限制。后续[正式 Small 基准工具](./benchmark-tools.md)只允许真实 Small scope 的已登记 FP32 encoder 使用 384MiB；这项工具更新不改变上述历史别名臂的身份与结果。

Small q4 的片段 wall 合计 105158ms/中位 1860ms，FP32/q4 为 99013ms/1893ms；wall 包含首次初始化，窗口与准备时间另记。最大观测窗口 inference 分别约 8624ms、5266ms，均低于 15 秒，但两个产物仍使用上游旧未 hook 停止契约，不能称硬时限已验收。一次串行设备对照不提供普遍性能保证。未采样 Chrome/GPU 进程峰值内存，文件大小不是内存用量或低内存设备验收。

自然全文、参考、音频、PCM、模型和 profile 不进仓库；原始文字仅在本任务 /private/tmp 供错误诊断。这里只验证固定 getAudio PCM → 原 FullCapture → 实际 Worker → 对齐/稳定器/cue，X 获取、AudioContext、翻译、content UI 和正式 Small 产品配置仍需独立验收。
