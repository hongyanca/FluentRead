# 输入框翻译支持富文本编辑器（Issue #655）

[Issue #655](https://github.com/FluentRead/FluentRead/issues/655) 反馈输入框翻译只支持普通文本框，社交平台、聊天工具和邮件里常见的富文本编辑框无法翻译。此前为了避免整段改写 `innerText` 删除链接、@提及等结构并被编辑器回滚，contenteditable 只接受 `plaintext-only`，且三连触发只对 input/textarea 生效。

## 行为

| 场景 | 处理 |
| --- | --- |
| 参与翻译 | 文本类 input、textarea，以及 `contenteditable="true"`/`""`/`plaintext-only` 编辑宿主（含 Quill、ProseMirror/Tiptap、Lexical、Slate、Draft.js 等富文本编辑器） |
| 不参与 | 密码框、disabled/readonly、`aria-readonly`/`aria-disabled`、CodeMirror/Monaco/Ace 等代码编辑器 |
| 三连触发 | 原生控件沿用 value 与选区校验；编辑宿主按 textContent 口径的文本和折叠光标偏移，校验每次按键恰好在光标处插入一个触发符，其他编辑、光标移动或切换目标都会重新计数 |
| 原文 | 编辑宿主在第一次插入触发符前冻结可见文本（保留块级换行），剔除零宽占位、统一不换行空格，Slate 空编辑器的占位提示不会当作原文 |
| 写回 | 选中编辑宿主全文 → 等待 `selectionchange` 让编辑器同步模型选区 → 派发只含纯文本的合成粘贴，由编辑器按自身模型插入；未被接管或被页面拦截且内容未变时，再次确认请求与选区后使用原生 `insertText` |
| 恢复原文 | 走同一写回路径恢复原来的文字；链接、@提及、粗体等格式可用编辑器的撤销找回 |
| 写入失败 | 显示“无法把译文写入当前编辑器”，不改动内容 |
| 快捷键 | 被消费的 Ctrl+Enter、第三次触发键和取消用的 Esc 不再传给页面，避免聊天/评论编辑器把 Ctrl+Enter 当作发送 |

请求所有权、编辑版本、配置版本和 Esc 取消的保护与原生控件一致：选区同步等待期间只要请求失效或用户改动了选区，就不写入。

## 参考与取舍

kiss-translator 对富文本编辑器先尝试合成粘贴、再退回 `insertText`，并用固定延时后比较文本判断是否成功；read-frog 在页面世界中通过 React fiber 直接调用 Slate/Draft.js 内部 API。FluentRead 借鉴“让编辑器自己处理粘贴”的思路，用自身架构独立实现：不注入页面世界脚本、不访问框架内部；改为在粘贴前等待 `selectionchange`（Draft.js、Lexical、Slate 都在此事件后才同步模型选区，否则整段粘贴会插到旧光标处造成重复），并以粘贴事件是否被 `preventDefault` 及 DOM 是否变化判断接管结果。

## 验证

真实浏览器均使用生产 Chrome MV3 产物、临时 Edge profile、第二屏正常尺寸后台窗口（`macos-background-cdp`、`launchservices-no-foreground`、`background-visible-no-focus`，`browserFrontmost=false`），翻译服务响应为本地确定性夹具。[结构化证据](./browser-evidence.json)保留用例、模型驱动编辑器写入日志和真实编辑器模型文本。

| 检查 | 结果 |
| --- | --- |
| 输入框浏览器专项 `run-input-translation-test.cjs` | 16/16 通过，页面运行时错误为零；新增原生富文本（撤销恢复粗体）、模型驱动编辑器（写入日志为选区同步后的整段粘贴 `0→10`，恢复原文 `0→31`）、plaintext-only 三连、密码框与代码编辑器排除、Ctrl+Enter 不再传给页面 |
| 真实编辑器 `run-rich-text-input-editors-test.cjs` | Quill 2.0.3、ProseMirror、Lexical 0.28、Slate 0.112、Draft.js 0.11.7 共 5/5：编辑器自身模型只含译文、每次一个请求、原文不含触发符、恢复原文成功 |
| 输入框单元测试 | `inputBox`、`inputEditableHost`、`inputTranslationContentFeature` 共 85 项通过 |
| 严格覆盖率，单 worker | 304 文件、6825 测试通过；statements/branches/functions/lines 均为 100%（含新增 `editableHost.ts`） |
| 完整 Vitest，单 worker | 375 文件、8208 测试全部通过（基于 main 82287e85） |
| 类型检查与测试审计 | `pnpm compile`、`pnpm test:audit` 通过 |
| Chrome MV3、Firefox MV2、Userscript | 三种生产构建通过，userscript verifier 通过 |
| 文档 | `pnpm docs:build` 通过 |

输入框浏览器专项的设置页部分在 `origin/main` 上已与设置页重构脱节（与本次改动无关，已单独跟进）；本次运行在该部分使用了四处本地夹具调整（自定义模型夹具、等待自动保存、记录而非断言 420px 卡片高度预算、页面用例前设置 `input-test-model`），富文本用例与提交版本一致。Firefox 与用户脚本只做构建验证，Edge 结果不代表其运行时表现；真实编辑器来自公开 CDN，不代表具体网站的定制编辑器。

截图：[原生富文本编辑区翻译成功](./native-rich-editor.png) · [真实编辑器（Draft.js 翻译后，其余已恢复原文）](./real-editors.png)
