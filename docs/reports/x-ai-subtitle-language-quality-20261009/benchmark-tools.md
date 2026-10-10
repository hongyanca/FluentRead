# 自然语料基准工具与正式 Small 缓存

基准驱动保留默认 `--models tiny,base` 和原三条合成中文样本。`--models small` 显式启用正式 Small；`--corpus-manifest` 读取本地已授权语料，逐条验证来源、语言、时长、音频 SHA，并分别执行 `explicit` 和 `auto`。`streamGroup`/`languageSessionKey` 与 `repeat` 可描述同一流里的连续窗口。自然参考、识别全文和音频不写入交付报告。

`scripts/testing/model-cache-transfer.cjs` 将逐文件验证后的模型，通过随机 token、精确路径和扩展 Origin 限制的 `127.0.0.1` HTTP 服务直接交给扩展页 `fetch` → `transformers-cache.put`。模型权重不编码成 base64 传入 CDP；CDP 只携带 URL、字节数、SHA 等小描述。下载登记仍由真实生产 prepare 写入；导入 CacheStorage 不伪造“已下载”状态。

正式 Small scope 必须是 `onnx-community/whisper-small`，来源必须与该模型和文件对应，固定 Hugging Face revision 可以映射到生产 ModelScope `resolve/master` 缓存键。清单路径与 URL 必须一致，逐文件校验 bytes/SHA 和文件身份，Small config 还须满足 Whisper d_model=768、encoder/decoder 各 12 层。带有 Base scope/别名/来源的 Small 文件被拒绝。导出清单记录实际 canonical 模型来源；导出的 master 表示运行时缓存键，不伪称已知固定上游 revision。

只有已知 Small `onnx/encoder_model.onnx` 的单文件限额为 384MiB，其余已登记文件仍为 256MiB。导入 GET、导出 PUT 均只处理已登记文件；PUT 根据声明长度及实际流量限额落盘，失败/取消清理临时 `.part`。扩展端导出还在读取 cached body 时计数、检查长度并计时，缺少 Content-Length 的流也受限；超限头和 pending read 取消后不会发送上传。传输关闭只销毁本任务 HTTP 连接，不操作浏览器或用户进程。

真实 Small 转写和模型 session prepare 必须回传 `model=small`、`encoderDtype=fp32`、`decoderDtype=q4`。`dtype=q4` 单独保存为旧解码器简称，缺失的分模块精度保持 null；不会由旧字段推造 FP32。失败 case 的 stage/error/耗时保留，score=null，并取消其流后继续独立 case；`success` 表示驱动完成，`allCasesSucceeded` 与失败数独立报告。

本轮准备的 canonical 缓存包含 7 文件、588744805B；源 revision 为 `36050c46d777d46dc4b5f43f6d90574fc38f8732`，manifest SHA 为 `baa8563ad1ef4ff999f613c16684afe2e709a9622b37baf5eb111e75e12ea471`。352825870B 的 FP32 encoder SHA 为 `b37cd6625dc36f9178ec7539a1876b9680ea26a910097e092be39dc766320c7b`。文件留在任务临时目录，模型不进入仓库；[精简工具验证数据](./benchmark-tools.json)记录脚本 SHA、测试和准备范围。

无浏览器准备检查可复现为：

```sh
node scripts/run-video-ai-recognition-benchmark.cjs \
  --validate-only --models small --languages auto \
  --corpus-manifest /private/tmp/fluentread-fleurs-natural-corpus-20261009/corpus.json \
  --model-cache-dir /private/tmp/fluentread-whisper-small-fp32-q4-canonical-cache-20261009 \
  --artifacts-dir /private/tmp/fluentread-benchmark-small-tools-final-20261009/validate-small
```

该检查已成功验证 39 条输入和 7 个模型文件，规划 39 个 Small auto case；`browserLaunched=false`、`allCasesSucceeded=null`。7 个 Vitest 工具用例通过，其中自产小 JSON/8MiB 模型夹具的 17 项检查覆盖真实 loopback 传输、SHA、Origin/token、Tiny 与 Small roundtrip、无 Content-Length 导出，以及声明 352825870B、仅发送 64KiB 后取消的 Small PUT 清理。后者没有实际传输整个 353MB 文件。另有 oversized header/pending cached read 的取消测试。工具测试不执行 ONNX，不是 Small 实机精度或完整视频验收。

后续真实浏览器运行仍需要显式 `--playwright-root`、`--focus-safe-helper`、`--extension-dir`、`--browser-path`，使用独立临时 profile、正常第二屏窗口和 owned close。直接 Worker 最多 30 秒的矩阵与生产 10/14 秒分窗分层报告；真实 X 音频、完整 FullCapture、UI 与在线翻译分别验收。此前 Small Base 别名控制保留在[历史模型对照](./small-model-controls.md)，不计作正式 Small 产品通过。
