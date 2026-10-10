# 翻译模型目录核对（2026-09-12）

本次按原厂 API 文档、聚合平台公开模型接口核对模型编号。新配置优先选择 Mini、Flash-Lite、Haiku 等轻量或低成本型号；没有明确小模型档位或缺少当前接口证据的服务保留原默认。模型能力和价格属于厂商公开描述，本次没有用用户密钥进行真实翻译质量或速度对比。

## 已实施

| 服务 | 默认及候选调整 | 官方依据 |
| --- | --- | --- |
| DeepSeek | 默认改为 `deepseek-flash`，对应 9 月 10 日发布的 V4.1 Flash；保留 `deepseek-v4-pro` 和旧 `deepseek-v4-flash` 兼容别名 | [更新记录](https://api-docs.deepseek.com/updates/)、[模型与计费](https://api-docs.deepseek.com/quick_start/pricing/) |
| OpenAI | 默认从 Luna 改为 `gpt-5.4-mini`；Nano 可选，新增 `gpt-6-astra` 为大模型候选 | [Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)、[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| Azure、自定义兼容服务、New API | 初始建议改为 `gpt-5.4-mini`；Azure 仍需要填写实际部署名称，自建网关仍以其模型列表为准 | [Azure 模型](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/models) |
| Gemini | 默认改为 `gemini-3.5-flash-lite`；新增 3.7/3.8 Flash，保留既有可选型号 | [模型目录](https://ai.google.dev/gemini-api/docs/models) |
| 通义 | 默认改为 `qwen3.8-flash`；补入 3.7 Flash、3.8 Max，保留 3.6 Flash、Qwen-MT 与既有套餐候选 | [文本模型目录](https://help.aliyun.com/zh/model-studio/model-list-text-generation/) |
| Claude | 默认仍为 `claude-haiku-4-5`；新增 `claude-fable-5-1` | [Haiku 及别名](https://platform.claude.com/docs/en/models/haiku-4-5/overview)、[Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview) |
| 阶跃 | 默认改为极速文本型号 `step-2-mini`；新增 `step-3.5-flash-2603`，保留原 Flash 与其他候选 | [模型总览](https://platform.stepfun.com/docs/zh/guides/models/overview)、[Chat API](https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create) |
| 混元 | 默认保持 `hy3`；移除已于 8 月 31 日下线的 `hy3-preview` 预设，并迁移到 `hy3` | [下线公告](https://cloud.tencent.com/announce/detail/2391) |
| GLM | 保持 `glm-4.5-flash` 默认，清除重复的 `glm-5.3` 目录项 | [GLM 发布记录](https://docs.bigmodel.cn/cn/update/new-releases) |
| Grok | 新增 `grok-4.6` 供手动选择；没有确认更小的当前档位，保留原默认和旧选择 | [官方目录](https://docs.x.ai/developers/models) |
| OpenRouter | 默认改为 `google/gemini-3.5-flash-lite`；新增 `deepseek/deepseek-v4.1-flash`、`openai/gpt-5.4-mini`、`openai/gpt-6-astra`、`x-ai/grok-4.6` | [公开 Models API](https://openrouter.ai/api/v1/models) |
| Infini | 继续使用平台自身的 `deepseek-v4-flash`；解除与 DeepSeek 原厂最新编号的共用关系 | 原厂升级不能证明该平台提供同名路由；本轮未更改平台模型 ID |

## 保留项和证据边界

- MiniMax 继续默认 `MiniMax-M2.7-highspeed`，官方确认该速度档有效；MiMo 继续 `mimo-v2.5`，混元翻译继续 `hunyuan-translation-lite`。分别核对 [MiniMax 文本 API](https://platform.minimaxi.com/docs/guides/text-generation)、[MiMo 模型指南](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content)、[混元翻译 API](https://cloud.tencent.com/document/product/1729/113395)。没有因某个文档页面未列出既有 M3/M3.1 就将其判为退役。
- Groq 保持 `openai/gpt-oss-20b` 默认；不重新添加会被现有迁移规则替换的 Llama 别名。[Groq 模型目录](https://console.groq.com/docs/models)
- 豆包官方示例确认 `doubao-seed-2-0-lite-260215` 的 Responses 调用；本轮没有取得最新 Mini/Lite 的 Chat 接口契约，因此保留当前目录。产品展示名称不能直接作为请求编号。[方舟官方示例](https://www.volcengine.com/docs/82379/1795150)
- Kimi、文心、百川、零一、Infini 和硅基流动未取得足以替换现有型号的当前接口证据，保留原列表与默认。特别是聚合平台不能从原厂编号推测支持情况，也不能把旧版官方文档当成新模型下线证明。
- 本次没有把网页聊天产品名称、语音、图像生成或专用编码模型自动加入翻译默认。OpenRouter 的公开目录证明编号存在，不证明具体账户调用成功。

## 配置与请求行为

网页和文档默认都来自同一份目录。已有有效选择、自定义模型、模型级 Thinking 偏好和密钥要求保持不变；旧 `deepseek-chat` / `deepseek-reasoner` 继续按原规则迁移，只把目的型号更新为 `deepseek-flash`。旧 V4 Flash 别名保持原编号和其独立偏好。混元预览版迁移同时覆盖网页、文档与模型级偏好。

DeepSeek Chat 显式发送 `thinking.type=disabled`，Responses 发送 `reasoning.effort=none`，避免使用厂商默认开启的思考。Gemini 3.8 Flash 的最低档是 `low`；GPT-6 Astra 同样使用最低 `low`，不会向它发送不支持的 `none`。GPT-5.4 Mini 保持 `none`，Qwen Flash 保持 `enable_thinking=false`。具体来源：[DeepSeek Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[Gemini Thinking](https://ai.google.dev/gemini-api/docs/thinking)、[OpenAI Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)。自定义请求体仍有最终覆盖权。

测试覆盖新默认、目录去重、原厂与聚合商编号分离、旧配置与自定义模型保留、停服型号迁移，以及新旧 DeepSeek 编号的两种请求协议。无参考仓库代码或依赖被引入。

## 验证结果

- 最终完整覆盖率回归：227 个文件、4669 个测试通过，statements / branches / functions / lines 均为 100%。
- 架构检查：27 个文件、899 个测试通过；测试审计和 TypeScript/Vue 类型检查通过。
- Chrome、Firefox、userscript 构建与 userscript verifier 通过；中英文文档构建通过。
- 首次完整回归曾出现 `configStorage.test.ts` 中一项存储恢复断言失败；独立干净基线的该文件 28/28 通过，最终完整回归也通过。未修改存储实现或放宽该断言，不能将首次结果定性为稳定基线缺陷。
- 本次是官方目录核对、确定性测试和构建验证，没有使用账户密钥认证外部模型，也没有进行真实供应商译文质量测评或浏览器运行时测试。

合并前同步了主分支的油猴 Dexie 修复，补齐上游新增测试的 regression 分组登记；该修复相关的 19 项检查通过，并重新完成上述完整回归与构建。
