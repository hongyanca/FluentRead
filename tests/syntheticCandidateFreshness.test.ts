import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({config: {style: 1, to: 'zh-Hans'}}));
vi.mock('@/src/core/config/catalog', () => ({options: {styles: []}}));
vi.mock('@/src/features/full-page-translation/content/layout', () => ({ensureTranslationTruncationLayout: vi.fn()}));

import {getCurrentTranslationCore, type TranslationCandidate} from '@/src/core/translation/public';
import {isTranslationCandidateCurrent} from '@/src/features/full-page-translation/content/translationStability';
import {materializeCandidate} from '@/src/features/full-page-translation/content/renderer';

function sourceRun() {
    const {document} = parseHTML('<html><body><main><div id="owner">Read <strong>these</strong><em>details</em><p>A separate paragraph.</p></div></main></body></html>');
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const candidate = getCurrentTranslationCore().discover(document).find(item => item.element === owner && item.nodes)!;
    expect(candidate?.nodes).toHaveLength(3);
    return {document, owner, candidate};
}

function insertSource(candidate: TranslationCandidate, before: Node | null) {
    const addition = candidate.element.ownerDocument.createElement('span');
    addition.textContent = 'NEW_HOST_TEXT';
    candidate.element.insertBefore(addition, before);
    return addition;
}

describe('排队行内候选的完整来源校验', () => {
    it.each(['between', 'after'] as const)('原 run %s 新增可读节点后拒绝旧候选，再发现包含全部当前原文', placement => {
        const {owner, candidate} = sourceRun();
        const addition = insertSource(candidate, placement === 'between' ? candidate.nodes![1]! : owner.querySelector('p'));
        expect(isTranslationCandidateCurrent(candidate)).toBe(false);
        const fresh = getCurrentTranslationCore().resolve(candidate.nodes![0]!);
        expect(fresh?.nodes).toContain(addition);
        expect(isTranslationCandidateCurrent(fresh!)).toBe(true);
    });

    it('首节点未变时仍拒绝后续节点重排，保留宿主的新顺序', () => {
        const {owner, candidate} = sourceRun();
        owner.insertBefore(candidate.nodes![2]!, candidate.nodes![1]!);
        const newHTML = owner.innerHTML;
        expect(isTranslationCandidateCurrent(candidate)).toBe(false);
        expect(owner.innerHTML).toBe(newHTML);
    });

    it('旧节点内部新增独立段落边界后拒绝原 run', () => {
        const {document, candidate} = sourceRun();
        const paragraph = document.createElement('p');
        paragraph.textContent = 'New independent paragraph.';
        candidate.nodes![2]!.appendChild(paragraph);
        expect(isTranslationCandidateCurrent(candidate)).toBe(false);
    });

    it('宿主只更新当前文本和展示属性时保留候选，使用最新原文', () => {
        const {owner, candidate} = sourceRun();
        candidate.nodes![0]!.textContent = 'Updated introduction ';
        const strong = owner.querySelector('strong')!;
        strong.setAttribute('title', 'New host title');
        expect(isTranslationCandidateCurrent(candidate)).toBe(true);
        const materialized = materializeCandidate(candidate)!;
        expect(materialized.node.textContent).toBe('Updated introduction thesedetails');
        expect(materialized.node.querySelector('strong')).toBe(strong);
        expect(strong.getAttribute('title')).toBe('New host title');
    });
});

describe('合成段物化的宿主节点次序保护', () => {
    it('拒绝被新宿主节点分隔的旧来源，不移动任何原文节点', () => {
        const {owner, candidate} = sourceRun();
        insertSource(candidate, candidate.nodes![1]!);
        const newHTML = owner.innerHTML;
        const currentNodes = Array.from(owner.childNodes);
        expect(materializeCandidate(candidate)).toBeNull();
        expect(owner.innerHTML).toBe(newHTML);
        expect(Array.from(owner.childNodes)).toEqual(currentNodes);
    });

    it.each(['reverse', 'duplicate', 'skip'] as const)('拒绝 %s 的来源集合且不改写宿主结构', shape => {
        const {owner, candidate} = sourceRun();
        const nodes = shape === 'reverse' ? [...candidate.nodes!].reverse()
            : shape === 'duplicate' ? [candidate.nodes![0]!, candidate.nodes![0]!]
                : [candidate.nodes![0]!, candidate.nodes![2]!];
        const originalHTML = owner.innerHTML;
        expect(materializeCandidate({...candidate, nodes})).toBeNull();
        expect(owner.innerHTML).toBe(originalHTML);
    });

    it('来源仍连续且有序时可重复物化和解包，保留每个节点及监听器', () => {
        const {owner, candidate} = sourceRun();
        const strong = owner.querySelector('strong')!;
        const clicked = vi.fn();
        strong.addEventListener('click', clicked);
        const originalHTML = owner.innerHTML;
        const originalNodes = Array.from(owner.childNodes);
        for (let cycle = 0; cycle < 2; cycle += 1) {
            expect(isTranslationCandidateCurrent(candidate)).toBe(true);
            const materialized = materializeCandidate(candidate)!;
            expect(materialized.synthetic).toBe(true);
            expect(Array.from(materialized.node.childNodes)).toEqual(candidate.nodes);
            materialized.node.replaceWith(...Array.from(materialized.node.childNodes));
            expect(owner.innerHTML).toBe(originalHTML);
            expect(Array.from(owner.childNodes)).toEqual(originalNodes);
        }
        strong.dispatchEvent(new owner.ownerDocument.defaultView!.Event('click'));
        expect(clicked).toHaveBeenCalledOnce();
    });
});
