# 恢复后的 X 字幕浏览器验证

2026-10-09，在用户授权恢复 pasteboard 服务后，串行使用任务临时 profile 和仓库 focus-safe/owned-close helper 完成生产产物验收。完整指标、版本文件 SHA、检查及失败分类见 [精简报告](post-recovery-browser/report.json)。原始报告与可再生媒体保留在 `/private/tmp/fluentread-x-ai-followup-browser-20261009/`，未纳入仓库。

| 用例 | 产物源 commit | 结果 | 观察 |
| --- | --- | --- | --- |
| GraphQL 仅 MP4 variants / blob 播放器 | `56aab82ae` | 11/11 | 584 ms，匹配当前媒体的最低码率 MP4 |
| 首 HLS master 挂起 | `56aab82ae` | 12/12 | 5604 ms，5 秒预算后恢复到匹配 MP4 |
| 首窗预览后下一窗失败 | `56aab82ae` | 8/8 | 650 ms 出预览；后续失败清字幕、可重试、不缓存、不导出 |
| 合并最新 main 后 GraphQL 关键回归 | `2ef55939f` | 11/11 | 576 ms；[双语界面](post-recovery-browser/metadata-only-bilingual.png) |
| 真实播放器→音频→生产 Base Worker→字幕 | `2ef55939f` | 12/12 | 11 秒自然语音，2 条完整字幕；[唯一自然字幕截图](post-recovery-browser/real-worker-full-pipeline.png) |

前四项使用真实 MSE/AAC、媒体路由和原生解码，ASR/翻译响应受控。预览的 [提前显示](post-recovery-browser/early-preview.png) 与 [后续失败](post-recovery-browser/after-preview-failure.png) 证据独立保留。

真实全链路使用已有公开 JFK 音频、匹配媒体身份的本地 AAC/MP4 和经过 SHA 校验的 Base 七文件 q4 缓存，未模拟 prepare/transcribe。UI 显式选择 Base、源语言 English，并正常确认“下载并生成”。生产 PCM16 输入为 16 kHz 单声道、352000 字节 / 11 秒；实际后端 `webgpu`、`q4`、`apple / metal-3`，推理 786.7 ms，消息内 PCM 解码 3.6 ms。完整字幕区间 280–10600 ms，22 个参考词、22 个输出词，WER 0%。这是单条自然英文样本的指标，不代表多语言、噪声或用户故障帖的普遍准确率。

确认到“已就绪”的观测耗时 2514 ms，确认到字幕截图 3262 ms；后者包含脚本固定的 600 ms 观察等待。本地 popup/CacheStorage 导入耗时 174549 ms，是 harness 准备开销，未计入识别时延，也不是模型公网下载时间。第一次确认与生成期间观察到两次真实 prepare 请求及一次 transcribe，模型公网请求为零。

CacheStorage 文件与模型下载登记是两个契约：`background/handlers.ts` 在真实 prepare 成功后写 `fluentReadVideoLocalTranscriptionModels`，UI 读取该登记决定是否确认。此轮只导入缓存文件，没有写登记；随后实际首用确认→prepare→生成成功。关闭前未单独抓取 prepare response、登记值或第二次菜单状态，因此不声称取得了这些额外读数。

完整字幕截图采用受控译文。随后在同一实例恢复原生 fetch，重放观察到的普通产品翻译协议，实际 Microsoft 英文→简体中文单请求 449 ms 成功，响应含中文且无模拟前缀。这是实际供应商协议结果；未拍摄实际供应商译文的播放器 UI。

所有成功轮均为 `macos-background-cdp`、`launchservices-no-foreground`、第二屏正常 1280×900 可见窗口，测试浏览器未处于前台。用户可自行切换前台应用；真实全链路记录的前台应用从 ChatGPT 变为 Firefox，测试 Chrome 仍非前台。实例按 CDP/精确进程与 profile 所有权 guard 关闭，无清理错误，临时 profile 已删除，浏览器槽已释放。

三项不完整尝试保持整体 false：一次旧 skill helper 与仓库关闭契约不兼容；一次 30 秒内未出现端口、随后同 profile 的端口迟到恢复；一次驱动遗漏真实模型确认、180 秒后仍停在确认框。后两次尚未开始实际 ASR，均不能用于判定产品或模型失败；修正正常 UI 路径后完成上述真实验收。

产物来源：`56aab82ae82a47ab009f05500bb140fbf7caea22` 为最初固定版生产源码；集成版为 `2ef55939f123d4ecdb6b9cdac081ce52a1b2cd06`，不可变 build 的 `provenance.json` 与逐文件新计算 SHA 一致。Worker 两版均为 `ddcb25ca54475475a88c3cc0d27f90d0672a9de43e58af5d6c02d8ad50e33beb`，content bundle 差异与合入 main 的图片功能代码对应。
