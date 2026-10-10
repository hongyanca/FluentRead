# 漫画 GPU 与导航缓存专项验证

任务分支：`codex/manga-pipeline-performance-20261004`。任务 worktree：`/Users/thinkstu/Desktop/copy/FluentRead-manga-pipeline-performance-20261004`。

## 缓存与重试补充验收

缓存实现 `85eb99c89b5a137fa0e71b0a41d3447e8047a666`；显式单页重试和实页布局采样修复 `0d8d0aa06a27588758bd4ae56fd8a440fc139a34`。这次补充不更换模型或推理算法，下文 GPU 对照保留其同环境测量，不能把缓存命中时间当成首次处理时间。

- 最后重试改动后的受影响业务专项：16 文件、357 用例通过；WASM 诊断另 12 项通过，总计 17 文件、369 用例。`mangaReader`、`mangaSession`、`imageLoads`、`mangaOcr`、`mangaInpainting`、`mangaEncoding`、`mangaGpu`、`mangaSessionFallback`、`offscreenRuntime`、`shared/onnx/webgpu` 共 10 模块四维覆盖率均为 100%，没有忽略；未运行全量回归。
- 补充用例覆盖译图数量/像素淘汰、大图不进入 LRU、空白结果零像素、上下左右返页、关闭缓存、源/目标语言失效、同地址重载和迟到首次加载、跨模式暂停、来源与 DOM 生命周期。重试先复现“成功后仍有错误”，再验证图片按钮和右键菜单都进入会话，等待另一页、发布进度、清除错误，重复点击/隐藏/暂停/卸载不能绕过队列或复活迟到结果。
- 已知站点八轮几何移动不再重复查询正文列表（8 次→0 次）；宿主节点、正文标记、响应式源和自定义任意属性/伪状态选择器仍更新。提前页与附近页共用 800 万原图像素，优先准备最近下页；该计数不是整站帧率测量。
- 最终重试实现重新通过类型检查、Chrome MV3 / Firefox MV2 生产构建、manifest、userscript/verifier；两种扩展未压缩 107.22 MB，userscript 1,894,682 字节。文档生产构建与校验通过（75 页、3754 链接、718 锚点、112 图片）。测试审计 455 文件、5824 个登记用例通过，这个总数是登记审计，不是本次全量执行数。
- 同样五个架构文件最新 802 项中 799 通过、3 失败，与修改前快照及前一阶段一致：文档工具归属、其他模块覆盖率登记和内容组装入口行数上限。新增 `imageLoads` 已登记到唯一测试矩阵与严格覆盖率。没有放宽检查或新增失败。

缓存阶段在实际 Chrome 154 中通过 24 项行为检查，全部使用本地经大小/hash 校验的四个模型资源，远端模型请求为 0；前两行使用受控文字传输，后两行使用在线 Google：

| 证据目录 | 检查 | 返显结果与边界 |
| --- | --- | --- |
| `cache-navigation-final` | 六张夹具、竖向/横向远距往返、同地址原生重载、空白标记、暂停/重开、语言失效，7 项 | 14 次 2.9–17.7 毫秒；总共 5 个处理请求，有效返页不新增 OCR |
| `cache-budget-prefetch-final` | 默认后三张、第五/六张不提前处理、准备页返显、暂停与设置持久化，7 项 | 初次当前加后三张共 4 次；当前页模式保存成功 |
| `cache-live-mangaplus-final` | 用户提供章节 `1024050`、在途返页、往返不额外识别、严格暂停恢复与重开，5 项 | 8 次 0.2–25.9 毫秒；总共 3 次请求，包括专项源失效；扩展及未知错误为空 |
| `cache-live-pixiv-layout-stable` | 用户提供作品 `150354216#1`、在途返页、严格暂停恢复与重开，5 项 | 8 次 6.9–67.5 毫秒；总共 2 次请求；保留两条广告宿主错误，扩展及未知错误为空 |

上述 24 项是导航缓存阶段证明；最终单页重试另由确定性错误注入验证，不声称在真实供应商制造故障。最终重试构建还重跑受控导航专项 `cache-navigation-delivery`，7 项全部通过，14 次返显中位数 12.4 毫秒、范围 4.4–65.2 毫秒；没有新增缓存页 OCR，总共仍为 5 次处理、模型请求及扩展错误为空，临时配置已清理。数字来自最终构建，不以较早较小范围代替这次波动；结果见[缓存摘要](./navigation-cache.json)。所有隔离浏览器均在第二屏正常可见但未抢焦点，临时 profile 已删除；没有访问用户日常配置。

Pixiv 首次暂停断言失败时，窗口由 900 高改为 700 高，宿主 resize 回调晚于原图采样，抓到了旧尺寸。脚本现在等宿主来源/样式稳定 300 毫秒再采样，且确认漫画尚未开启；严格对照 `style` 的断言不变。生产代码只接管原图 opacity/transition，没有写宽高。诊断记录 `cache-live-pixiv-final` 与成功记录都保留；没有把网站错误删除或归入扩展错误。不同网站/设备仍可能有渲染波动，上述小样本不构成 SLA。

本机日志：`/private/tmp/manga-cache-delivery-{targeted,wasm,compile,chrome,firefox,manifests,userscript,userscript-verifier,audit,architecture,native}-20261004.log`。先前失败复现另存 `manga-cache-{reproduce,budget-reproduce,pause-reproduce,source-reproduce,retry-status-reproduce}-20261004.log`，不把探索运行计入最终通过数。

### 最后主分支集成

更新 PR 时同步主分支 `41b4678a36bf01eafb0bbfe4b72ba7e2368a70ba`，保留词书/句子学习与官网改动。只有 userscript 语言资源固定提交发生冲突；重新生成联合五语资源，合并快照为 `7f5aaccf6ead1fcaeb2aafd9b8fd49d206cde9bb`，最终 pin 提交为 `2b18d0e3dd92526848d2234961b1a34e9badc637`。`package.json`、锁文件、漫画运行时代码与 ONNX 构建实现相对 `0d8d0aa0` 均无变化。

集成后重查漫画运行时、阅读会话、UI/userscript 语言包与 userscript 能力：5 文件、218 项通过（包含已执行漫画用例，不能作为额外不重叠的测试总数相加）。类型检查、Chrome/Firefox、双 manifest 和 userscript/verifier 全部通过；扩展未压缩总大小为 107.29 MB，userscript 1,897,384 字节，增量来自主分支集成内容，不归因于新增漫画模型。审计更新为 459 文件、5863 登记用例。

最新五文件架构检查 815 项中 813 通过、2 失败：三个既有文档工具缺验证归属、18 个其他模块缺严格覆盖率登记。主分支已改善旧入口行数问题；本任务没有放宽检查。对 `41b4678a` 原始主分支的独立临时代码快照运行所有权专项，9 项中同样 2 失败、7 通过，报错路径集合完全一致；新漫画模块没有加入该缺项集合。快照只写临时目录，不修改主工作树或来源 worktree。

最后集成的真实 Chrome GPU 冒烟 `cache-integration-gpu-smoke` 两轮通过：同一原图、真实 OCR/修补与受控文字传输，实际 GPU 提交 1090 / 314 次；完整处理分别 8.380 / 2.062 秒。这里只核对集成产物，不替换前面公平对照表或增加基准样本。两个处理请求、模型下载为 0、扩展/控制台/未知错误为空，原图恢复正常、临时 profile 已清理。最终文档构建与校验通过：75 页、3758 链接、722 锚点、112 图片。

集成日志：`/private/tmp/manga-cache-integration-{targeted,audit,architecture,baseline-architecture,compile,chrome,firefox,manifests,userscript,userscript-verifier}-20261004.log`。本节为最终集成结果，上文 107.22 MB / 802 项和三项失败保留为之前阶段记录。

## GPU 优化阶段与集成记录

来源 PR #783 精确 head：`22aa69496490a05d5f7907930992ec6c3fca82c8`；基础 `origin/main`：`5ed16bc6c081587622c86563b4a75fc452c697fb`。本任务在独立分支本地合入来源历史，新 PR 包含其静默阅读及滚动交接改动，不更新、关闭或合并来源 PR。没有直接推送 main。

交付前同步主分支 `d1bc548c56cee44fea71fc2a29c5bf5611b09f7f`，保留本轮期间合入的官网阅读布局、朗读功能和移动端图标；自动合并测试目录。主分支更新只涉及官网、验证脚本及测试，没有改变已测的漫画生产运行时代码；合入后再次编译、审计及构建文档通过，官网朗读专项 8 项通过。性能实现提交：`d74ff61883f5351d14b2c4ff6f94453a3144c1de`。

PR 创建后主分支进一步更新到云备份集成 `bbd36d91`，仅语言资源固定提交发生冲突。保留两边功能、生成合并后的五语快照并固定到 `978bb69e207e025d419818d23397285e136d781f`；按新锁文件安装本任务独立依赖，避免改动其他 worktree 的共享依赖。重新通过 334 项相关测试及四维 100% 覆盖率、类型检查、Chrome/Firefox、manifest、userscript/verifier、测试审计和文档构建/校验。新增错误提示复用已有多语言文案，编码专项 11 项再次通过。模型、运行时版本及图像处理算法保持一致；新依赖环境的真实 GPU 两轮冒烟通过，分别记录 1090 / 314 次提交，原图与译图恢复正常，模型下载为 0，临时 profile 已清理。

## 确定性验证

- 15 个受影响测试文件、334 个用例通过：OCR、修补、GPU 探测、GPU 故障回退、异步编码、Offscreen、图片读取/恢复/运行时、模型导入、无损画面及漫画会话。
- WASM 诊断专项另 12 个用例通过；合计 16 文件、346 用例。只运行本任务直接影响范围，没有运行全量回归。
- 严格覆盖率包含 `mangaReader`、`mangaSession`、`mangaOcr`、`mangaInpainting`、`mangaEncoding`、`mangaGpu`、`mangaSessionFallback`、`offscreenRuntime` 和 `shared/onnx/webgpu`；statements / branches / functions / lines 全部 100%，没有新增忽略。
- `pnpm test:audit`、`pnpm compile`、Chrome MV3 与 Firefox MV2 生产构建、双浏览器 manifest 验证通过；性能测量阶段两种构建未压缩总大小为 107.18 MB，集成最新云备份主分支后为 107.22 MB。模型不随本轮增加。
- userscript 构建与 verifier、文档构建与链接校验通过。首次 userscript 构建发现合并后语言资源缺失，补齐五个生成文件，并将资源固定到 `abaa7c86b49dd8f2b8425437e3c980c8947c17f8` 后通过；没有更改模型或升级依赖。
- 架构专项初次五文件 800 项检查中 797 项通过、3 项失败，最新主分支集成后 801 项中 798 项通过、仍为同样 3 项失败。修改前集成提交 `6d4b798d6ae045daad8151f615d17c3ce416248e` 的独立代码快照复现了同样三项：三个既有文档工具未登记验证归属，10 个既有 popup/share-card/i18n 等模块未进入严格覆盖率清单，以及 `src/app/content/runtime.ts` 已有 281 行超过 277 行上限。本轮没有放宽这些检查，也没有增加失败项；新增漫画模块已登记并严格覆盖。基线在临时快照执行 WXT prepare 后运行同样检查，不修改来源 worktree。

## 性能复现

脚本：`scripts/testing/run-manga-translation-test.cjs`。显式性能参数 `--pipeline-inputs <两张原图路径，逗号分隔> --pipeline-rounds 3 --prefetch-pages 0`；Chrome 154 使用 `--extension-debugging` 加载本任务生产扩展。每轮当前图是相同原始 data URL，确认未被夹具的异步 Blob 回调替换；实际点击开启、等待译图接管、核对原图仍是同一资源，然后恢复。

模型准备：`--preload-models-dir /private/tmp/fluentread-manga-ocr-probe/models --blocked-all-model-sources`。设置页导入四个真实文件，CacheStorage 中核对字节数和 SHA-256，两个远端来源都阻断，模型下载请求为 0。ORT 公共会话包装记录每次初始化及推理时间、输入形状、GPUQueue 提交与 Canvas 编码方式；插桩只作用于自有临时扩展 Offscreen，不进入产品代码。

性能插桩先导入 ORT 命名空间，首次样本不覆盖其首次模块加载解析或模型下载；它覆盖首次模型会话、WASM 与着色器初始化和点击到译图显示。普通实页专项不使用该性能插桩，但其结果还包含网站及在线服务波动，两种时间分别记录。

相同浏览器与硬件基线目录：`artifacts/manga-pipeline-performance-20261004/chrome-baseline`。最终性能及逐像素比较摘要：`artifacts/manga-pipeline-performance-20261004/delivery-summary.json`。两个样本每版各三轮；连续两轮取中位数。识别与修补都真实运行，受控文字服务首次请求延迟 250 毫秒并返回固定译文，缓存设置一致，不能把此结果当作真实供应商速度或译文质量证据。

GPU 提交基线六轮均为 0；最终复杂页 1090/314/314，多对白页 566/566/566。前后六批 OCR 文字一致，尺寸均为 784×1145，alpha 相同；复杂页只有 13 像素单色阶差异，多对白页完全一致。没有改变模型、量化、置信度、输入大小或文字蒙版边界。

## 浏览器验证范围

所有浏览器使用临时 profile、`macos-background-cdp`、`launchservices-no-foreground`、第二屏正常可见窗口 `background-visible-no-focus`，`browserFrontmost=false`；结束删除 profile。不连接日常浏览器，不调用前台聚焦。

CPU 兼容专项使用实际 Edge 131，缺少运行时所需 `GPUDevice.adapterInfo`，直接使用 WASM。模型已准备且来源全部阻断，验证当前页、关闭缓存、第二页处理时返页、重复往返、暂停恢复、迟到结果、来源失效、换章和保留窗口以外缓存恢复。

实页限于 MANGA Plus `1024050` 与 Pixiv `150354216#1`，使用在线 Google 文字服务。Pixiv 重测发现并修复了“预译关闭、下页离屏完成后被释放”导致的重复识别；故障前相同原图指纹重复三次，修复后保持原来的两次请求。网页的广告脚本还会触发弃用 API 和匿名 SSP 错误；通过源 URL 或 CDP 默认网页执行上下文归属记录为宿主错误。扩展错误和无法归属的错误仍使测试失败，所有原始错误都保留在本机报告，没有修改或压制网站脚本。

最终浏览器专项 26 项行为检查通过，另有 6 轮性能样本通过：

| 目录 | 结果 | 有效结果返页测量 |
| --- | --- | --- |
| `delivery-final-gpu` | 两张相同原图各三轮；真实 GPU 提交、模型推理、编码及译图显示 | 性能见[摘要 JSON](./summary.json) |
| `delivery-prefetch-verified` | 7 项：当前加后三张、第五/六张不处理、准备页显示、暂停与设置保存 | 不把已准备页当首次处理测量 |
| `delivery-cpu-scroll-verified` | 实际旧 Edge CPU 路径 9 项；无下载与 CPU 厂商告警噪声 | 10 次，0.9–16.5 毫秒 |
| `delivery-mangaplus-verified` | 实际 MANGA Plus / Google 5 项；往返没有新增识别 | 8 次，4.7–22.7 毫秒 |
| `delivery-pixiv-verified` | 实际 Pixiv / Google 5 项；修复后总共两次识别 | 8 次，6.1–344.3 毫秒 |

返页是在页面内从滚动到原图透明、译图接管的首帧，再核对实际译图位置。Pixiv 仍有网站脚本与渲染波动，未单独归因，也没有设置跨设备延迟 SLA。两个实页首张本轮分别约 7.8 / 13.2 秒，含模型、识别和在线文字服务，不能与受控暖启动数字混用。全部最终记录的模型下载请求为 0、扩展和未知页面错误为空，测试浏览器未在前台，临时 profile 已删除。Pixiv 保留三条归属宿主的错误（含匿名广告脚本），没有把它们描述为扩展错误。

初次 Pixiv GPU 检查 `delivery-live-pixiv` 和 `pixiv-diagnosis` 在无新增识别断言失败；`pixiv-retention-fixed` 的五项行为通过，但未知匿名页面错误仍使总状态失败。继续追踪并通过 CDP 默认网页执行上下文归属后，最终通过记录为 `delivery-pixiv-verified`。完整本机目录：`/Users/thinkstu/Desktop/copy/artifacts/manga-pipeline-performance-20261004/`。探索阶段错误和初测保留，不把诊断运行计为最终通过证据。

## 未验证范围

真实 Firefox、Windows/Linux、移动端、低端设备、不同显卡、各国网络和全部漫画网站未覆盖。Firefox 与 userscript 的构建只能证明相应产物可构建，不能证明真实 Firefox WebGPU 运行。两张英文性能样本不构成所有语种识别率或翻译质量保证；Pixiv 实页功能验证也不替代人工日文译文验收。
