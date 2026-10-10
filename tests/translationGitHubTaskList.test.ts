import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {createTranslationCore, createTranslationSourceSnapshot, extractTranslationText} from '@/src/core/translation/public';

const url = new URL('https://github.com/kohya-ss/musubi-tuner/issues/1029');
function fixture() {
    const {document} = parseHTML(readFileSync(new URL('./fixtures/translation-pages/github-task-list.html', import.meta.url), 'utf8'));
    Object.defineProperty(document.defaultView!, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => ({
        display: element.style.display ?? '', visibility: 'visible', position: element.style.position,
        width: element.style.width, height: element.style.height, overflow: element.style.overflow,
        clip: element.style.clip, clipPath: element.style.clipPath,
    })});
    return document;
}
const id = (element: Element) => element.getAttribute('data-testid');
const expected = ['task-heading', 'task-content-0', 'task-content-1', 'task-content-2', 'adjacent-paragraph'];

describe('GitHub React task list ownership', () => {
    it('keeps every hydrated row independent in content scope', () => {
        const document = fixture();
        const core = createTranslationCore({url});
        const owners = core.discover(document);
        expect(owners.map(candidate => id(candidate.element))).toEqual(expected);
        const before = document.querySelector('main')!.innerHTML;
        for (const index of [0, 1, 2]) {
            const row = document.querySelector<HTMLElement>(`[data-testid="task-content-${index}"]`)!;
            expect(owners.filter(candidate => candidate.element === row)).toHaveLength(1);
            expect(core.resolve(row.firstChild)?.element).toBe(row);
            for (const inline of row.querySelectorAll('a:not(.notranslate), strong, code')) {
                expect(core.resolve(inline.firstChild)?.element).toBe(row);
            }
            const snapshot = createTranslationSourceSnapshot(row, core.shouldStayOriginal, undefined, undefined, core.shouldOmitFromTranslation);
            expect(snapshot.clone.querySelector('input,svg')).toBeNull();
            expect(snapshot.slots.map(slot => slot.source).join(' ')).not.toMatch(/draggable|announcement|model\.encode|@sdbds/);
        }
        expect(extractTranslationText(document.querySelector('[data-testid="task-group"]')!, core.shouldStayOriginal)).not.toContain('draggable');
        expect(document.querySelector('main')!.innerHTML).toBe(before);
    });

    it('keeps all-node scope candidates inside each row without swallowing the list', () => {
        const document = fixture();
        const core = createTranslationCore({url, scope: 'all'});
        const list = document.querySelector('[data-testid="task-list"]')!;
        const candidates = core.discover(list);
        for (const candidate of candidates) {
            expect(candidate.element.closest('[data-testid^="task-content-"]')).not.toBeNull();
        }
        for (const index of [0, 1, 2]) {
            const row = document.querySelector(`[data-testid="task-content-${index}"]`)!;
            expect(candidates.some(candidate => row.contains(candidate.element))).toBe(true);
        }
    });

    it('re-discovers server list items after React replaces them with a single grouped LI', () => {
        const document = fixture();
        const list = document.querySelector('[data-testid="task-list"]')!;
        const hydrated = list.innerHTML;
        list.innerHTML = '<li id="first">First server-rendered task.</li><li id="second">Second server-rendered task.</li>';
        const core = createTranslationCore({url});
        expect(core.discover(list).map(candidate => candidate.element.id)).toEqual(['first', 'second']);
        list.innerHTML = hydrated;
        const owners = core.discover(list);
        expect(owners.map(candidate => id(candidate.element))).toEqual(expected.slice(1, 4));
        const row = document.querySelector('[data-testid="task-content-1"]')!;
        row.firstChild!.nodeValue = 'The host updated this task while reading.';
        expect(core.discover(row).map(candidate => candidate.element)).toEqual([row]);
        expect(core.resolve(row.firstChild)?.element).toBe(row);
        expect(extractTranslationText(row)).toContain('The host updated this task');
    });

    it.each(['li', 'blockquote', 'figcaption', 'dt', 'dd', 'th', 'td'])('does not let a GitHub %s swallow nested paragraphs or lists', tag => {
        const {document} = parseHTML(`<html><body><main class="markdown-body"><${tag} id="container">Introductory source text.<task-lists><ul><li id="first">First nested list item.</li><li id="second">Second nested list item.</li></ul></task-lists><p id="last">Final source paragraph.</p></${tag}></main></body></html>`);
        const core = createTranslationCore({url});
        const owners = core.discover(document);
        expect(owners.filter(candidate => !candidate.nodes).map(candidate => candidate.element.id)).toEqual(['first', 'second', 'last']);
        const intro = owners.find(candidate => candidate.element.id === 'container');
        expect(intro?.nodes?.map(node => node.textContent).join('')).toBe('Introductory source text.');
        for (const name of ['first', 'second', 'last']) {
            const element = document.getElementById(name)!;
            expect(core.resolve(element.firstChild)?.element).toBe(element);
        }
    });

    it('preserves a plain leaf list item as one paragraph with links and code', () => {
        const {document} = parseHTML('<html><body><main class="markdown-body"><ul><li id="row">Install <code>tool install</code> and read <a href="/manual">the documentation</a>.</li></ul></main></body></html>');
        const core = createTranslationCore({url});
        const row = document.getElementById('row')!;
        expect(core.discover(document).map(candidate => candidate.element)).toEqual([row]);
        expect(core.resolve(row.querySelector('a')!.firstChild)?.element).toBe(row);
    });
});
