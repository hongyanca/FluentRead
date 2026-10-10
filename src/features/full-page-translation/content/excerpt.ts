/**
 * @file src/features/full-page-translation/content/excerpt.ts
 * 文件职责：为分享等只读功能提供精确的已完成双语段落快照。
 * 主要内容：按译文节点定位真实翻译状态，核对所有权、连接状态和完成阶段，返回本段原文及可信译文模板的文字。
 * 模块边界：不暴露内部状态机、不修改宿主或重新请求翻译；忽略伪造标记、已恢复段落和加载中的内容。
 */
import {getTranslationState} from './state';
export interface BilingualExcerpt {original: string; translation: string; artifact: HTMLElement}
export function readBilingualExcerpt(target: Element): BilingualExcerpt | null {
    const artifact = target.closest<HTMLElement>('.fluent-read-bilingual-content[data-fr-translation-owned="true"]');
    const owner = artifact?.parentElement;
    if (!artifact?.isConnected || !owner) return null;
    const state = getTranslationState(owner);
    if (!state || state.phase !== 'translated' || state.bilingualContent !== artifact) return null;
    const original = state.sourceText.trim();
    const translation = (state.bilingualContentTemplate ?? artifact).textContent?.trim() ?? '';
    return original && translation ? {original, translation, artifact} : null;
}
