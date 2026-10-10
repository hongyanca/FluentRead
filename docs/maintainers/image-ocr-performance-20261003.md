# 图片 OCR 重复准备与并发识别优化

2026-10-03。用户报告图片识别等待较长。本轮基于 `d28e1b5a`，检查 OCR 阶段并优化可确认的重复工作。前一轮文本翻译问题见 [HAR 分析](./image-translation-har-20261003.md)。

## 已实现的行为

- 切换语言优先在现有 Tesseract Worker 上重新初始化，只加载尚未加载的模型；语言准备完成后，再次准备同一包直接复用。准备包不再改变当前识别语言。
- 一个 Worker 累计持有的模型超过五个时重建，覆盖默认简繁中英日及日文竖排组合，同时限制持续切换其他语言产生的模型内存。
- 同一图片、语言及识别策略的在途请求共享一次 OCR。每个调用方独立接收进度和取消；最后一位调用方取消才中止底层识别。失败后允许重试，迟到结果不能覆盖新任务，每份返回结果独立复制。
- 整图 OCR 借用预检阶段已经解码的图片，不再额外创建解码对象；图像仍由 Offscreen 主操作在成功、失败或取消后释放。

Worker 切换失败会返回真实错误并释放该 Worker，后续重试重新创建；切换取消后，迟到的初始化成功或异常不能销毁后续任务的实例。重新初始化后重新配置页面分割参数。引擎支持依据为 [Tesseract.js 6.0.1 API](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md#worker-reinitialize)。

## 实测收益与边界

使用相同的生产构建、真实打包 SIMD/LSTM 引擎与公开默认语言模型，在两个独立临时 Edge profile 中运行。识别测试走生产 Offscreen 区域 OCR 入口，包含裁剪、图片处理和消息开销，不含文本翻译。英文、混合中日文、竖排印刷样本和用户提供的本地截图各测三次，表中单张图片取中位数。

| 场景 | 原实现 | 优化后 | 解释 |
| --- | ---: | ---: | --- |
| 已加载模型，再次逐包准备 | 287.6 ms | 10.8 ms | 减少约 96%，跳过重复语言初始化 |
| 两个请求同时识别同一截图 | 9081.3 ms | 4989.5 ms | 总等待减少约 45%，共享一次 OCR |
| 单张新截图，自动源语言 | 4647.1 ms | 4705.7 ms | 基本持平，文字识别计算仍占主要耗时 |
| 单张英文印刷样本，自动源语言 | 242.5 ms | 240.3 ms | 基本持平 |
| 单张混合中日文样本 | 471.6 ms | 470.9 ms | 基本持平 |
| 单张竖排样本 | 485.2 ms | 467.0 ms | 不据此声明普遍提速 |

前一次独立测量的同图并发等待为 9090.3 → 4603.3 ms；收益方向与最终测量一致。语言切换样本为约 251 → 217、405 → 352、349 → 301、396 → 356 ms，范围只覆盖本机和本组图片。

首次准备（包含下载）最终两次分别为 2763.4 和 4476.7 ms，另一次网络等待更长。独立 profile 的 CDN/网络状态不同，这些数值不能作为冷下载加速或回退证明。首次使用的网络等待仍然存在。

十二组单图结果及同图并发结果的归一化文字、方向标记、坐标逐项相同；四次语言切换后的结果也逐项相同。这是回归证据，竖排样本本身仍有错字，不能据此宣称竖排、复杂背景或手写识别准确率提高。

另一次直接使用同一真实引擎识别用户截图的实验中，自动组合约 4.0 秒，英文单模型约 1.2 秒；英文单模型不能正确识别截图中的中文。调整自动组合的主语言顺序没有稳定收益。使用文档说明了纯英文图片可选择 English，混合文字继续使用自动检测。

数值摘要：[summary.json](../reports/image-ocr-performance-20261003/summary.json)。

## 验证

- OCR Worker、识别缓存/任务共享、Offscreen 生命周期三组定向测试共 97 项通过。四个可执行模块 statements、branches、functions、lines 均为 100%；新增模块已登记严格覆盖边界。
- 图片识别归一化、翻译编排、内容生命周期、客户端恢复相关测试通过；圈选几何、触发、恢复、文字翻译及 Offscreen adapter 相关测试通过。
- 类型检查、测试审计、源码头注释与 provider 边界检查通过；Chrome/Firefox 生产构建及 manifest 校验通过。
- 生产 Offscreen OCR 性能脚本验证了真实模型准备、同图并发、单方取消和语言切换，原实现及最终优化构建均成功。浏览器使用 `macos-background-cdp`、`launchservices-no-foreground`，第二屏后台可见正常窗口；未抢前台焦点，结束后移除临时 profile。
- 最终 Chrome 生产产物的整图流程 20 个场景通过，覆盖真实 OCR、完整阅读面板、取消、重试、Offscreen 通道恢复、原图恢复、缓存再展示和宿主 DOM/透明图生命周期；X 图片结构及简繁中英夹具 7 个场景通过，含首次准备日文/竖排模型与前一轮 HAR 请求过滤。翻译服务使用确定性响应，X 为本地结构夹具，这些结果不代表在线供应商或用户登录态 X 页面验证；Firefox 本轮仅做构建与 manifest 验证。

完整浏览器证据位于 `/private/tmp/fluentread-ocr-optimization-browser-flow-20261003/report.json` 和 `/private/tmp/fluentread-ocr-optimization-browser-multilingual-20261003/report.json`。本轮沿用 FluentRead 的实现边界，未借鉴或修改两个参考项目。

现有 `moduleBoundaries` 的文档 UI import 白名单、content runtime 行数上限两项失败，`verificationOwnership` 的品牌校验脚本登记、八个其他模块覆盖登记两项失败，均在未修改的主 checkout 重现。本轮新模块已正确登记，不归入基线欠缺；未为了清绿改写这些无关断言。

## 复测入口

```sh
node scripts/testing/run-ocr-performance-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --artifacts-dir /private/tmp/fluentread-ocr-performance \
  --label candidate
```

可通过 `--image-file /absolute/path/to/image.png` 添加本地截图。脚本只记录识别结果与计时，报告不保存图片像素；真实模型下载需要联网。对比时先保留原生产产物，再依次运行基线与优化构建，避免并行构建或浏览器竞争影响计时。
