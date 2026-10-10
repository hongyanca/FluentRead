# 自然语音直接 Worker 对照

2026-10-09：两版各完成 156 次真实识别 RPC，全部成功并通过 owned browser close。固定 39 条自然音频、13 语种、每语种最前面的 3 条 test 样本；Tiny/Base 分别测试指定语言与自动语言。**156 对文字 SHA 和计分完全相同，此矩阵没有证明普遍准确率提升。** [精简原始指标、来源及版本身份](./direct-worker-paired.json)保留全部来源/SHA、语言维度计分与配对分层。

浏览器为 Chrome 154.0.8037.99，真实 Worker 均使用 Apple/Metal-3 WebGPU q4；临时 profile、第二屏正常窗口、后台 Launch Services/CDP，前台检查通过。基线来源 `2ef55939f123d4ecdb6b9cdac081ce52a1b2cd06`，Worker `ddcb25ca…e33beb`。候选来自尚未提交的任务源码固定快照，Worker `3dbf6b74…fe5a42`；JSON 内保存该快照的 7 个生产源码 SHA 和产物 SHA，不将工作树当作提交身份。

| 模型/模式 | 输入分层 | 条数 | 基线/候选 RPC 中位数 ms | 总 RPC 耗时变化 |
| --- | --- | ---: | ---: | ---: |
| Tiny/指定 | ≤10s | 13 | 751 / 788 | +1.13% |
| Tiny/自动 | ≤10s | 13 | 900 / 887 | −3.36% |
| Tiny/自动 | >10s | 26 | 907.5 / 895.5 | −1.66% |
| Base/指定 | ≤14s | 30 | 937.5 / 860 | −3.82% |
| Base/自动 | ≤14s | 30 | 1100.5 / 1008 | −8.27% |
| Base/自动 | >14s | 9 | 1567 / 1491 | −7.07% |

这是本机每版一轮串行结果；系统负载、缓存和 shader 状态会影响 wall time。指定语言也有耗时变化，因此不能将全部差异归因 encoder 复用。旧版 `inferenceMs` 排除了语言检测，候选包含检测，跨版比较使用同 PCM SHA 的完整 RPC wall time。文件缓存准备与 ONNX session 准备单独记录。

候选 78 个独立自动语言用例均返回正确的主语言，并报告真实 `encoderReuse=true`、置信度与检测耗时。旧版未提供这些字段，检测正确率为未知。每个独立样本使用新的语言会话；这不能证明同一视频切换语种或单语锁定后的稳态性能，后续需实际分窗与同流序列验证。

26 条样本超过 Tiny 的 10s 生产窗、9 条超过 Base 的 14s 窗，最长 23.4s。这里直接调用支持 ≤30s 的 Worker，越界组属于解码预算压力测试，不能作为完整片段捕获验收。CER/WER 按语种分开汇总；中文保留 raw CER 和 ICU Traditional-Simplified 的评价视图，后者只影响计分。Tiny 在部分自然日/韩等语音上仍有明显错误，Base 也未消除所有问题。

模型种入通过 `127.0.0.1` token 路径，让扩展页直接 fetch 流式 Response 并写 `transformers-cache`，CDP 只传小元数据。339B 配置真实 extension-origin preflight 通过；基线 14 个已核 SHA 文件导入 553ms。候选额外预存两个实验 q8 decoder，但生产实际 dtype 仍为 q4。此速度是测试准备成本，不是字幕推理速度。[传输及不完整安装尝试摘要](./loopback-preflight.json)明确区分 Node 模拟 CacheStorage 与真实扩展缓存证明。

工具实现遵循 [Chrome 扩展跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[Cache.put 标准](https://w3c.github.io/ServiceWorker/#cache-put)和当前锁定 Transformers 3.8.1 的 BrowserCache key 契约；不增加生产 host permissions/CSP，也不手工写模型下载登记。真实 production prepare 后 Tiny/Base 均登记为 available。Chrome 154 旧 flags 安装尝试未取得 serviceworker，0 次识别，整体失败；显式 CDP 安装纠正后才形成上述基线结果。

语料来自 [FluidInference/fleurs-full 固定 revision](https://huggingface.co/datasets/FluidInference/fleurs-full/tree/1cca811bb8ea4d370345f108f00518167040282c)，上游为 [Google FLEURS](https://huggingface.co/datasets/google/fleurs)，清单记录 CC-BY-4.0、具体音频/参考文件 SHA。公开自然音频、参考全文、模型、完整临时 profile 和全文字幕不进入仓库。这里没有验收实时 X 获取音频、实际翻译供应商、生产全片分窗、其他设备或 Firefox。

工具定向验证：`tests/videoAiBenchmarkTools.test.ts` 两个用例通过，内含 12 项真实 loopback 小夹具检查。脚本保留旧三条合成语音默认入口，新增 `--corpus-manifest`、`--validate-only`、`--cache-preflight-only`；清单可通过 `streamGroup`/`languageSessionKey` 和 `repeat` 建立同流语言序列。自然语料每 case 失败记录 stage/error/elapsed、score=null，取消迟到任务并恢复下一个独立 case；`success` 表示驱动完成，`allCasesSucceeded`/`failureCounts` 独立表示产品请求结果。
