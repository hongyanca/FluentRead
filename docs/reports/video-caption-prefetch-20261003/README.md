# 已有字幕的预翻译与同步显示

2026-10-03；基线提交 `f81adc90`。改动位于 FluentRead 独立工作树，未借鉴或修改参考仓库。

## 原因与改动

原实现已有机器翻译 10 秒、AI 服务 30 秒的预取窗口，但最多八个条目的限制在原文去重之前计算；重复的原生条目和刚结束的字幕会占用名额，下一条不同原文可能直到显示时才开始翻译。原生轨道就绪也主要依赖每秒轮询。已缓存译文仍通过异步回调显示，DOM 会先出现只有原文的更新。

现在优先当前句，按播放时间预取最多八条不同的后续原文；过期条目、重复原文不占后续名额，倍速播放按实际速度扩大窗口。轨道加入、加载、换句以及播放、跳转完成和倍速变化会及时启动预取。跳转后移除尚未开始的旧窗口预取，保留在途请求；取消预取不进入失败退避。已有缓存在同一次字幕更新中同步显示两行，也跳过无匹配时间轴时的文字稳定等待。预取仍最多占两路，总在途任务最多三路，当前句可使用保留的处理机会。

原生轨道监听与预取计时器集中在 `pretranslationController.ts`，更换视频、关闭和卸载继续恢复原生字幕并清理资源。字幕运行时文件为 1886 行，符合原有 1887 行上限。

## 修复前后实测

使用生产 Chrome MV3 扩展、真实视频元素、受控 YouTube/X 字幕轨道与固定 **500ms** 翻译响应。两行间隔以 MutationObserver 捕获的首次对应原文/译文更新计算，不是在线翻译服务或显示器刷新率的测量。

| 检查 | 修复前 | 修复后 |
| --- | ---: | ---: |
| X 重复原生条目后的下一句：原文与译文首次更新间隔 | 510.2ms | 0ms，同一次更新 |
| 新原生轨道加入至预取请求发出 | 1060ms | 6ms |
| YouTube 已预取字幕首次更新间隔 | 1.1ms | 0ms，同一次更新 |
| 倍速扩大预取窗口、跳转清理旧等待队列 | 未单独测量 | 通过 |
| 无匹配时间轴的缓存字幕回放跳过稳定等待 | 未单独测量 | 通过 |

修复前的专项 6 项中有 4 项失败；修复后的扩展专项增加倍速、跳转和无时间轴回放检查，共 **10 项通过**。[修复前 JSON](./before.json)、[修复后 JSON](./after.json) 保留请求与更新记录。[截图](./native-prefetched-bilingual.png) 为受控原生字幕场景。

所有浏览器检查使用临时 profile、第二屏正常可见后台窗口；`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`。未接入用户日常 profile。

## 验证范围

- 14 个字幕、缓存、调度、来源、解析、语言、下载、播放器和外观相关测试文件，**170 个用例通过**；见 [相关测试](./related-tests.txt)。
- 四个改动逻辑模块 `subtitleLogic.ts`、`translationScheduler.ts`、`translationCache.ts`、`pretranslationController.ts` 的 statements、branches、functions、lines 均为 **100%**；39 个覆盖率用例通过，见 [覆盖率](./coverage.txt)。
- 原有 YouTube 专项 **29 项通过**：换句、迟到响应、滚动字幕、时间空档、全屏、校时、播放、缓存回放和关闭；见 [YouTube 报告](./youtube-regression.json)。
- 原有 X 专项 **20 项通过**：播放器挂载、原生与缓存来源、显示模式、200 条缓存时间轴、失败重试、下载、校时、原生空档及隐藏后恢复；见 [X 报告](./x-regression.json)。
- TypeScript/Vue 类型检查、Chrome/Firefox 生产构建、文档构建和测试审计通过。仅 Chrome/Edge 执行真实浏览器夹具，Firefox 为构建验证。
- 源码头注释与新增文件长度门禁通过。架构套件有三项已有失败，在干净基线 `f81adc90` 上复现同样问题：文档 UI 引入服务层错误模块、`verify-brand-copy.mjs` 缺少验证归属，以及 share-card 等八个既有模块未纳入覆盖率清单。见 [基线日志](./architecture-baseline.txt) 与 [改动后日志](./architecture-after.txt)。本次新增模块已纳入覆盖率清单和测试矩阵。

未运行全量回归。没有用户所示视频的链接或账号上下文，未验证该真实视频与在线服务的组合。首次播放、跳到未预取位置、站点仅提供当前字幕文字或供应商持续慢于播放速度时，仍可能先显示原文；不暂停视频或隐藏原文等待服务。

## 重跑

在该 FluentRead 工作树运行生产构建后，使用工作区依赖工具取得 Node 包目录，再执行：

```sh
node scripts/run-video-caption-prefetch-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <Node包目录> \
  --focus-safe-helper <fluentread-browser-translation-test/scripts/focus-safe-browser.cjs路径> \
  --artifacts-dir /private/tmp/fluentread-caption-prefetch
```

运行器需要 macOS、Microsoft Edge、ffmpeg 和 Playwright，翻译为固定延迟的模拟响应。
