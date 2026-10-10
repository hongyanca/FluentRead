/** 油猴没有扩展写作入口；保留设置页的选项组件契约，不打包网页写作运行时。 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';

export async function mountWritingAssistant(_ctx: ContentScriptContext): Promise<void> {}
export function unmountWritingAssistant(): void {}
export function isWritingAssistantMounted(): boolean { return false; }

export {default as WritingChoices} from '@/src/features/writing-assistant/ui/WritingChoices.vue';
