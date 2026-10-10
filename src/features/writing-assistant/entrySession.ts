/**
 * @file src/features/writing-assistant/entrySession.ts
 * 文件职责：维护当前文档访问内写作入口的临时关闭状态。
 * 主要内容：关闭仅保存在内容脚本内存中，暂停后重新挂载仍保持关闭；保存失败提示跨乐观卸载恢复，刷新或再次加载文档时自然清空。
 * 模块边界：不保存配置、不读写宿主网页，持久化的网站禁用与总开关由配置服务管理。
 */
import {ref} from 'vue';
let dismissed = false;
export const writingEntrySaveFailure = ref(false);
export function isWritingDismissedForVisit(): boolean { return dismissed; }
export function dismissWritingForVisit(): void { dismissed = true; }
