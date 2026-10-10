# 翻译核心行为契约与测试定位

本文记录网页翻译在发现、分段、选取、动态更新和恢复阶段的预期行为。对应修复的验证范围、结果与证据限制见 [核心审查结果](./README.md)。

## 发现与选取

正文范围只决定进入哪些区域；段落候选决定哪些节点共同翻译。范围容器继续遍历后代，显式原子目标遵循用户设置。

| 行为 | 实现与验收位置 |
| --- | --- |
| 列表、引用、定义项、图注和表格按内部内容单元分段 | 站点适配规则、`translationGitHubTaskList.test.ts` |
| 连续文本、链接、强调与代码保留同一叶段落的语义 | `translationCore.test.ts`、`translationOwnershipBoundaries.test.ts` |
| 透明包裹层不能吞并内部独立段落，直接引导文字可单独选取 | `engine.ts`、`translationOwnershipBoundaries.test.ts` |
| 全文与悬浮共享候选边界，支持先发现后命中及动态变化 | `TranslationCandidateCore`、`translationOwnershipBoundaries.test.ts` |
| 坐标命中、视觉文本范围和划词入口分别遵循对应选取规则 | `dom.ts`、`visual.ts`、`selectionTranslatorCore.test.ts` |
| 悬浮后代探测保持 256 步上限，预算不足时不选取整个未知容器 | `engine.ts`、所有权专项中的 300 层深树用例 |
| 显式换行按站点规则拆分，同时保留宿主 BR、空白及原节点 | `lineBreak.ts`、`pageTranslationAdvanced.test.ts` |

## 快照与渲染

保持原文、跳过翻译和从展示副本省略是三种不同语义。请求槽与最终 DOM 均需验证，避免原本隐藏的内容在净化后重新显示。

| 行为 | 实现与验收位置 |
| --- | --- |
| 可见代码、禁译术语和公式保持原文 | `serialization.ts`、`renderer.ts`、`translationCore.test.ts` |
| 隐藏说明、编辑内容、非展示节点及辅助内容不进入译文副本 | `translationSnapshotProtection.test.ts` |
| 视觉隐藏要求微小定位盒、溢出裁剪和零面积剪裁同时满足 | `dom.ts`、`translationVisualProtection.test.ts` |
| 普通裁切卡片不因单独的 overflow 或 clip 被跳过 | `translationVisualProtection.test.ts` 的反例 |
| 请求返回后复验完整来源集合、身份与顺序；物化拒绝不连续、逆序或重复节点 | `translationStability.ts`、`renderer.ts`、`syntheticCandidateFreshness.test.ts` |
| 供应商不能借助非法或重复标记改变来源槽边界 | `translationPrompts.test.ts`、`translationCore.test.ts` |
| 控件、字体、长段落与截断布局遵循各自的渲染约束 | `translationControlOwnership.test.ts`、`translationFont.test.ts`、`translationTruncation.test.ts` |

## 动态更新与恢复

增量发现按 8ms 扫描预算让出执行；队列优先处理可见内容，保留在途请求。动态根合并、来源复验与 generation 共同隔离过期结果。

| 行为 | 实现与验收位置 |
| --- | --- |
| 合并重叠变化根，持续发现新正文，避免自身写入反复触发请求 | `runtime.ts`、`mutationObservation.ts`、`fullPageVisibilityScheduling.test.ts` |
| 可见性变化、开放 Shadow DOM、来源删除和重挂得到正确处理 | `fullPageVisibilityScheduling.test.ts`、`translationCore.test.ts`、`bilingualRemount.test.ts` |
| 恢复前取消请求、观察器、计时器与发现任务，迟到响应不能再次写入 | `requestSession.ts`、`runtime.ts`、`translationStability.test.ts` |
| 恢复不覆盖宿主新值，也不复活已经替换的旧段落 | `translationSnapshotProtection.test.ts` 的用户值、可见性和 hydration 功能用例 |
| 双语与仅译文模式保护原生节点身份、事件和控件状态 | `translationState.test.ts`、`bilingualReplay.test.ts`、仅译文与按钮浏览器专项 |
| 恢复后可再次翻译，且没有重复或嵌套工件 | 任务清单、嵌套列表和重挂浏览器专项 |

测试定位说明具体行为的验收入口，不代表每种页面组合均已在真实浏览器运行。浏览器与确定性测试的实际执行范围以对应报告为准。
