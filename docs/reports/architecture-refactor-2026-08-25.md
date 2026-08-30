# FluentRead 架构重构、代码审查与回归报告

日期：2026-08-25（Asia/Shanghai）

## 结论

本次变更把 FluentRead 从以 `entrypoints/`、`entrypoints/utils/` 和巨型页面文件为中心的横向堆叠，迁移为 `app / features / core / services / providers / platform / shared / ui` 的目标分层，并用 fitness tests 锁定 core、provider、跨 feature、entrypoint 与复杂度等关键边界。WXT 文件式入口继续保留在 `entrypoints/`，业务能力则按全文翻译、悬浮翻译、划词翻译、输入框、单词本、图片、区域、文档、视频字幕与设置等纵向 feature 组织。

代码审查同步修复了消息路由、翻译缓存、配置历史、页面生命周期、文档预览、浏览器 ID 边界与 UI DOM 兼容性等问题，并建立可按架构、单元、功能、回归分别运行的一套测试矩阵。

最终验收基于刷新后的 `origin/main@8aed0f7`（与工作分支基线一致）：完整一键流水线与六组隔离 Edge 浏览器验收均以退出码 0 通过。GitHub PR、merge commit 和主分支祖先关系由交付回执在合并后单独记录，避免在仓库报告中预写尚未发生的远端状态。

## 架构结果

### 分层与 Go 心智模型

| 目录 | 近似 Go 概念 | 主要职责 |
| --- | --- | --- |
| `entrypoints/` | `cmd/*` | WXT 发现入口与运行时启动 |
| `src/app/` | application bootstrap | 静态注册、依赖注入和生命周期组装 |
| `src/features/` | 业务 package | 用户可感知的纵向能力 |
| `src/core/` | 纯领域 package | 翻译、规则、语言、热键等纯算法 |
| `src/services/` | use case/service | 翻译 broker、缓存、上下文与配置协调 |
| `src/providers/` | interface implementation | 各翻译供应商协议适配 |
| `src/platform/` | infrastructure wrapper | HTTP、Shadow UI、浏览器边界 |
| `src/shared/` | 小型公共 package | 无业务语义的 DOM、函数与几何工具 |
| `src/ui/` | UI kit | 跨 feature 的 Vue 组件和设计 token |

### 插件化边界

- content feature 使用静态 `featureRegistry` 和显式 `mount/unmount/isMounted` 生命周期，不在运行时扫描目录。
- background 使用类型化 handler registry；未知消息不再意外落入翻译 provider。
- feature 通过 `public.ts` / `protocol.ts` 暴露契约，架构测试拒绝跨 feature 读取内部实现。
- WXT、Vue、真实 DOM、浏览器存储和网络适配保留在 composition/platform 边界；纯算法进入可隔离测试的模块。
- `src/platform/offscreen/client.ts` 独占 Offscreen document 的创建与重用；图片 OCR、Chrome Translation 与划词 TTS 通过各自 feature adapter 使用该平台端口，不直接复制生命周期逻辑。
- Chrome MV3、Firefox MV2 与 userscript 共用同一翻译 broker/cache 语义，避免平行实现漂移。
- 少量 feature 仍通过 `src/app/translation` 客户端或 background router 类型复用应用层契约；它们不形成循环，但属于后续下沉 public port 的明确迁移债务，不能把当前状态夸大成“全仓完全单向”。

### 主要迁移

- 翻译候选、序列化、布局、文本规则与站点 adapter → `src/core/translation/`。
- 配置模型、校验、凭据、迁移、服务目录 → `src/core/config/`；持久化与历史协调 → `src/services/config/`。
- 翻译缓存、请求去重、队列、上下文、错误与模板 → `src/services/translation/`。
- 所有翻译供应商 → `src/providers/translation/`。
- 全文、悬浮、划词、输入框、悬浮球、图片、区域、文档、视频字幕、单词本、设置 → 对应 `src/features/*`。
- Shadow UI 与 HTTP → `src/platform/`；无业务工具 → `src/shared/`；通用组件与 token → `src/ui/`。
- options 与 document 页面通过 `src/app/*` 组合；background/content/offscreen 使用独立运行上下文的静态组装根。

## 代码审查发现与修复

### 正确性与状态一致性

- 严格解析 background 消息并为未知类型返回明确错误，避免任意 payload 被当作翻译请求。
- 翻译 broker 拒绝非字符串、混合类型或数量不匹配的 provider 结果；错误结果不进入缓存。
- 空文本、全空白和空 batch 不再触发凭据、provider 或缓存副作用。
- 单条、批量和 AI 页面摘要在第一次异步缓存读取前冻结完整 provider 配置；endpoint、model、proxy、prompt、custom body 与凭据不会在冷缓存等待期间发生 TOCTOU 错配，也不会把配置 B 的译文写入配置 A 的 key。
- 并发翻译去重改用摘要阶段扣时后的精确毫秒 deadline；`1001ms` 与 `1999ms` 不再因同属一个秒级桶而错误共享 Promise，相同总预算但正文剩余时间不同的请求也不会互相拖成提前超时，完全相同的剩余预算仍可复用在途工作。
- 清理缓存会切换请求代次、断开旧 pending 去重并等待已经进入存储适配器的旧写入；在途请求仍可返回给原调用者，但不能在清理成功后复活旧缓存。
- `useCache=false` 同时禁止正文和 AI 页面摘要的内存/持久缓存读写，只保留同一请求内的 pending 去重。
- 页面上下文快照会排除脚本、表单、隐藏/不可翻译/可编辑区域及敏感属性，Defuddle 与 body-clone 回退使用同一隐私边界。
- 修复 `tabId=0`、`windowId=0` 被 truthy 判断误判为无效 ID 的边界。
- 修复配置历史并发 flush 互相覆盖、版本冲突、截断后 cursor 指向错误记录的问题。
- 损坏或未知版本的配置历史不再恢复；历史中的凭据会被丢弃并清理，而不是重新持久化。
- 配置写入 session 失败时保留原有凭据，避免迁移过程中造成数据丢失。
- 全文翻译恢复、动态 DOM 重扫与新会话重译继续按 session/DOM/text 身份隔离。
- 文档翻译在启动时冻结源语言、目标语言、服务和模型；多批次执行期间修改设置不会产生同一文档混用两种语言的结果。
- Chrome 内置翻译的真实 Offscreen payload 与 broker 的请求级语言覆盖使用同一身份，避免语言切换后命中错误缓存。
- 修复 capability singleton 把整个 `import.meta` 留进 classic MV3 `background.js` 的发布级缺陷：旧产物会在浏览器解析阶段崩溃，所有后台消息悬挂。现在只直接读取可静态替换的 WXT env 字段，并在产物校验中同时检查 runtime marker 与 classic background 不含 `import.meta`。
- Chrome 构建被 Edge 加载时根据 `Edg/` UA 关闭 Chrome Translation，同时保留 Edge 可用的 Offscreen、图片、圈选与 TTS 能力；本轮不承诺 Opera、Vivaldi 或 Brave 的宿主识别。

### 功能与 UI 回归

- 修复 TXT 文档首段为空时译文与后续预览段落错位。
- 修复 hover 的 pointerdown 未提前占用划词快捷键，可能导致同一手势触发两个功能。
- 修复零触点中心计算产生 `NaN`。
- 修复全文节点指示器使用部分 DOM 实现中只读的 `innerText`，改用 `textContent`。
- 异步 Shadow UI 挂载增加所有权检查和迟到结果清理；单个订阅者异常不再中断其他 feature。
- 站点快速禁用再恢复时，失效 content activation 只跳过自己的迟到结果，不再全局卸载恢复 activation 刚重试成功的悬浮球、划词或圈选 singleton UI。
- 词典、OCR、区域/图片翻译 handler 增加输入与 provider 输出校验；词典翻译失败保持原卡片数据。
- OCR Worker 的识别、参数设置、语言包下载和语言切换改为串行所有权队列；正在识别的 Worker 不会被另一语言请求提前终止，同一 Worker 的参数也不会交叉覆盖。
- 划词 TTS 改用 content 生成的 UUID 和 `{tabId, clientRequestId}` 自描述路由；MV3 Service Worker 重启后仍能转发 ended/error/stop，旧播放状态不会碰撞或停止新播放。内容侧的 pending/active/generation 已提取为严格覆盖的状态控制器，失败响应会清理 pending UUID，迟到状态与 stop→new play 只按旧 UUID 定向清理。
- Offscreen 音频每次播放独占 Audio 与 Blob URL；非法新请求不打断旧音频，迟到的 play rejection/ended/error 不污染新状态，停止与销毁会精确释放资源。
- MAIN-world Shadow/YouTube bridge 支持幂等安装，以及站点禁用时恢复宿主 API、恢复启用时无嵌套重装；BFCache `pagehide` 不再让 YouTube bridge 永久失效，复用或同步失败的 XHR 也不会把旧 timedtext URL 发布到新请求。
- Popup 在 storage 配置完成 hydration 前使用 `inert` 与 `aria-busy` 阻止早期误操作，设置保存使用序列化快照去重，失败会释放去重标记以允许后续重试。
- Userscript 的凭据迁移/保存继续使用 GM 私有存储语义；扩展专属图片、区域和视频能力使用精确 public alias，不把浏览器 runtime 意外打入 userscript。
- Userscript 构建对整个 Vite 模块图（含 `src/` 与 Vue 虚拟 script 模块）注入词法 browser/chrome 兼容层，并在最终 bundle 上扫描未解析自由全局；架构迁移后不再因只扫描 `entrypoints/` 而生成启动即抛出 `ReferenceError: browser is not defined` 的产物。
- 页面缓存迁移只删除 FluentRead 自有键，禁止使用宿主页面存储的广域 `clear()`。

### Firefox 与运行时能力

- WXT manifest 由同一 browser/MV capability contract 生成：Chrome MV3 声明 Offscreen，Firefox MV2 不再声明未知的 `offscreen` 权限，也不生成 `offscreen.html`。
- 图片 OCR、图片翻译和圈选翻译在不支持 Offscreen 的构建中不会挂载 content feature 或注册 background handler；Chrome Translation provider 仍保留在通用 registry，但 UI 会过滤不可用项，发送到 Offscreen 前也会确定性拒绝。
- popup、options、文档翻译、视频服务和翻译中心过滤 Chrome-only 服务；跨浏览器同步留下的旧选择会保留为不可用项并提示切换，不会静默写回或破坏用户回到 Chrome 后的偏好。
- 能力契约在 Firefox 构建中保留 Edge TTS 合成与页面音频回退路径，不把“缺少 Offscreen 播放”直接等同于“语音服务不可用”；本轮未用真实 Firefox 验证该路径。

### 测试本身发现的回归

- Google provider 与全文可见性测试原来依赖其他测试留下的 browser mock；迁移后改为直接 mock 新模块边界，按 `functional` / `regression` 单独运行也能通过。
- userscript smoke、视频字幕与性能 runner 不再用最小化窗口冒充后台安全，统一强制 focus-safe helper、临时 profile 和正常尺寸屏幕外窗口。
- 一键 runner 接受 pnpm 原样传入的 `--` 分隔符；划词真实浏览器回归同步更新到当前自定义快捷键 dialog DOM，不再因旧 `.el-dialog` 定位器误报产品失败。
- 全文浏览器 runner 不再假定外部 `localhost:3000` 已启动：默认自建随机 loopback fixture，仅允许 `freeTranslation`，对非 loopback 网络 fail-closed，只为微软请求返回数量严格匹配的确定性结果，并要求路由实际命中；因此可以验证“翻译—恢复—再次翻译”、动态 DOM、Shadow DOM、富文本与 line-clamp，且真实 provider 响应不能冒充 fixture 通过。
- 全文浏览器 runner 将页面 `console.error` 与 `pageerror` 纳入失败条件和证据输出，不再只是把控制台错误附带记录后仍报告成功。
- userscript smoke 不再复用 focus-safe helper 启动后会关闭的临时页面，而是显式选择仍存活的测试页；对应页面选择策略已加入单测。
- userscript 构建 verifier 在最终产物阶段拒绝残留的自由 `browser` / `chrome` 标识符，防止源模块边界迁移后再次出现“构建通过、浏览器启动崩溃”的发布回归。
- 划词 runner 在 popup/content 切换时使用 focus-safe CDP 显式激活目标标签，并等待触发方式 UI 与持久化配置同时稳定，不再以固定 500ms 读回制造高负载竞态；selection/video runner 也会在结构化结果 `ok:false` 时返回非零退出码，完整流水线不能只凭子进程正常结束误判通过。
- 视频字幕 fixture 默认使用被路由拦截的离线 YouTube 形状页面，微软、OpenAI 与 timedtext 响应均为确定性模拟；其余 HTTP(S) 请求会记录、阻止并使测试失败，不再在未给 network gate 时访问真实 YouTube。
- 划词、全文和视频 runner 统一写入 `report.json`；全文额外保存恢复态截图，userscript 额外保存成功译文截图，避免仅靠终端 stdout 或错误分支画面解释状态序列。
- 产物 verifier 的递归读取不再把整段 JavaScript 字符串按字符 spread，避免大 bundle 触发调用栈溢出。
- 删除旧 `components/` 后，测试审计和验证归属不再依赖本地残留的空目录，clean clone 可以直接运行。

## 测试体系

### 分组

- `architecture`：目录、依赖方向、兼容层、WXT 边界、验证归属和回归脚本安全策略。
- `unit`：纯函数、parser、状态机、缓存、provider builder、handler 和 repository。
- `functional`：多个真实模块协作，仅替换浏览器、网络、存储和时间等外部边界。
- `regression`：为历史缺陷保存最小复现。

`tests/test-matrix.json` 要求每个测试文件且只能属于一个分组。`pnpm test:audit` 会拒绝漏归类、重复归类、重复测试名、`.only`、无理由 `.skip` 和覆盖率忽略指令。

### 覆盖率定义

覆盖率使用两道互补门禁：

1. `vitest.coverage.config.ts` 中的可执行 TypeScript 业务边界，statements、branches、functions、lines 必须同时为 100%。
2. 其余 WXT entrypoint、Vue、CSS、HTML、浏览器 runner、兼容 barrel 与浏览器 glue 必须在 verification ownership 审计中逐文件拥有构建、静态契约、功能或真实浏览器验证责任。

这不是用 ignore 或扩大 exclude 得到的数字；测试审计会直接拒绝 `v8 ignore` / `c8 ignore`。

### 一键回归

```bash
pnpm test:regression:all
```

默认执行确定性流水线：测试审计、WXT prepare、类型检查、严格覆盖率、四组测试、Chrome/Firefox 构建、extension manifest/runtime marker 校验、userscript 构建与产物校验、文档构建。`--browser` 才追加隔离真实浏览器 fixture；真实站点矩阵还必须同时传入 `--network --allow-network`。

## 最终验证记录

合并候选验证于 2026-08-25 10:56（Asia/Shanghai）启动，命令为 `pnpm test:regression:all -- --browser ...`，最终退出码为 0；证据目录为 `/private/tmp/fluentread-architecture-regression-merge-candidate-20260825`。

- 测试审计：126 个测试文件、1128 个静态 case；所有文件唯一归组，无 `.only`、无理由 `.skip`、重复测试名或覆盖率忽略指令。
- 严格覆盖率：89 个测试文件、1067 个实际展开测试全部通过；清单内可执行 TypeScript 业务模块的 statements / branches / functions / lines 均为 100%。该数字不代表 Vue、CSS、HTML、runner 或整个仓库的行覆盖率，这些文件由 verification ownership 审计、构建和浏览器验收负责。
- 分组测试：architecture 18 文件 / 159 测试，unit 70 / 779，functional 25 / 257，regression 13 / 155，全部通过。
- 类型与产物：`wxt prepare`、`pnpm compile`、Chrome MV3 构建、Firefox MV2 构建、双浏览器 manifest/runtime marker verifier、userscript 构建、1,918,388 字节 userscript verifier、VitePress 文档构建全部通过。
- 隔离 Edge 浏览器：划词触发、全文翻译、离线视频字幕、文档加载/预览与导出、隐私/凭据边界、userscript 冒烟六组均通过；统一记录 `macos-hidden-cdp`、`launchservices-no-foreground`、`background-screen-off-normal` 和 `windowState: normal`，未复用用户 profile、未最小化、未调用 `bringToFront()`。
- UI/DOM 证据：划词保存 29 个通过 case，覆盖 popup/options 配置持久化、延迟取消、图标/小点/直接/快捷键与冲突优先级；全文覆盖翻译—恢复—再次翻译、动态/Shadow DOM、富文本、按钮和 line-clamp，并记录 12 个确定性翻译文本项、`unexpectedNetworkRequests: []` 与 `consoleErrors: []`；视频记录 9 次模拟翻译请求、渐进字幕、预取、下载和时间轴追赶，且 `pageErrors`、`consoleErrors`、`unexpectedNetworkRequests` 均为空。
- 文档证据是 12 种格式的加载/预览，以及 PDF、EPUB、DOCX 双语导出，不代表调用真实翻译服务：8 张格式卡、12 个样例、75 个预览片段；PDF 为 35 片段、2 页连续纵向原译并排和 277,229 字节导出，EPUB 为 7 片段/2,373 字节，DOCX 为 12 片段/38,959 字节；popup 为 400×600、6 张功能卡且无横向溢出。
- 隐私证据覆盖闭合 Shadow DOM、6 个非可信事件不触发 dialog/扩展页/翻译请求/译文节点、只删除 3 个 FluentRead 旧缓存键并保留 2 个宿主页键，以及 options reload 下的 session/local 凭据切换和临时 profile 清理；未把它夸大为真实退出并重启 Edge 后的凭据恢复。
- 代表性截图：`selection-trigger/selection-custom.png`、`full-page-translation/full-page-restored.png`、`document-translation/document-pdf-reader.png`、`video-subtitle-fixture/video-subtitle-visible.png`、`privacy-boundary/credentials-session-restored.png`、`userscript-smoke/userscript-translated.png`；以上路径均相对于证据目录。截图只作视觉样本，状态序列以各目录的 `report.json` / `evidence.json` 为准。
- 视频 fixture 使用离线 YouTube 形状页面，翻译服务、AI 与 timedtext 均为确定性拦截；它不等同于真实 YouTube 播放/timedtext 链路或多站点、真实翻译服务网络矩阵。
- Firefox 真实浏览器：本轮未运行；只以 Firefox MV2 构建、manifest、能力契约和注入边界测试作为证据。
- 真实网络站点矩阵：本轮未运行，不能由本地 fixture、构建或单个 YouTube 页面外壳替代。
- 非阻断输出：Node 测试环境中的 PDF.js DOM/标准字体提示、Vite 大 chunk 提示均保留可见；相关 PDF 解析、版面预览和导出仍由单测、功能测试及真实浏览器 fixture 通过验证。

## 浏览器隔离策略

- 扩展 fixtures 只加载生产 `.output/chrome-mv3`；userscript smoke 只加载生产 `.output/userscript/fluent-read.user.js`。
- 使用 `/private/tmp` 下的临时 profile，不连接用户日常 Edge/Chrome profile。
- 使用 macOS hidden CDP + LaunchServices no-foreground 策略。
- 窗口保持正常尺寸并放到屏幕外；不最小化、不调用 `bringToFront()`。
- 报告保存 launch mode、focus policy、window placement、DOM 断言、控制台错误和截图路径。

已知非阻断项：Firefox 已禁用 Offscreen/OCR/图片/圈选运行时能力且不包含 Offscreen 页面或 chunk，但 `public/fluent-read-ocr` 的静态 WASM/worker 仍有 8,020,299 字节（7.649 MiB）进入 Firefox 包；这是后续包体优化债务，不影响本轮构建、manifest 与能力边界结论。

## 开源维护约束

- 新业务不得继续进入 `entrypoints/utils/`、巨型 entrypoint 或无语义的 `common.ts`。
- 复杂 feature 按需建立 `core/services/background/content/ui`，小能力可保持单文件，不创建空目录。
- 公共契约使用中文为主的 TSDoc；非平凡编排使用说明所有权和边界的 Step 注释。
- provider、浏览器、存储、DOM 与 Vue 分别留在既定层级，禁止跨层循环依赖。
- 每次新增 feature 都要登记唯一测试分组、严格覆盖或精确验证归属，并通过双浏览器构建。
