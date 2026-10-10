# 原生产分窗与真实 Worker 对照

2026-10-09：基线和原候选 q4 各完成 39 条自然音频 × Tiny/Base × 自动语言，共 78 个完整片段、115 次窗口识别。两版全部使用真实 Apple/Metal-3 WebGPU q4，均完成 ready/progress=1、complete 取消和 owned browser close。[精简配对数据](./full-capture-paired.json)保存逐语种指标、115 对窗口 PCM SHA、来源与 helper/Worker SHA。

这是原生产 FullCaptureController → 原 PCM16 编码 → 扩展实际后台/Worker RPC → 原语音对齐、稳定器与最终 cue 的控制页验证。只在自己的临时 unpacked extension 添加 self-hosted helper，原产物没有修改。音频通过固定 SHA 的 getAudio 输入，native video 未播放且覆盖 duration。因此它没有验收 X 网络获取、captureStream、AudioContext、翻译或 content UI；44.16s 真 X-player/AAC 用例另有 [配对证据](./full-player-paired.json)。

两版 78 个完整输入 PCM、115 对窗口 start/duration/sequence/PCM SHA 全部一致。**78 个最终文字 SHA 和质量计分完全相同。** 此轮原候选没有带来普遍文字质量改善。窗口覆盖使用实际 Tiny 10s/Base 14s 生产分窗，补足 [直接 Worker 长窗矩阵](./direct-worker-matrix.md)的范围限制。

| 模型 | 语言/指标 | 基线与原候选 errors/reference units |
| --- | --- | ---: |
| Tiny | 印地语 WER | 107/93 |
| Tiny | 阿拉伯语 WER | 50/69 |
| Tiny | 泰语 CER | 279/355 |
| Base | 印地语 WER | 94/93 |
| Base | 阿拉伯语 WER | 33/69 |
| Base | 泰语 CER | 256/355 |

这些错误不全来自长片拼接：Tiny 单窗印地语为 24/24、阿拉伯语 12/15；Base 两个单窗印地语为 65/64、阿拉伯语 8/15；三条泰语在两模型中均是单窗。另一次 same-vocab [词法容量审计](./token-budget-audit.json)发现，部分短印地语/泰语参考本身需要的最少 token 也超过旧预算，因此不能仅凭高误差归因量化或模型能力。扩大预算的后续实验应保留独立产物、输入和结果身份。

原候选 115 个窗口中，106 个检测标签与整条单语 GT 一致。9 个不一致窗口置信度仅 0.295–0.627，7 个为 Tiny 的 1.22–2.72s 尾窗，另外两个为 Base 的日语 1.42s、德语 5.14s 尾窗。这些标签属于原始 detector 输出。9 个窗口的文字 SHA 和旧版均相同（6 个空窗、3 个非空窗），最终文字和分数也相同，没有观察到候选新增丢字；这不证明原有错误或漏词已经消除。基线未暴露检测字段，正确率应记未知。

计分按语种分别报告 CER/WER，中文另保留仅用于评价的 ICU Traditional-Simplified 视图。自然参考全文、字幕全文、PCM、模型和临时 profile 不进仓库；39 条来源与授权信息由 [直接矩阵数据](./direct-worker-paired.json)记录。每版只有本机一次串行运行，不把时间差写成普遍性能保证；模型准备与窗口执行分开记录。
