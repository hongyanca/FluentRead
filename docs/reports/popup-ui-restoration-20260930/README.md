# FluentRead Popup 恢复与 UI 逐项验收报告

后续调整：开源入口已移除红色描边，改为低强调的浅灰胶囊；最新效果见[追加复核](./footer-softening.md)。本页 31 张截图保留初次验收时的效果。

2026-10-01 追加窄版与三个快捷面板调整，保留悬停和圈选示意，开关优先、去除冗余卡片，允许必要的内部滚动。用户已重新授权合并 PR #726；[追加记录](./quick-panel-refinement.md#合并前最终复核)记录最新生产产物的后台 Chrome 专项通过结果和 33 张最终截图。本页“未上传”、340px 尺寸及旧划词卡片均为初次交付时的历史状态，不代表当前状态。

日期：2026-09-30。所有截图反馈及最后补充的两项调整均已实现，并完成相关交互、保存重开和真实浏览器视觉复核。默认弹窗为 **340 × 437px**：白底、浅灰控件、品牌粉主操作；站点区只保留两个开关，不再展示域名，翻译服务入口有明确的灰底边框。

本次为本地开发交付，未上传、创建 PR、合并或发布。没有改动用户日常浏览器或已安装扩展。

## 逐项结果

| 需求 | 实现与校验 | UI 证据 |
| --- | --- | --- |
| 恢复“翻译当前网页” | 主屏直接显示；真实内容脚本完成翻译、恢复、再次翻译。重开读取网页实际状态，失败不误显示成功。快捷键来自当前配置。 | [主屏](./popup-light.png)、[恢复状态](./popup-translated.png)、[真实译文](./page-translated.png) |
| 恢复“始终翻译此网站” | 保留开关，开启后自动翻译；关闭重开验证规则仍保存。 | [主屏](./popup-light.png)、[浏览器断言](./report.json) |
| 恢复“在此网站禁用扩展” | 保留独立开关；禁用后网页译文恢复、主翻译及局部按钮不可用；立即关闭重开后状态保持，重新启用生效。 | [站点禁用](./site-disabled.png) |
| 恢复局部选择按钮 | 与主翻译同排，直接开启真实网页区域点选；Popup 关闭后高亮区域，点击只翻译该段，其他区域保持原文。 | [局部选择](./section-picker.png) |
| “提供商”改为“翻译服务” | 主屏及抽屉标题改名，七种界面语言资源同步；内部 provider 协议名称不变。 | [主屏](./popup-light.png)、[英文](./services-english.png) |
| 翻译服务选择更直观 | 默认服务及九项功能分配卡片；点击进入独立选择面板，不再层叠下拉框。常用服务两列、更多服务可收起，支持服务/模型搜索、继承、独立覆盖及 AI 能力过滤。45 个可用服务、9 个功能分配逐项选择并检查存储。 | [概览](./services-overview.png)、[常用](./service-picker-common.png)、[更多当前项](./service-picker-more.png)、[模型搜索](./service-model-search.png) |
| 修复划词抽屉竖排挤压 | 说明与按钮上下排列，说明实际宽 270px；两种呈现方式并排，原有开关、单词本及完整设置入口保留。调整触发方式真实打开对应设置页。 | [划词抽屉](./selection-drawer.png)、[底部](./selection-drawer-bottom.png) |
| 修复“界面与弹窗”展示 | 皮肤预览和可编辑布局预览均横排服务图标，服务卡高 37px；同步主翻译、局部按钮及紧凑站点控制，390px 设置视口无横向溢出。 | [皮肤预览](./skin-preview.png)、[布局预览](./layout-preview.png)、[窄屏](./settings-layout-390.png) |
| 补上版本号 | 从扩展 manifest 读取 `v0.0.35`，不另造固定版本，也未因 UI 修改递增发布版本。 | [主屏](./popup-light.png) |
| 白底、灰色按钮及现有配色 | 默认浅色为白色画布，辅助控件浅灰底；主操作保留粉色。深色与用户选择的皮肤仍使用其语义配色。 | [浅色](./popup-light.png)、[深色](./popup-dark.png)、[海盐](./popup-ocean.png) |
| 删除“快捷功能”一行 | 只去掉标题，保留悬停、划词、图片及文档四张功能卡，以及原有隐藏和排序偏好。 | [主屏](./popup-light.png)、[布局预览](./layout-preview.png) |
| 咖啡旁恢复“赞赏” | 恢复图标加文字，点击显示已有赞赏弹窗；内容可在弹窗内滚动，不产生支付操作。 | [主屏](./popup-light.png)、[赞赏](./donation.png)、[赞赏底部](./donation-bottom.png) |
| 底部恢复开源胶囊 | 粉色描边、本地 GitHub 图标、“开源项目 ↗”文字。点击实际新建标签页到声明的 GitHub 项目地址；网络页面用导航夹具，不以此宣称 GitHub 在线可用。 | [主屏底部](./popup-light.png)、[浏览器断言](./report.json) |
| 不展示当前网站、压缩高度 | 删除可见“当前网站＋域名”行，只留两个开关；内部域名仍用于正确匹配规则。中文默认站点区高 38px。弹窗从同一夹具上一轮的 461.5px 降至 437px。 | [最终主屏](./popup-light.png) |
| 翻译服务入口加选择框 | 实际样式为 1px 边框、10px 圆角和 `rgb(247,248,251)` 灰底，补齐悬停、展开和键盘焦点状态。 | [最终主屏](./popup-light.png)、[布局预览](./layout-preview.png) |

## 验证范围与结果

### 真实浏览器专项

生产产物：`.output/chrome-mv3`。运行脚本：`scripts/testing/run-popup-actions-service-ui-test.cjs`。原始结果为本目录的 [report.json](./report.json)，`ok: true`。

- 45 个当前浏览器可用的服务选项全部点击并验证保存；九项功能分配全部验证。选择服务不发送翻译请求。
- 覆盖默认继承、独立服务、默认服务变更不覆盖独立选择、自定义模型搜索、无结果、AI 专用能力过滤、当前服务在更多列表中自动可见、本地图标、方向键/Home，以及第一次 Escape 返回、第二次 Escape 关闭、点击遮罩关闭。
- 全文翻译—重开状态—恢复—再次翻译—恢复使用真实 content 消息及真实网页 DOM；局部点选使用真实选择器和鼠标事件。翻译服务是本机确定性 OpenAI 兼容端点。
- 全文失败、禁用、空响应、无 content receiver 的提示与非成功状态，使用四种明确标注的消息响应夹具；并非四种真实外部服务故障。
- 站点规则、服务连续两次修改和划词呈现方式覆盖立即关闭重开；`quickClose`、`latestWriteWins`、`crossPageSync` 均为 `true`。Options 读取到 Popup 最后保存的默认服务。
- 版本、赞赏、去掉标题、站点控件、服务边框、footer、重复 ID、浅深色、多种皮肤和窄屏预览均有断言。页面及后台控制台错误为 **0**。

测试使用独立临时 Edge profile，第二屏正常尺寸可见窗口，没有操作用户当前页面。报告记录：`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`，前后前台应用保持 ChatGPT。测试 profile 和浏览器已由脚本清理。

普通测试页代替工具栏浮层时，仅控制 active-tab 查询，使其返回真实本地网页标签；不能将此写成系统工具栏点击或系统级快捷键验证。

### 布局指标

| 状态 | 实际宽 × 高（CSS px） | 复核 |
| --- | --- | --- |
| 默认浅色 / 深色 | 340 × 437 | footer 完整，无横向溢出 |
| 简洁 | 330 × 428 | 紧凑站点行，辅助色保留 |
| 紧凑 | 320 × 390 | 主操作和开源文字完整 |
| 海盐 | 340 × 437 | 保留皮肤背景、蓝色主操作 |
| 英文 | 340 × 486.875 | 站点按钮允许换行；长主操作文案省略显示，完整 title 保留；控件及 footer 无裁切 |
| 暂停 | 340 × 450 | 保留版本和暂停说明，翻译控件禁用 |

长服务概览与划词设置使用抽屉内部纵向滚动，不强行缩小所有文字。服务选择列表根据可用高度收敛，搜索与返回区域保持清楚，当前选中项必须位于列表和 Popup 可见范围内。浅色主屏白色背景实测为 `rgb(255,255,255)`。

### 针对性测试与构建

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| Popup、可见性、皮肤、功能服务、目录、缓存六文件 | 56/56 通过 | [测试](./fluentread-popup-actions-final-tests.log) |
| 配置、消息、站点及设置架构六文件 | 245/246 通过，1 个基线失败 | [测试](./fluentread-popup-actions-persistence-tests.log) |
| i18n 契约与扫描 | 48/52 通过，4 个基线失败 | [测试](./fluentread-popup-actions-final-i18n.log) |
| Userscript 语言加载、缓存和 CDN 回退 | 3/3 通过，模拟 GM 网络 | [测试](./fluentread-popup-actions-final-language-bundles.log) |
| `pnpm compile` | 通过 | [类型检查](./fluentread-popup-actions-final-compile.log) |
| `pnpm build` | Chrome MV3 生产构建通过 | [构建](./fluentread-popup-actions-final-build.log) |
| `pnpm build:firefox` | Firefox MV2 生产构建通过，未运行 Firefox UI | [构建](./fluentread-popup-actions-final-firefox-build.log) |
| `pnpm build:userscript` / 产物验证 | 通过 | [构建](./fluentread-popup-actions-final-userscript-build.log)、[验证](./fluentread-popup-actions-final-userscript-verify.log) |
| `pnpm docs:build` | 通过 | [构建](./fluentread-popup-actions-final-docs-build.log) |
| `pnpm test:audit` | 411 文件、5311 用例的目录登记检查通过；不是执行全量用例 | [登记检查](./fluentread-popup-actions-final-audit.log) |
| `git diff --check` | 通过 | 本地交付前检查 |

共执行上述 **14 个相关测试文件，357 个用例，352 通过、5 个基线失败**；没有运行全量回归。

归档日志只清除终端颜色转义和行尾空白，测试结果及错误内容不变；截图未编辑。

构建复用已核对的主检出现有依赖，不是全新安装依赖的验证；任务中的临时 `node_modules` 链接在完成验证后移除，主检出的依赖未移除。

### 五个基线失败

在准确基础提交 `6f6e29691dec46ad110e8e859c2ac0ce03996d80` 的独立、无源文件修改 worktree 中重跑，复现以下失败：

1. i18n 旧界面提示仍引用已经变化的快捷入口描述。
2. i18n 扫描缺少图片/OCR 设置导航的 15 个既有本地化项。
3. 运行期反馈资源登记的旧邮件文案已不在源码中。
4. 旧人工校正文案登记中有已移除的界面原文。
5. 配置差异预览测试仍期待旧 Popup 栏目/card ID。

本次 i18n 剩余缺项未增加；恢复主操作错误提示还使两组旧文案缺项分别减少一项。没有通过跳过测试、放宽断言或扩大任务到其他设置模块来消除基线失败。证据：[基线 i18n](./fluentread-popup-actions-baseline-i18n.log)、[基线配置差异](./fluentread-popup-actions-baseline-config-diff.log)。用于比对的准确临时 worktree 已清理。

### Userscript 资源边界

七语言文案修改已同步生成五份带内容哈希的非英语资源。资源保存在本地提交 `b36776a58277fb6c7b53340618711485402eeecb`，`userscriptLanguageResourceCommit` 指向该提交，避免继续引用没有新文件的旧提交。

**该提交尚未上传，因此没有宣称 CDN 上已经可取到新资源。** 本次验证为生成资源、构建和模拟加载；后续若要发布 Userscript，必须先上传包含该资源提交的分支，再验证固定提交的真实资源 URL。扩展产物内的界面语言不依赖此次 CDN 上传。

## 31 张截图逐一视觉复核

全部截图均来自最终同一生产扩展产物，没有修图或静态替代页面。最终补充轮中 25 张与已逐张查看的上一轮截图 SHA-256 完全相同；另 2 张变化截图和 4 张新增截图也重新查看。

| 截图 | 复核结论 |
| --- | --- |
| [popup-light](./popup-light.png) | 白底、灰色服务选择框、主操作、两个站点开关、四卡、版本、赞赏及开源胶囊齐全 |
| [donation](./donation.png) | 恢复文字后的赞赏弹窗入口正确，二维码与现有品牌样式保留 |
| [donation-bottom](./donation-bottom.png) | 内部滚动后 Ko-fi 内容可见；不是支付验证 |
| [page-translated](./page-translated.png) | 真实网页出现双语译文，未选择区域保持原文 |
| [popup-translated](./popup-translated.png) | 主按钮明确显示“恢复当前网页” |
| [section-picker](./section-picker.png) | 品牌粉区域高亮和退出提示可见，未污染其他页面内容 |
| [site-disabled](./site-disabled.png) | 站点禁用标记及不可用主操作清楚，无可见域名 |
| [services-overview](./services-overview.png) | 默认与功能分配层级清楚，卡片选择代替多重下拉 |
| [services-overview-bottom](./services-overview-bottom.png) | 其余功能、AI 精翻和连接入口可滚动到达 |
| [service-picker-common](./service-picker-common.png) | 常用项两列、品牌图标与当前勾选清楚 |
| [service-model-search](./service-model-search.png) | 搜索模型后展示对应服务及模型命中，支持返回 |
| [service-picker-more](./service-picker-more.png) | 更多列表滚动后当前服务完整可见，选择状态明确 |
| [services-reopened](./services-reopened.png) | 重开后的悬停谷歌与划词微软独立选择仍在 |
| [selection-drawer](./selection-drawer.png) | 说明横排、动作在下方，呈现方式并排，无单字竖排 |
| [selection-drawer-bottom](./selection-drawer-bottom.png) | 单词本和完整设置入口保留，内部滚动可达 |
| [selection-reopened](./selection-reopened.png) | 普通翻译选中状态重开后保持 |
| [settings-interface](./settings-interface.png) | 左侧皮肤实时预览没有巨大的竖排服务区域 |
| [skin-preview](./skin-preview.png) | 两个服务图标横排，服务卡 37px，主操作不被挤压 |
| [layout-preview](./layout-preview.png) | 预览同步紧凑站点开关，无域名，保留布局编辑手柄 |
| [settings-layout-390](./settings-layout-390.png) | 可编辑预览在 390px 设置视口内，无横向溢出 |
| [popup-dark](./popup-dark.png) | 深色文字、灰色控件及品牌操作保持可辨认 |
| [selection-dark](./selection-dark.png) | 深色说明、按钮和选中状态层次清楚 |
| [services-dark](./services-dark.png) | 深色默认与功能卡配色统一，本地图标清楚 |
| [popup-minimal](./popup-minimal.png) | 保留简洁皮肤，两个站点控件不被旧域名宽度规则挤压 |
| [service-picker-minimal](./service-picker-minimal.png) | 简洁皮肤下搜索、返回和当前服务可用且无横向溢出 |
| [popup-compact](./popup-compact.png) | 320px 宽、390px 高，主操作和底部胶囊未裁切 |
| [popup-ocean](./popup-ocean.png) | 海盐背景和蓝色强调保留，不强制改成粉色默认皮肤 |
| [popup-english](./popup-english.png) | 英文长文案受控省略/换行，服务标题、站点控件和 footer 不重叠 |
| [services-english](./services-english.png) | 改名本地化正确，英文分配卡可读，长服务名受控省略 |
| [popup-paused](./popup-paused.png) | 版本和暂停状态齐全，操作禁用视觉明确 |
| [options-cross-page](./options-cross-page.png) | 设置页读取 Popup 保存后的默认微软服务及独立选择 |

## 实现边界与交付位置

工作目录：`/Users/thinkstu/Desktop/copy/FluentRead-popup-actions-service-ui-20260930`。分支：`codex/popup-actions-service-ui-20260930`。基础为 `origin/main` 的 `6f6e2969`。

修改集中于 Popup、两个设置预览、界面配色默认值、语言资源、相关测试及文档。保留 WXT / Vue / TypeScript、配置持久化服务、功能分配能力边界、用户自定义模型与皮肤/布局偏好。本次未读取借鉴或修改 `read-frog/`、`kiss-translator/`，也没有跨仓库依赖。

真实外部翻译服务、其他任意网站、Firefox 实机 UI、系统级快捷键、商店更新及远程 Userscript 资源发布不在本次已证明范围。任务 worktree 和本地提交保留，主工作目录未用于实现修改。
