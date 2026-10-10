# 窄版 Popup 与快捷面板追加记录

日期：2026-10-01。用户已重新授权合并 PR #726，窄版与快捷面板源码已上传。下文的部分验收及“尚未上传”说明保留上一个检查点的历史；最新结果见[合并前最终复核](#合并前最终复核)。

## 当前实现

- 默认 Popup 320px，简洁 310px，紧凑 300px；其他皮肤同样收窄 20px。语言框去掉搜索装饰，筛选与键盘选择保留，完整标签通过 title 可读；其他设置页默认仍显示搜索图标。
- 三个快捷面板首先显示真正的开关，随后展示关键偏好。悬停保留“指针＋黑色快捷键＝即时翻译”；圈选保留实际键帽＋圈选图形＝翻译选中区域，支持自定义组合键和平台名称。
- 划词不再重复触发方式卡片、单词本卡片或无用操作示意；保留双语/仅译文及普通/卡片呈现。底部统一为低强调的“更多设置”，指向各自完整设置。
- 悬停关闭再启用恢复原预设或自定义快捷键，冲突时保持关闭并提示；独立额外方案不会被重置。划词关闭再启用恢复关闭前的显示模式，触发方式、卡片偏好和词书配置保持。
- 不再强制零滚动：常用内容优先可见，长文案和额外方案在内部自然滚动。最后根据截图给滚动条预留稳定的窄槽，避免关闭按钮被覆盖；**这一最后的 CSS 调整尚待真实浏览器重新复核**。
- 之前恢复的网页翻译/恢复、局部选择、站点开关、版本、赞赏、翻译服务选择框、白底灰色辅助控件和柔和开源入口均保留。不修改发布版本或用户已安装扩展。

## 已验证与未完成边界

7 个直接影响的测试文件共 **263/263 通过**：Popup actions、Popup 可见性、皮肤、配置存储、后台持久化及两份快捷方案测试。新恢复字段覆盖旧配置、JSON 保存重开、全部预设/手势、自定义快捷键、非法字段和冲突，不改变独立方案。额外的 Userscript 语言加载 **3/3 通过**，使用模拟 GM 网络。

类型检查，Chrome MV3、Firefox MV2、Userscript 生产构建及 Userscript verifier 通过。Firefox 构建不代表 Firefox 实机。测试目录登记为 411 文件、5317 用例，检查通过；不是执行全量回归。

实际日志：[263 项测试](./quick-panel-review/tests.txt)、[类型检查](./quick-panel-review/compile.txt)、[Chrome](./quick-panel-review/chrome.txt)、[Firefox](./quick-panel-review/firefox.txt)、[Userscript 构建](./quick-panel-review/userscript.txt)、[产物验证](./quick-panel-review/userscript-verify.txt)、[i18n 与模拟语言加载](./quick-panel-review/i18n.txt)、[目录登记](./quick-panel-review/audit.txt)、[文档构建](./quick-panel-review/docs.txt)。日志仅清除终端颜色转义与行尾空白，截图不编辑。

i18n 契约 **48/52 通过**，仍是原先四个基线失败：旧快捷入口提示、图片/OCR 导航 15 个既有本地化项、旧邮件反馈登记、其余过期人工校正文案。随本次去掉的五条旧卡片文案同步移除对应人工校正登记，没有增加缺项；恢复圈选示意还减少一条过期登记。保留错误日志，不跳过测试。

### 实际浏览器中已经完成的部分

生产扩展的后台隔离 Edge 曾完成六种主屏及每种三个快捷面板的布局矩阵：浅色、深色、简洁、紧凑、海盐、英文，共 24 张截图。还完成语言框无图标但可搜索，其他设置页仍有搜索图标；默认悬停 Control 关闭/重开/再启用，以及自定义快捷键与八个独立方案保持不变的短生命周期保存，共两组持久化断言。

主屏实测分别为：320×437、310×428、300×390，英文默认 320×497.875 CSS px，无横向溢出。默认三个面板滚动体分别为 252/252、316/316、326/326（clientHeight/scrollHeight），都不需滚动；八个额外方案为 360/445，内部滚动 85px，所有按钮可通过聚焦进入可见范围。

这一轮在后续划词开关关闭重开时触发焦点保护，报告整体 **ok=false**，不称完整专项通过。随后两轮均在启动页签阶段再次触发保护；已停止并清理所有本次临时实例及 profile。尝试避免重复窗口定位无效，未保留该绕过方式；保护检查未关闭。

29 张已生成截图全部逐张查看，证明上述操作示意、开关、颜色和布局确实来自生产扩展。快照为最后预留滚动槽之前的布局，不能替代最后样式复核。原始结果和截图位于本目录 `quick-panel-review/`。

可阅览：[自动检测主屏](./quick-panel-review/density-popup-auto.png)、[悬停开关及示意](./quick-panel-review/density-hover-light.png)、[划词主要选项](./quick-panel-review/density-selection-light.png)、[图片及圈选示意](./quick-panel-review/density-image-light.png)、[较多悬停方案](./quick-panel-review/density-hover-profiles.png)。未通过的完整浏览器报告见 [partial-browser-report.json](./quick-panel-review/partial-browser-report.json)，后两轮停止记录见 [focus-stop-6](./quick-panel-review/focus-stop-6.json)、[focus-stop-7](./quick-panel-review/focus-stop-7.json)。

仍待完成：划词总开关关闭/重开恢复、两个图片开关独立快速保存、自定义圈选键帽、三个“更多设置”的完整导航矩阵，以及最后滚动槽样式。相关单元测试已通过，但不将其等同于浏览器证据。已请求用户是否允许一次临时前台验证，未获准前不再启动浏览器。

### 资源与交付

最新五个非英语语言文件已生成并保存于本地资源提交 `782c629f6586fe43ed58e58add794eac630afaca`，Userscript 固定到这个提交。提交目前尚未上传，**未证明真实 CDN 可取得这一轮的新文件**；之前资源提交 b36776a 的真实 CDN 验证不等同于本轮新资源可用。

主检出 `/Users/thinkstu/Desktop/copy/FluentRead` 仍干净且未用于实现。任务位于 `/Users/thinkstu/Desktop/copy/FluentRead-popup-actions-service-ui-20260930`，临时依赖链接仅用于复用已有依赖，不是全新安装证明。未修改或借鉴两个参考仓库。

## 合并前最终复核

用户重新提出“合并”后，没有将其当作前台测试授权。继续使用第二屏正常尺寸的后台隔离浏览器，焦点保护与持续前台 PID 监控保持开启；不操作用户日常浏览器、配置或已安装扩展。

Edge 后台焦点问题没有绕过。替代 Chrome 的前几轮检查失败，分别暴露旧命令行加载失效、未载入目标 worker、混用旧加载参数导致页面被拦截、测试 active-tab 夹具只支持 callback，以及自定义快捷键种子未采用配置的规范 `Ctrl` 写法。失败记录保留于 `merge-validation/`，不能称这些失败轮次为通过。修正测试加载与夹具，不改变产品查询或快捷键归一化规则。

最终生产产物 `.output/chrome-mv3` 使用独立临时 Chrome 154 profile，通过 `Extensions.loadUnpacked` 返回的准确 ID 载入并核对清单，运行 `--density-only` 专项。结果 [report.json](./merge-validation/report.json) 为 **ok=true**：

- 六种主屏及各自三个快捷面板全部通过：浅色、深色、简洁、紧凑、海盐、英文；宽度仍为 320/310/300px，主屏高度 437/428/390px，英文默认 497.875px，无横向溢出或 footer 裁切。
- 默认三个快捷面板滚动体为 268/268、316/316、326/326，常用中文内容无滚动。八个额外悬停方案为 360/458，允许内部滚动 98px，并验证所有按钮通过键盘聚焦进入可见范围。
- 实际截图发现 macOS 覆盖式滚动条不为 `scrollbar-gutter: stable` 预留空间，因此补充 8px 右侧安全留白。每种面板的关闭按钮距滚动体右沿至少 8px；实测与截图均复核，不隐藏滚动条或裁切内容。
- 语言框无搜索装饰但仍能筛选，其他设置页保留图标；默认悬停关闭重开恢复 Control，自定义快捷键与八个独立方案保持；划词两次模式写入、关闭重开恢复仅译文及呈现偏好；两个图片开关立即关闭重开后独立保存。
- 圈选示意保留实际 Shift/Z 或自定义 Control/Option/Shift/L 键帽与圈选图形。悬停、划词、图片三个“更多设置”真实导航到对应完整设置页面。
- `quickClose=true`、`latestWriteWins=true`，四组持久化断言通过；本专项没有执行完整跨页配置同步矩阵，`crossPageSync=false` 不能理解成同步失败或通过证明。
- 页面及 worker 控制台错误 **0**。`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`，61 次前台采样无违规；实例及临时 profile 由脚本清理。

最终 **33 张截图已全部逐张查看**，未编辑图片。主要画面：[窄版自动检测主屏](./merge-validation/density-popup-auto.png)、[悬停开关与示意](./merge-validation/density-hover-light.png)、[划词关键偏好](./merge-validation/density-selection-light.png)、[图片与圈选示意](./merge-validation/density-image-light.png)、[多方案滚动与关闭按钮](./merge-validation/density-hover-profiles.png)、[自定义圈选示意](./merge-validation/density-image-custom-hotkey.png)。

最后 8px 样式改动后再次执行七个相关测试文件，**263/263 通过**；类型检查、Chrome MV3、Firefox MV2 生产构建及文档构建通过。日志：[针对性测试](./merge-validation/tests.txt)、[类型检查](./merge-validation/compile.txt)、[Chrome](./merge-validation/chrome.txt)、[Firefox](./merge-validation/firefox.txt)、[浏览器专项](./merge-validation/browser.txt)、[文档](./merge-validation/docs.txt)。前述 Userscript 构建、模拟语言加载、目录登记及四个既有 i18n 基线失败的边界不变；没有运行全量回归、Firefox 实机、真实外部翻译服务或商店发布验收。

资源提交 `782c629f6586fe43ed58e58add794eac630afaca` 已上传并保留在分支历史。五个固定提交的真实 jsDelivr 语言 URL 均下载成功、逐字节匹配本地文件；资源文件与当前产品提交一致。文件名、固定 URL 前缀与 SHA-256 见 [cdn-resources.json](./merge-validation/cdn-resources.json)。这不代表浏览器已安装产物更新，也没有修改发布版本。
