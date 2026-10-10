# 正式 Small 完整分窗矩阵

最终不可变 Chrome 产物用真实 `model=small` 完成 39 条固定自然语料、48 个生产 FullCapture 窗口，全部成功；每次暖模型和转写响应均实际报告 FP32 encoder、q4 decoder、Apple/Metal-3 WebGPU。没有 Base 别名、人工源语言指定或修改生成参数。[逐例精简数据](./final-small-model-matrix.json)保存模型/源码/缓存/PCM SHA、分模块精度、计分和配对结果。

与此前[Small FP32/q4 隔离别名臂](./small-model-controls.md)相比，39 个完整 PCM、48 个窗口起止/顺序/PCM SHA、39 个最终文本 SHA/score/cue timeline SHA、48 个窗口文本/segment SHA **全部相同**。正式模型身份接入、新停止 hook 和有界 producer 没有在这组语料中引入识别或时间轴回归；这个结论不代表任意视频质量保证。

| 语言 | 指标 | 最终 Small 误差 / 参考单位 |
| --- | --- | ---: |
| 中文 | CER | 13/81 |
| 英语 | WER | 7/73 |
| 日语 | CER | 28/162 |
| 韩语 | CER | 5/127 |
| 西语 | WER | 9/102 |
| 法语 | WER | 9/109 |
| 德语 | WER | 2/62 |
| 阿拉伯语 | WER | 24/69 |
| 印地语 | WER | 76/93 |
| 俄语 | WER | 7/45 |
| 越南语 | CER | 21/209 |
| 泰语 | CER | 96/355 |
| 葡语 | WER | 11/75 |

印地语仍有明显质量边界：整体 WER 约 81.7%，hi0002 为 33/29（替换/插入/删除的合计可以超过参考词数）。46/48 窗口检测标签与语料清单一致；ja0001 的 1.42 秒尾窗误检测 ko/0.357，hi0002 首个 14 秒窗口误检测 ur/0.544，均保留实际文字和计分，未用固定语言纠正。48 个窗口都实际报告 encoderReuse=true；语言概率只表示检测 token 的置信度，不是识别准确率。

模型缓存为真实 Small canonical scope 的 7 文件、588744805B，固定公开源 revision `36050c46d777d46dc4b5f43f6d90574fc38f8732`，manifest SHA `baa8563ad1ef4ff999f613c16684afe2e709a9622b37baf5eb111e75e12ea471`。经 SHA/bytes 预验后以 loopback HTTP 导入扩展 CacheStorage，本次 seed 用时 1314ms；真实 config 回读确认 d_model=768、encoder/decoder 各 12 层。驱动记录 0 远程请求、0 RPC 失败，39 次生产 complete release 全部成功。这是已有本地模型的推理验证，不是公网下载速度测试。

生产 Worker SHA 为 `d2d83693eeb4cb8e3cefca672f10f4e1233bfcc9d6b2cba32bafdce358fc4f3c`。实际 FullCapture 原源码 SHA `b38922ac6b974ef87041a34dd70c6ebe720d77e8e5e42e1295fdb17df496c77c` 与该产物 provenance 一致；测试 helper 只注入固定 getAudio，并提取原生产 PCM16 decoder，未修改分窗、对齐、稳定器或生成选项。39 个 case wall 合计 102560ms，中位 1869.7ms，首个 session prepare 2639.7ms，最大观测窗口 inference 5770.1ms。单次本机结果不支持普遍速度提升；未测量 Chrome/GPU 峰值内存，也没有在本矩阵触发硬超时。

Chrome `154.0.8037.99` 使用新临时 profile，`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`。正常 1280×900 窗口完整放在第二屏，`browserFrontmost=false`，41 次前台校验通过；最终 DOM 状态标签证明 39 个样本/48 个窗口完成。诊断截图已视检，但仅展示控制页结果标签，不把它当成产品字幕 UI 证据。guarded close 成功，任务临时 profile 已删除，浏览器槽已释放。

本矩阵覆盖固定 PCM → 当前生产 FullCapture → 真实 Small Worker → 对齐/稳定器/cue。原始音频与自然全文只在任务临时目录；仓库仅保留 SHA、计分与必要 metadata。真实 X 音频获取、AudioContext、产品 UI、翻译供应商、CPU 与低内存设备分别验收；实际播放器证据见[总验证报告](./verification.md)。原始精简报告、ledger 与诊断截图保留在 `/private/tmp/fluentread-fleurs-fullcapture-final-small-real-browser-20261009`。
