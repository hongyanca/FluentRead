# 合并前的隔离浏览器验证

日期：2026-10-09。用户已授权恢复共享剪贴板服务，并要求验证后合并 PR #900。合并前将最新 `origin/main` 的漫画优化（`bd3d18072`）无冲突合入任务分支；集成源码为 `2ef55939f123d4ecdb6b9cdac081ce52a1b2cd06`，视频源码、锁文件及 WXT 配置与已验证版本一致。

## 环境恢复及证据边界

精确 target `gui/501/com.apple.pboard` 的 `launchctl kickstart -kp` 被系统完整性保护拒绝，未重启服务。随后在授权范围内，向刚由该 target 确认的 pboard PID 28109 发送 TERM，系统按需重新启动为 PID 11515、runs 3。未读取剪贴板内容，没有向其他用户进程发送信号。[恢复记录](./merge-validation/pasteboard-recovery.json)与[原启动诊断](./browser-startup-diagnosis.md)分别保留恢复及历史故障事实。

恢复后使用任务专用新临时 Chrome 配置、Launch Services 后台启动、CDP 输入和所有权关闭守卫。窗口保持正常尺寸、完整位于第二个显示器；各运行的 `launchMode = macos-background-cdp`、`focusPolicy = launchservices-no-foreground`、`windowPlacement.mode = background-visible-no-focus`、`browserFrontmost = false`，测试浏览器未成为前台应用。用户可自行切换前台应用；真实链路中从 ChatGPT 变为 Firefox，测试 Chrome 仍在后台。未使用日常浏览器配置。

首次运行误选旧 Skill helper，产品 DOM 断言通过但关闭守卫拒绝不兼容的 transport-only 关闭能力。该运行整体记失败；随后使用仓库配套 helper 完整重跑。[自动化失败摘要](./merge-validation/superseded-automation-attempt.json)保留原因，不将它计为产品通过。

真实模型验收的一次启动观察超时后取得迟到的端口，使用精确所有权核对重新连接同一实例，没有再次启动。随后驱动遗漏首次模型“下载并生成”确认框，180 秒等待结束时仍未开始音频或 ASR；安全关闭后修正驱动并重跑。这两次整体记失败，见[不完整自动化尝试](./merge-validation/incomplete-real-worker-attempts.json)。仅向 `transformers-cache` 导入文件不等于产品下载登记；真实确认成功后才写后台模型记录。此次确认框符合契约，没有据此修改产品。

## 真实媒体采集与交互

| 测试及产物 | 断言 | 结果 |
| --- | --- | --- |
| `56aab82ae`，仅 X 已加载元数据中的 MP4 候选 | 11 | 通过 |
| 同产物，主清单不响应后回退低码率 MP4 | 12 | 通过；恢复 5604 ms，包含原有 5 秒清单等待上限 |
| 同产物，前窗预览后注入后窗识别失败 | 8 | 通过；73% 时显示前句双语；不允许导出；失败清预览、保留重试、完整缓存为 0 |
| 集成产物 `2ef55939f`，元数据 MP4 候选 | 11 | 通过 |

媒体为真实 MSE/MP4/AAC，经过真实读取与 PCM 解码。以上四组的识别和 Microsoft 翻译响应受控，证明媒体归属、回退、字幕显示和失败状态，不能证明真实模型或联网翻译准确率。全部断言与构建 SHA 分别见 [元数据](./merge-validation/metadata-only-guarded/report.json)、[超时回退](./merge-validation/hung-master/report.json)、[预览失败](./merge-validation/preview-failure/report.json)、[集成产物](./merge-validation/integrated-metadata-only/report.json)。

## 实际模型与完整字幕链路

集成构建 `2ef55939f` 的专用临时 Chrome 中，11 秒自然英文样本经 AAC/MP4、真实 MSE、X 已加载候选、原生解码和实际 PCM16 消息进入生产 Base Worker，再由完整字幕控制器写入缓存并渲染字幕。12 项检查通过，结束后所有权守卫关闭成功。模型缓存的 7 个公开文件均核对字节数和 SHA，未发起模型公网下载；准备及识别均为真实调用。

| 观察项 | 本次结果 |
| --- | --- |
| 模型 / 后端 / 精度 / adapter | Base / WebGPU / q4 / `apple / metal-3` |
| 实际输入 | 16 kHz、单声道、11 秒、352000 字节 PCM16 |
| PCM16 SHA-256 | `a1e4ee4809a4cf6db864f34b4720746fb92742bfdeb0920b2dba8c06e275c3ab` |
| 完整结果 | 2 条字幕、22 词；参考文本 22 词，编辑错误 0，WER 0% |
| 模型确认到完整字幕就绪 / 截图 | 2514 / 3262 ms |
| Worker inference / decode | 786.7 / 3.6 ms |
| Microsoft 英译中独立联网请求 | 成功，449 ms |

模型缓存导入约 174.5 秒是离线测试准备开销，未计入产品识别时延。模型确认依次触发非 warm 准备和 generation 1 warm 准备，然后完成真实 ASR；本轮未直接保存模型登记读数，不能声称已经验收跨重启持久化。实际 Microsoft 请求使用正常 content/background 协议，中文响应成功；截图仍展示此前的受控翻译，供应商请求与 UI 证据分别记录。

以上只有一个缓存命中的自然英文样本，没有模型速度基线，也没有用户本次失败视频或人工中文真值。X 页面及 GraphQL 响应为本机夹具，不能当作用户登录页面或全站兼容性证明。模型、音频与完整自然转写均不入仓。[精简链路结果](./post-recovery-browser/report.json)保留源码、构建、输入和结果摘要；详细边界与必要截图见[恢复后浏览器说明](./post-recovery-browser-evidence.md)。

## 集成构建与确定性检查

独立 q4/q8 GPU 精度实验仍未完成：第一次原样 Tiny q4 成功 1 次后因报告工具路径错误中止，控制组未执行；修正后的唯一有界重跑在缓存导入时页面关闭，尚未准备或调用模型。失败不作为产品成功，也不推断模型不兼容。两轮已安全关闭，没有继续增加实例。该可选精度实验不改变默认，亦不推翻上述实际 Base 全链路及确定性修复验收；边界见[GPU 实验记录](./gpu-accuracy-experiment.md)。

集成后重跑 25 个相关文件的 463 条用例，11 个相关模块四维 100%；类型检查、864 条架构/说明/验证归属断言、Chrome/Firefox 构建及 manifest 验证均通过。集成包约 60.54 MB。测试归类审计为 597 文件、9431 用例（包含已合入主分支的漫画新用例），不是全仓回归声明。最终产物的 SHA 见 [构建来源](./build-provenance.json)。
