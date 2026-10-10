# 图片翻译 HAR 诊断与修复（2026-10-03）

用户提供的 HAR 与 X 图片报错截图证明图片翻译存在无效请求和错误回退的问题。修复基于主分支 `06e9efb3`，位于 `codex/image-translation-har-fix-20261003`。

## 请求证据

HAR 中有 65 个翻译请求、51 种不同文字，网络阶段从北京时间 13:35:46.272 持续至约 13:35:54.132，共 7.86 秒。该记录不包含图片读取、OCR 和译图绘制时间，不能据此计算完整操作耗时。

| 请求入口 | 请求数 | 观察 |
| --- | ---: | --- |
| Microsoft Edge | 37 | HTTP 200；每次只发送一个 OCR 片段 |
| Google 主网页 RPC | 10 | 全部 HTTP 400，响应包含 XSRF 拒绝标记 |
| Google 备用网页 RPC | 10 | 9 个 HTTP 200，1 个状态 0，不能仅据 HAR 判定取消或网络故障 |
| DeepLX 公共接口 | 6 | HTTP 200，部分返回原文 |
| MyMemory | 1 | HTTP 200，成功翻译普通句子 |
| Google gtx | 1 | HTTP 200，网址原样返回 |

`docs.sglang.io/cookbook` 先后请求 DeepLX、Microsoft、Google 两个 RPC 和 gtx，共五次。网址本应保留原文，但响应校验的短文本启发式把网址中的词视为未译正文，导致继续换线。免费批量任务采用失败即取消同批的语义，因此这种误判有能力使整张图片失败。

截图出现 MyMemory HTTP 400，但这份 HAR 唯一的 MyMemory 请求是成功响应，不能把截图的最后一次失败与 HAR 的单次 MyMemory 请求混为同一次尝试。截图中的多个“返回未翻译原文”与代码中的网址误判一致；无需推断所有免费线路同时宕机。

请求中还包含 `—`、`©`、`1` 以及 `inclu`、`sionA`、`Googh` 等 OCR 碎片。所检查的请求正文只有识别文字和翻译协议参数，没有图片像素或整页 HTML。错误片段主要来自本地 OCR，不代表额外拼入了网页内容。

## 已修复

- 图片文本去重后，排除纯数字、符号和被现有语言规则识别出的网址、版本、技术标识；原行、坐标、阅读面板原文及重复位置保持对应。标识旁的正文与单字、多语文字仍参与翻译。
- 用户明确配置且命中语言、网站范围的术语优先于标识跳过，继续进入现有 broker 应用固定译名。
- 响应校验接受纯技术标识的原文回显；普通外语正文回显和明确错语种仍按失败处理，避免伪成功。
- Google HTTP 400 且包含 XSRF 标记时，仅暂停该固定 RPC 入口五分钟；后续文字直接尝试其他入口，冷却到期可再次探测。普通参数错误不触发该规则，迟到的旧成功不能清除新失败的冷却。状态只记录入口和恢复时间，不保存响应令牌或原文。
- 浏览器脚本增加 `--har-fixture`：通过生产 runtime 验证标识原样返回且不请求服务、首个 Google 入口拒绝后第二段直接使用备用入口。X 回归脚本同步使用现有独立阅读面板的选择器。

## 并发和剩余限制

免费聚合服务的批量接口仍会拆成逐段翻译，并不是整个 OCR 结果合并为一个网络请求。批量窗口为 3，微软线路最多 2 个在途请求，并有服务间隔、共享总预算、取消和缓存。没有发现无限并发或无限重试；逐段调度、OCR 碎片和跨服务回退共同造成耗时。

本次没有调整服务权重、启用列表、用户模型或保存配置，没有增加并发，也没有改变实际正文翻译失败时保留原图并提示重试的语义。完整识别结果仍需核对：低分辨率文字、图标和模型名可能误识别；单个字母或无法可靠认定的短词不会被武断删除。原生多段请求合并仍属于后续性能改进，不能宣称本次已实现。

## 验证

- 14 个相关测试文件：763 项全部通过，覆盖图片生命周期、免费回退、Google 适配器、broker、请求调度、技术标识和语言判断。
- 针对图片后台和响应校验的覆盖率：122 项相关用例通过，statements、branches、functions、lines 均为 100%。专项按名称选取图片/OCR/Offscreen/响应校验用例；未选择的其他业务和已确认基线失败不计入通过范围。
- `pnpm compile`、`pnpm test:audit` 通过；Chrome、Firefox、userscript 构建、userscript verifier、扩展 manifest verifier 和文档构建通过。
- 真实 Edge、生产扩展、真实 Tesseract：普通图片流程 20 个场景通过；最终 X 图片结构和 HAR 回归 6 个场景通过，含翻译、恢复、缓存复用以及入口冷却。文字翻译响应使用确定性夹具；HAR 专项识别文字和 XSRF 响应为合成输入，不是重放私有 HAR。
- 两次浏览器均采用自动临时 profile、`macos-background-cdp`、`launchservices-no-foreground`、第二屏正常可见窗口、`background-visible-no-focus`，报告确认 `browserFrontmost: false`。测试后 profile 已清理，并检查了结果截图。

浏览器证据位于 `/private/tmp/fluentread-image-har-browser-flow-20261003/report.json` 和 `/private/tmp/fluentread-image-har-browser-final-20261003/report.json`。测试、覆盖和构建日志位于 `/private/tmp/fluentread-image-har-*`。证据不代表用户登录 X 页、原始海报的 OCR 准确率、线上服务延迟、Firefox 实机或商店版本已经验证。

扩大检查发现六项既有失败，均在未修改的主分支复现：

1. `imageGlossaryContext` 两项并发夹具按裸 `API` 等待，却收到现有 broker 的术语占位符。
2. `moduleBoundaries` 的文档入口 import 白名单与内容 runtime 行数上限两项。
3. `backgroundFeatureHandlers` 的输入框服务默认值与区域设置入口两项。

这些失败保留并如实记录；本次未更改它们的产品行为或放宽门禁。两个参考仓库未参与本次实现。
