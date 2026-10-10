/**
 * @file src/features/full-page-translation/content/modalSession.ts
 * 文件职责：在全文会话中切换当前弹窗的调度范围，并安全撤销被遮挡范围中的未完成翻译。
 * 主要内容：重探测弹窗、保留正文候选、释放请求槽、撤销旧 loading generation、提升当前弹窗和关闭后重新发现正文。
 * 模块边界：只编排传入会话和既有翻译状态，候选队列与观察器由 runtime 管理；不关闭宿主弹窗或修改页面焦点。
 */
import type {TranslationCandidate} from '@/src/core/translation/public';
import {getTranslationState, resolveTranslationStateNode, restoreTranslation} from './state';
import {withFullPageViewportAnchor} from './viewportStability';
import {findActiveTranslationModal, isWithinTranslationModal} from './modalPriority';

export interface ModalPrioritySession {
    active: boolean;
    modal: HTMLElement | null;
    modalDirty: boolean;
    roots: Set<Node>;
    inFlightCandidates: Map<Node, TranslationCandidate>;
    scheduled: Map<Node, TranslationCandidate>;
    broadRescanCooldowns: WeakMap<Node, number>;
}
interface ModalSessionHooks {
    forget(candidate: TranslationCandidate): void;
    unregister(target: HTMLElement): void;
    discover(candidate: TranslationCandidate): void;
    promote(key: Node, candidate: TranslationCandidate): void;
    rescan(root: Node): void;
    publish(): void;
    drain(): void;
}

/**
 * 只在宿主弹窗线索变化时重探测。切换范围先撤销尚未完成的旧范围请求，
 * 用新候选身份保留正文排队意图，防止旧 Promise 的 finally 吞掉续译任务。
 * 已经提交的译文不动；关闭弹窗后的整页发现仍复用本会话缓存及所有权。
 */
export function refreshModalSession(session: ModalPrioritySession, hooks: ModalSessionHooks): void {
    if (!session.active || !session.modalDirty) return;
    session.modalDirty = false;
    const previous = session.modal;
    const next = findActiveTranslationModal(session.roots);
    if (previous === next) return;
    session.modal = next;
    const returningToParent = previous && next && isWithinTranslationModal(next, previous);

    for (const [key, candidate] of session.inFlightCandidates) {
        const interrupted = next ? !isWithinTranslationModal(next, candidate.element)
            || (returningToParent && isWithinTranslationModal(previous!, candidate.element))
            : previous && isWithinTranslationModal(previous, candidate.element);
        if (!interrupted) continue;
        session.inFlightCandidates.delete(key);
        hooks.forget(candidate);
        const target = resolveTranslationStateNode(candidate);
        const state = target ? getTranslationState(target) : undefined;
        if (target && state?.phase === 'loading') {
            hooks.unregister(target);
            withFullPageViewportAnchor(() => restoreTranslation(target), [target]);
        }
        if (candidate.element.isConnected && next) hooks.discover({...candidate});
    }

    // 已发现的弹窗候选立即获得调度机会，不依赖遮罩下不可靠的 IO 回调。
    // 返回正文时仍遵守用户选择的视口/整页模式。
    for (const [key, candidate] of session.scheduled) {
        if (next && isWithinTranslationModal(next, candidate.element)) {
            hooks.promote(key, candidate);
        } else if (!next && previous && isWithinTranslationModal(previous, candidate.element)) {
            hooks.forget(candidate);
        }
    }
    const root = next ?? document.documentElement;
    session.broadRescanCooldowns.delete(root);
    hooks.rescan(root);
    hooks.publish();
    hooks.drain();
}
