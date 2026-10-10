# 漫画连续翻译实现与验收

一次点击开启当前章节的连续翻译，滚动自动处理进入视口的漫画页；再次点击显示原图并暂停，再点恢复。首批适配 MANGA Plus `/viewer/<id>`，具体选择 `.zao-image-container img.zao-image`；使用已展示且允许访问的像素，不访问私有接口或抓取整章资源。

## 图像质量与阅读流程

普通 Tesseract 在用户提供的彩色页上产生逐行碎片、巨大译字和条纹修补；仅有译图出现不算质量验收。当前漫画路径使用本地 PaddleOCR PP-OCRv6 small：整页识别旁白，同时定位封闭浅色气泡，将每个气泡放大到最多三倍单独识别，再映射回原图。气泡独立分组，保留完整对白、字号与原始行框；过滤低置信度和明显绘画噪声，连接跨行断词。普通图片与圈选继续使用自己的 Tesseract 路径。

均匀气泡保留背景色，复杂背景按原字形及有界描边余量用本地动态 LaMa 模型修补。模型只回写蒙版区域，其他像素保留原图。译文字号受原字号和页面宽度限制，长文完整换行；原图和文字对照面板始终可用。

`mangaSession.ts` 管理串行队列、暂停、取消和迟到响应；`mangaReader.ts` 管理视口、换图、路由和卸载。失败页保留原图与单图重试入口，其他页继续，失败不会自动无限重试。切换原图保留当前可见页的已解码结果，即使关闭持久缓存也能立即往返；离屏结果释放，附近缓存受六张图和八百万像素限制。宿主 `src`、`srcset`、`sizes` 不被替换。普通页面不创建漫画观察器。

漫画按钮使用不依赖语言的漫画分镜与对话气泡图形，与品牌主体同为 40px，紧凑模式同为 32px。处理中显示内部进度圈，当前可见页完成后显示十九像素绿色勾，部分失败显示琥珀色提示，尊重减少动态效果偏好。独立阅读提示、首次下载和统一设置页详见[漫画阅读体验报告](./manga-reader-experience-20261003)。油猴保留不可用能力适配。

## 下载与资源

识别三文件共 31,114,838 字节，约 30 MiB；LaMa 206,291,843 字节，约 197 MiB，只在复杂背景需要时准备。总计 237,406,681 字节，界面约 226 MB。模型不随扩展打包；本地 CPU ONNX WASM 随扩展打包，Chrome 构建总大小约 93.58 MB。

默认先官方 Hugging Face，失败、二十秒无数据或完整性失败后换至独立第三方 `hf-mirror.net`。用户可选择官方优先或镜像优先。每个文件固定版本、尺寸和 SHA-256，完整校验后才写入扩展自有 CacheStorage；损坏文件不会进入推理。已完成文件可复用，未完成单文件重试会重新下载。取消立即结束页面等待并恢复原图，底层推理迟到结果丢弃。

设置提供来源、当前容量与进度、离线文件链接、多个文件导入和清理；导入使用相同完整性校验，不上传文件。清理先释放 OCR/修补会话，只删除漫画模型，保留普通语言包、配置和来源偏好；空闲三分钟释放推理会话。模型下载不携带图片、识别文字、凭据或 referrer。识别和修补都在本地，文字交给所选服务。

多来源和离线导入用于适应中国、美国及其他地区的不同网络条件。当前证据是本机网络、实际官方源阻断、完整镜像文件下载与离线导入；没有各国各运营商的现场测试，不保证任意地区随时连通。`hf-mirror.com` 会回跳官方源，未作为有效备用路径。

## 开源选择

| 方案 | 采用情况与原因 |
| --- | --- |
| [ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr) 6.6.0 / ppu-ocv 4.0.0 | MIT 浏览器识别，用原生 Canvas 与本地 ONNX，不下载远程执行代码 |
| [PP-OCRv6 small](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0；采用固定版本的 [ONNX 转换](https://huggingface.co/snowfluke/ppu-paddle-ocr-models)，多语模型；本次真实页验证英文 |
| [LaMa](https://github.com/advimman/lama) / [动态漫画 ONNX](https://huggingface.co/ogkalu/lama-manga-onnx-dynamic) | Apache-2.0，修补复杂背景原字形 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) Web 1.23.2 | MIT；版本锁定，本地 WASM，单线程 CPU |
| [manga-ocr](https://github.com/kha-white/manga-ocr) / [q8 ONNX](https://huggingface.co/kimchireader/manga-ocr-onnx-q8) | 研究过；日文专用、需要可靠气泡裁剪，不用于当前英文验收 |
| [comic-text-detector](https://github.com/dmMaze/comic-text-detector)、[Kites](https://github.com/Unheat/Kites)、[manga-image-translator](https://github.com/zyddnys/manga-image-translator)、[manga-translator-ui](https://github.com/hgmzhn/manga-translator-ui) | 研究检测、分组、修补、排版与阶段取消；GPL-3.0 源码未复制，按 FluentRead 的 WXT/Vue/TypeScript 重新实现流程 |

模型固定版本和第三方完整许可证/通知随产品保存于 `public/fluent-read-manga/NOTICE.md` 与 `public/third-party-notices/`。没有添加参考仓库依赖。其他产品的会员额度和网站列表不属于 FluentRead 支持声明。

## 验证

初始基线 `06e9efb3cd1d5dae0d5c4fb6728e9bf4812cd6ac`。只运行受影响专项。

| 范围 | 结果 |
| --- | --- |
| 漫画 OCR、模型下载、气泡分组、修补、排版 | 五文件 45 项通过；六个新增 service 模块四维 V8 覆盖均 100% |
| 连续阅读调度与站点适配 | 19 项通过；两个新增 content 模块四维 V8 覆盖均 100% |
| 图片/Offscreen/悬浮球、设置、i18n、配置差分与架构 | 十八文件 1205 项通过，四项初始基线已有架构失败 |
| 图片授权、安全、跨域、可选功能和配置 | 六文件 168 项通过 |
| 类型检查、测试归类审计 | 通过；审计只确认归类，不表示全量测试已运行 |
| Chrome / Firefox 构建 | 通过；Firefox 尚无实际运行证据 |
| 在线 MANGA Plus + 真实生产 PaddleOCR/LaMa + 在线 Google | 前五页与十五项浏览器检查通过，三张后续对白的关键完整句子单独断言；逐张人工查看截图 |

在线检查覆盖首次准备取消和恢复、原图往返不重发请求、滚动继续、开关卸载后重开持久化、关闭恢复、来源重开持久化、清理、四文件离线导入、420 像素深色设置布局，以及 Offscreen 官方源被真实 CDP 阻断后转用镜像。六次图片操作包含一次取消，在线 Google 请求 27 次。首次准备与取消恢复合计约 83.9 秒，后四页约 11.3 / 9.6 / 9.2 / 7.7 秒；这些数值受网络与设备影响，不作为通用性能承诺。

证据在工作区 `artifacts/manga-quality-20261003/verified-live/`，包含报告、原图、译图、三种按钮状态和模型设置截图。正常可见隔离 Edge 窗口在第二屏；启动和七次后续前台检查均为用户的 ChatGPT 前台，测试浏览器没有成为前台。结束关闭自己的实例并移除临时 profile。早期失败验收和中间效果另保留，不用其结果冒充当前通过。

初始四项架构失败已在初始提交只读快照复现：文档入口私有依赖、content runtime 282 行超过原有 277 上限、品牌验证脚本未登记归属、八个旧模块未登记严格覆盖。没有提高上限或忽略测试。

已验证的主要英文对白完整且可读，彩色旁白修补仍有局部纹理差异。细小边注和艺术拟声词可能保留原文，第一页引用编号仍误识别为 `1H`；Google 的人名、口吃和口语译法仍不够自然。所选文本服务影响中文质量。没有验证整章、日文实页、全部漫画站点、全球网络或移动设备；识别原文与译文可随时核对。


### 最新 main 集成

已合入 `87320918` 的普通图片解码复用、识别共享、标识跳过与术语边界；解决两处合并冲突时同时保留普通 OCR 的 `decodedImage` 和独立漫画识别入口。集成后的 21 文件专项有 1284 项通过、4 项基线架构失败；最新 main 的独立只读快照同样复现 18 通过 / 4 失败。其中验证归属断言现在还包含主分支的文档截图和构建检查脚本。

集成版 `artifacts/manga-quality-20261003/integrated-live/` 再次通过十五项在线检查。首次准备与取消恢复约 125.2 秒，后四页约 10.2 / 9.7 / 10.3 / 7.5 秒；所有文件实际从备用源获取并通过校验，离线导入和清理通过。受控阅读器在 `final-fixture/` 通过十二项检查，额外验证动态新增、换图、换章、宿主强样式隔离、处理中不出现完成勾，以及空白识别页保留原图并显示琥珀色提示。

Chrome、Firefox、userscript、文档构建与文档类型检查通过，userscript verifier 通过，文档输出检查 75 页面、3814 链接、712 锚点和 90 图片通过。合并后的语言资源先提交，再把 userscript 资源固定到 `89baa909`；保留已发布历史资源。未运行全量回归。

## 重跑

```sh
node scripts/testing/run-manga-translation-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <bundled-node-packages> \
  --focus-safe-helper <browser-test-skill>/scripts/focus-safe-browser.cjs \
  --artifacts-dir /private/tmp/fluentread-manga-fixture
```

追加 `--live-site --live-translation --quality-pages 5 --blocked-official --offline-models-dir <four-verified-files>` 重跑完整在线与下载检查。只带 `--live-site` 时站点真实，文本翻译仍是确定性夹具。
