# 错误文字与解码器 Q8 诊断

从已发现质量问题的公开语音中固定选择 hi0000/hi0001、th0000、ar0000、ja0000，Tiny/Base 共 10 个诊断片段。q4 重跑与原 78 个片段中的对应 10 个文字 SHA、分数完全一致。q4 与 FP32/q8 各完成真实 WebGPU 10 个片段、12 个生产窗口并安全关闭；q8 与已有 FP32/q4 子集的输入和窗口 SHA 相同。它们是针对失败样本的诊断，不是无偏准确率统计。[精简数据](./decoder-text-diagnostic.json)没有自然原文或识别全文，原始文字只保存在本任务 /private/tmp 中。

印地语的约 100% WER 不能全用字形差异解释。q4 Base hi0000 的参考有 54 个 Devanagari 字母，输出含 85 个 Arabic、2 个 Cyrillic 字母，检测仍是 hi/0.875；hi0001 的输出 41 个字母全是 Latin，检测 hi/0.941。Tiny hi0000 同样只输出 Latin；hi0001 则异常混合脚本并重复到 202 个计分词。

Unicode NFC 与 ICU Any-NFC 对全部诊断文字给出完全相同结果。四个 q4 印地语用例及四个 q8 印地语用例的 WER 均没有改善；q4 Tiny hi0001 的 CER 只从 312/159 变为 311/159，WER 仍是 202/40。

另执行固定 release 的 [OpenAI Whisper BasicTextNormalizer](https://github.com/openai/whisper/blob/v20250625/whisper/normalizers/basic.py)默认规则，源码 SHA 为 4742eaa040e0657fa1247a1361e0d856c62317a43326ea59a40c2e9edd8d2c38。默认 remove_diacritics=False、split_letters=False；未执行 grapheme regex 路径。该规则会改变 Indic marks 与词分母：hi0000 的参考计分词由 24 变为 40，hi0001 由 40 变为 72。Base 仍是 40/40、72/72 的错误；Tiny 异常片段变为 196/72，错误仍很高。此分数只作补充诊断，不能把分母变化称为文字修复。CER 按 Unicode 码点而非字素簇计分。

同为 FP32 编码器、预算 440，Q8 解码器相对已有 q4 子集：4 个片段误差改善、3 个相同、3 个变差，0 个文字 SHA 相同。Tiny 日语从 13/45 CER 变为 44/45；印地语 hi0000 从 24/24 变为 27/24 WER，hi0001 从 40/40 变为 47/40。Thai 单例从 137/127 变为 63/127 CER。Base 印地语仍为 27/24、40/40，不能说 Q8 解决了印地语识别。

这些都是临时 dtype 控制产物，旧 RPC dtype=q4 不能代表其编码器/解码器精度。模型缓存公开文件、构建 SHA、GPU 结果分别保留；没有改变产品默认精度，也没有将 CPU fallback 记为 GPU 成功。所有控制同样早于停止适配器，不能验收最终 15 秒早停。这一控制页矩阵仍不包含 X 网络、AudioContext、翻译或 content UI。
