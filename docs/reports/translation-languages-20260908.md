# 翻译语言校对（2026-09-08）

本次将通用目录扩为 52 项，并检查新增的 44 项在 Google、Microsoft、DeepL 与小牛文本翻译中的代码。原有配置和中文简繁处理保留；未借鉴参考仓库代码。

## 供应商差异

| 服务 | 处理 |
| --- | --- |
| Google 网页 RPC 与 gtx | `nb` → `no`，`fil` → `tl`；其余新增代码原样传递 |
| Microsoft Edge 文本翻译 | `sr` → `sr-Cyrl`，对应目录原生名称使用的西里尔字母；`nb`、`fil` 保留 |
| 小牛文本翻译 | `nb` → `no`；其余新增代码在官方网页语言目录中均存在。HTTP 200 缺少有效译文时按失败处理，不缓存为成功 |
| DeepL API | `fil` → `TL`；`kn` 和 `si` 未列入当前官方语言表，在源或目标位置均提示切换服务；其余新增代码按官方大写代码请求 |
| DeepLX | `fil` → `TL`；具体支持范围由部署端点决定，不假设与官方 API 同步 |

DeepL 当前的 `enable_beta_languages` 已废弃且无效果，不新增该参数。官方表中上述可用语言具有标签处理能力，现有 HTML 处理参数保留。

不新增静态全局白名单来清除旧配置或限制自定义服务。此校对不代表所有其他机器翻译服务、OCR 或语音识别都支持全部目录语言。

## 依据

- [Google Cloud 语言代码表](https://docs.cloud.google.com/translate/docs/languages)：代码参考；插件使用网页接口，因此另做实际请求。
- [Microsoft 官方语言表](https://learn.microsoft.com/en-us/azure/ai-services/translator/language-support)：书写系统与代码参考；插件使用 Edge 端点。
- [小牛官方文本接口文档](https://niutrans.com/documents/contents/trans_text)：读取其公开页面脚本 `app.1788837232483.js` 的 `develop_text.language`，逐项检查新增代码，未采用旧第三方映射表。
- [DeepL 官方语言表源码](https://github.com/DeepL/api-docs/blob/main/snippets/language-table.jsx)：校对语言代码、translation 与 tagHandling 能力。
- [DeepL 翻译请求文档](https://developers.deepl.com/api-reference/translate/request-translation)：废弃参数及语言参数规则。

## 验证边界

供应商协议测试使用网络替身，覆盖全部新增语言、源/目标参数、Google RPC 失败后的 gtx 参数保留、DeepL 不支持语言的请求前拒绝及小牛业务错误。它们不代表真实服务质量。

使用公开测试句子 `Hello, how are you?`，单独请求生产端点：

| 端点 | 目标代码 | HTTP | 返回译文 |
| --- | --- | --- | --- |
| Google 网页 RPC | no | 200 | Hei, hvordan har du det? |
| Google 网页 RPC | tl | 200 | Hello, kumusta ka na? |
| Google 网页 RPC | ar | 200 | مرحبا، كيف حالك؟ |
| Microsoft Edge | sr-Cyrl | 200 | Здраво , како си? |
| Microsoft Edge | nb | 200 | Hei, hvordan har du det? |
| Microsoft Edge | fil | 200 | Hello, kumusta ka? |

这些是合成文本的直接 HTTP 请求，不是扩展浏览器 UI 测试。未使用 DeepL 或小牛付费密钥，未验证全部语言方向、长文、文档或译文质量。

全量回归发现主分支提交 `8f200eb` 已将图片翻译改为默认关闭，而旧测试仍期待开启。校对期间主分支也同步修复了此测试；最终保留主分支的显式启用/关闭断言，没有修改图片翻译实现。
