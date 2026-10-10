# 文档批量翻译验证记录

基于 `origin/main` 的 `76df201403415af8f716cc21d379b09c4fa12b21`，在独立分支 `feat/document-batch` 实现。

## 完成的流程

- 文件选择器和拖放均支持多个文件，允许追加文件；解析错误按文件显示，不丢弃其他文件。
- 顺序翻译未完成的文档，单份翻译失败后继续；暂停会中止当前请求，续译保留已提交片段。
- 每份文件保留独立译文、人工校订、设置快照、错误和下载修订状态；切换文件复用现有阅读器。
- 部分译文与当前设置不同，需要逐份确认重译；外部设置变化后不继续启动下一份文件。
- 可单独下载，也可将已完成文件打包为 ZIP，选择双语或仅译文。同名文件放在编号目录中，避免覆盖。
- 移除未下载的译文和清空队列均有保护；刷新或关闭页面仍沿用现有未下载提示。
- 七种界面语言资源和中英文用户指南已更新。没有修改或借用参考仓库代码，没有新增依赖、修改版本或生成发布 ZIP。

## 通过的验证

- `pnpm test:audit`：277 个测试文件归类通过。
- `pnpm test:architecture`：27 文件 / 887 项通过。
- 文档既有测试：9 文件 / 100 项通过。
- 功能分组：57 文件 / 967 项通过；随后新增的页面状态测试 7 项独立通过。
- 回归分组：17 文件 / 395 项通过。
- 最终定向测试：`tests/documentBatchComponent.test.ts` 7 项与 `tests/i18n.test.ts` 43 项，共 50 项通过。
- TypeScript/Vue 编译、Chrome MV3、Firefox MV2 和文档构建通过；`git diff --check` 通过。

新增页面状态测试编译真实 `DocumentApp.vue` 的 setup，注入可控解析与翻译边界，覆盖失败隔离、重复名称、暂停后晚到结果、增量续译、独立人工校订、移除保护、设置变化和页面重置期间的异步解析失效。

## 实际浏览器与下载验证

使用最终 Chrome MV3 生产构建和临时 Edge profile，翻译服务为本机确定性 OpenAI 兼容夹具。运行 `scripts/run-document-translation-test.cjs`。

- `launchMode`: `macos-background-cdp`
- `focusPolicy`: `launchservices-no-foreground`
- `windowPlacement.mode`: `background-visible-no-focus`
- `windowPlacement.browserFrontmost`: `false`
- 窗口在第二块显示器可用区域内，使用独立临时 profile，无系统鼠标或前台激活。
- 最终结果 `ok: true`，非预期控制台错误为 0。
- 12 种格式实际解析、调用模拟供应商、校订并下载；长文暂停续译、未完成导出确认、重译和离开保护继续通过。
- 批量混合导入、非法 JSON、单文件翻译失败、后续文件继续、暂停续译、失败重试、跨文件校订和拖放均通过。
- 读取实际下载的 ZIP：只包含两个已完成文件，同名文件没有覆盖，人工校订已写入。
- 桌面、390 像素窄屏及暗色截图已检查；没有页面横向溢出。

最终证据目录：`/private/tmp/fluentread-batch-browser-final`。

- `report.json`：全部流程断言、焦点策略、下载与截图清单。
- `09-batch-completed.png`：桌面批量队列及校订。
- `10-batch-mobile.png`、`11-batch-mobile-dark.png`：窄屏亮暗主题。
- `batch-completed.zip`：实际打包下载。

这建立了真实 Edge 中的页面与下载证据，不代表真实供应商质量，也不代表 Firefox 实际交互已验证。

## 基线与环境限制

- 单元分组 3,069 项通过、1 项失败；严格覆盖率运行 4,354 项通过、同一项失败，因此不能声称全套测试或严格覆盖率通过。
- 失败为 `tests/model.test.ts:539`：基线图片翻译实现已改为默认关闭，而测试仍要求默认开启。本次未修改该实现或断言。
- 技能提供的通用 `--suite full` UI runner 在 popup 的旧标题定位器 `让阅读自然地流动|翻译功能已暂停` 超时，未进入完整套件。该次通用 UI 回归未通过；最终文档专项完整通过，两者分开记录。
- 原文档 runner 中的原生 `selectOption` 定位器已按当前 Element Plus 可见 wrapper 与选项更新，保留原有语义断言。
- 离线包不完整，在线安装遇到 npm DNS `ENOTFOUND`。本轮通过任务工作树的 `node_modules` 链接复用主检出已安装依赖，未改变锁文件。
