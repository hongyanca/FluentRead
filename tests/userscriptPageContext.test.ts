import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {getPageTranslationContext, resetPageTranslationContextCache} from '@/userscript/pageContext';

const filterConstants = {SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2};

function usePage(html: string, url: string): Document {
    const {document, window} = parseHTML(html);
    // LinkeDOM does not apply TreeWalker's acceptNode filter; use the DOM-standard
    // pruning behavior so the test exercises FluentRead's actual exclusion policy.
    document.createTreeWalker = ((root: Node, _whatToShow: number, filter: NodeFilter) => {
        const nodes: Node[] = [];
        const visit = (node: Node): void => {
            if (node.nodeType === window.Node.ELEMENT_NODE) {
                const result = typeof filter === 'function' ? filter(node) : filter.acceptNode(node);
                if (result === filterConstants.FILTER_REJECT) return;
                nodes.push(node);
                for (const child of [...node.childNodes]) visit(child);
            } else if (node.nodeType === window.Node.TEXT_NODE) {
                nodes.push(node);
            }
        };
        for (const child of [...root.childNodes]) visit(child);
        let index = 0;
        return {nextNode: () => nodes[index++] || null} as TreeWalker;
    }) as typeof document.createTreeWalker;
    vi.stubGlobal('document', document);
    vi.stubGlobal('Node', window.Node);
    vi.stubGlobal('NodeFilter', filterConstants);
    vi.stubGlobal('location', {href: url});
    return document as unknown as Document;
}

describe('userscript bounded page context', () => {
    afterEach(() => {
        resetPageTranslationContextCache();
        vi.unstubAllGlobals();
    });

    it('skips hidden roots, forms, editors, navigation, and owned translation nodes', async () => {
        usePage(`<html><head><title>Article title</title><meta name="description" content="Safe description"></head>
            <body><main hidden><p>HIDDEN_SECRET</p></main><main>
                <nav>NAV_SECRET</nav><form><input value="INPUT_SECRET">FORM_SECRET</form>
                <div contenteditable="true">EDITOR_SECRET</div>
                <p>Readable article text</p>
                <span data-fr-translation-owned="true">TRANSLATION_SECRET</span>
            </main></body></html>`, 'https://example.test/article');

        const context = await getPageTranslationContext();
        expect(context).toContain('Page title: Article title');
        expect(context).toContain('Page description: Safe description');
        expect(context).toContain('Readable article text');
        expect(context).not.toMatch(/HIDDEN_SECRET|NAV_SECRET|INPUT_SECRET|FORM_SECRET|EDITOR_SECRET|TRANSLATION_SECRET/u);
    });

    it('refreshes bounded text when the SPA route changes', async () => {
        const document = usePage('<html><body><main><p>First article</p></main></body></html>', 'https://example.test/first');
        expect(await getPageTranslationContext()).toContain('First article');
        document.querySelector('p')!.textContent = 'Second article';
        expect(await getPageTranslationContext()).toContain('First article');
        globalThis.location.href = 'https://example.test/second';
        expect(await getPageTranslationContext()).toContain('Second article');
    });
});
