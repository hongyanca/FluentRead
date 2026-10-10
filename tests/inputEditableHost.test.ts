import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    EDITABLE_PASTE_SETTLE_LIMIT_MS,
    insertIntoEditableCaretState,
    isSameEditableCaretState,
    readEditableCaretState,
    replaceEditableText,
} from '@/src/features/input-translation/content/editableHost';

/** 按文档顺序截取 root 内到 (endNode, endOffset) 为止的文本，模拟浏览器 Range.toString。 */
function textBefore(root: Node, endNode: Node, endOffset: number): string {
    let text = '';
    let done = false;
    const visit = (node: Node) => {
        if (done) return;
        if (node === endNode) {
            text += node.nodeType === 3
                ? (node as Text).data.slice(0, endOffset)
                : Array.from(node.childNodes).slice(0, endOffset).map(child => child.textContent).join('');
            done = true;
            return;
        }
        if (node.nodeType === 3) {
            text += (node as Text).data;
            return;
        }
        Array.from(node.childNodes).forEach(visit);
    };
    visit(root);
    return text;
}

/** linkedom 的 Range 不支持 setEnd/toString，这里只实现编辑宿主度量所需的最小行为。 */
class FakeRange {
    root: Node | null = null;
    startContainer: Node | null = null;
    startOffset = 0;
    endContainer: Node | null = null;
    endOffset = 0;
    ended = false;

    selectNodeContents(node: Node): void {
        this.root = node;
        this.startContainer = node;
        this.startOffset = 0;
        this.endContainer = node;
        this.endOffset = node.childNodes.length;
        this.ended = false;
    }

    setEnd(node: Node, offset: number): void {
        this.endContainer = node;
        this.endOffset = offset;
        this.ended = true;
    }

    setStart(node: Node, offset: number): void {
        this.startContainer = node;
        this.startOffset = offset;
    }

    collapse(toStart: boolean): void {
        if (toStart) {
            this.endContainer = this.startContainer;
            this.endOffset = this.startOffset;
        } else {
            this.startContainer = this.endContainer;
            this.startOffset = this.endOffset;
        }
        this.ended = true;
    }

    toString(): string {
        const end = this.ended ? textBefore(this.root!, this.endContainer!, this.endOffset) : this.root!.textContent || '';
        return end.slice(textBefore(this.root!, this.startContainer!, this.startOffset).length);
    }
}

class FakeDataTransfer {
    data = new Map<string, string>();
    setData(type: string, value: string): void { this.data.set(type, value); }
    getData(type: string): string { return this.data.get(type) ?? ''; }
}

function editorPage(html: string, options: {selectionEvents?: boolean} = {}) {
    const {document, window} = parseHTML(`<html><body>${html}<p id="outside">outside</p></body></html>`);
    const element = document.querySelector<HTMLElement>('[contenteditable]')!;
    element.focus = vi.fn();
    const selection = {
        ranges: [] as FakeRange[],
        get rangeCount() { return this.ranges.length; },
        get isCollapsed() {
            const range = this.ranges[0];
            return !!range && range.startContainer === range.endContainer && range.startOffset === range.endOffset;
        },
        get focusNode() { return this.ranges[0]?.endContainer; },
        get focusOffset() { return this.ranges[0]?.endOffset || 0; },
        toString() { return this.ranges[0]?.toString() || ''; },
        removeAllRanges: vi.fn(() => { selection.ranges = []; }),
        addRange: vi.fn((range: FakeRange) => {
            selection.ranges.push(range);
            if (options.selectionEvents !== false) {
                setTimeout(() => document.dispatchEvent(new window.Event('selectionchange')), 1);
            }
        }),
        getRangeAt: (index: number) => selection.ranges[index],
    };
    document.getSelection = vi.fn(() => selection) as never;
    document.createRange = vi.fn(() => new FakeRange()) as never;
    const execCommand = vi.fn((_command: string, _ui: boolean, text: string) => {
        element.textContent = text;
        return true;
    });
    document.execCommand = execCommand as never;
    Object.assign(window, {
        DataTransfer: FakeDataTransfer,
        ClipboardEvent: class extends window.Event {
            clipboardData: FakeDataTransfer;
            constructor(type: string, init: EventInit & {clipboardData: FakeDataTransfer}) {
                super(type, init);
                this.clipboardData = init.clipboardData;
            }
        },
    });
    return {document, window, element, selection, execCommand};
}

async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promise;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('编辑宿主光标度量', () => {
    it('按 textContent 口径读取折叠光标，并忽略零宽占位与不换行空格差异', () => {
        const {document, element} = editorPage('<div contenteditable="true"><p>Hello <b>wor</b>ld​</p><p>two</p></div>');
        const bold = element.querySelector('b')!.firstChild!;
        document.getSelection = vi.fn(() => ({isCollapsed: true, focusNode: bold, focusOffset: 2})) as never;

        const state = readEditableCaretState(element);

        expect(state).toEqual({text: 'Hello worldtwo', caret: 8});
        expect(insertIntoEditableCaretState(state!, ' ')).toEqual({text: 'Hello wo rldtwo', caret: 9});
        expect(isSameEditableCaretState(state, {text: 'Hello worldtwo', caret: 8})).toBe(true);
        expect(isSameEditableCaretState(state, {text: 'Hello worldtwo', caret: 7})).toBe(false);
        expect(isSameEditableCaretState(state, {text: 'Hello world', caret: 8})).toBe(false);
        expect(isSameEditableCaretState(null, {text: '', caret: 0})).toBe(false);
    });

    it('光标以元素子节点偏移表示时同样能计算前缀', () => {
        const {document, element} = editorPage('<div contenteditable="true"><p>One</p><p>Two</p></div>');
        document.getSelection = vi.fn(() => ({isCollapsed: true, focusNode: element, focusOffset: 1})) as never;
        expect(readEditableCaretState(element)).toEqual({text: 'OneTwo', caret: 3});
    });

    it('没有选区、选中范围、缺少焦点节点或光标不在宿主内时拒绝度量', () => {
        const {document, element} = editorPage('<div contenteditable="true">Hello</div>');
        const text = element.firstChild!;
        const outside = document.getElementById('outside')!.firstChild!;
        for (const selection of [
            null,
            {isCollapsed: false, focusNode: text, focusOffset: 1},
            {isCollapsed: true, focusNode: null, focusOffset: 0},
            {isCollapsed: true, focusNode: outside, focusOffset: 1},
        ]) {
            document.getSelection = vi.fn(() => selection) as never;
            expect(readEditableCaretState(element)).toBeNull();
        }
    });

    it('Shadow DOM 编辑宿主优先读取所在 shadowRoot 的选区，缺失时回到文档选区', () => {
        const {document, element} = editorPage('<div contenteditable="true">Hello</div>');
        const text = element.firstChild!;
        const documentSelection = vi.fn(() => ({isCollapsed: true, focusNode: text, focusOffset: 5}));
        document.getSelection = documentSelection as never;
        const rootSelection = vi.fn(() => ({isCollapsed: true, focusNode: text, focusOffset: 2}) as unknown as Selection | null);
        element.getRootNode = vi.fn(() => ({getSelection: rootSelection})) as never;

        expect(readEditableCaretState(element)?.caret).toBe(2);
        expect(documentSelection).not.toHaveBeenCalled();

        rootSelection.mockReturnValueOnce(null);
        expect(readEditableCaretState(element)?.caret).toBe(5);

        element.getRootNode = vi.fn(() => ({})) as never;
        expect(readEditableCaretState(element)?.caret).toBe(5);
    });
});

describe('编辑宿主原生写回', () => {
    it.each(['start', 'end'] as const)('双语输出只选中 %s 空范围，保留原文加粗节点和链接', async position => {
        const page = editorPage('<div contenteditable="true"><b>中文</b><a href="https://example.test">链接</a></div>');
        const bold = page.element.querySelector('b');
        const link = page.element.querySelector('a');
        page.element.addEventListener('paste', event => {
            expect(page.selection.isCollapsed).toBe(true);
            expect(page.selection.toString()).toBe('');
            event.preventDefault();
            const node = page.document.createTextNode((event as ClipboardEvent).clipboardData!.getData('text/plain'));
            if (position === 'start') page.element.insertBefore(node, page.element.firstChild);
            else page.element.appendChild(node);
        });
        await expect(settle(replaceEditableText(page.element, position === 'start' ? 'English\n' : '\nEnglish', () => true, position))).resolves.toBe('replaced');
        expect(page.element.textContent).toBe(position === 'start' ? 'English\n中文链接' : '中文链接\nEnglish');
        expect(page.element.querySelector('b')).toBe(bold);
        expect(page.element.querySelector('a')).toBe(link);
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it('追加等待期间光标移到正文时不写入', async () => {
        const page = editorPage('<div contenteditable="true">中文</div>');
        page.document.addEventListener('selectionchange', () => {
            const range = new FakeRange();
            range.selectNodeContents(page.element);
            range.setEnd(page.element.firstChild!, 1);
            range.collapse(false);
            page.selection.ranges = [range];
        });
        await expect(settle(replaceEditableText(page.element, '\nEnglish', () => true, 'end'))).resolves.toBe('stale');
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it.each([['=', '===', '='], [' ', ' \u00a0\u00a0', ' ']])('清理本次光标前的两个触发符 %s，不删除原文已有符号和格式', async (symbol, suffix, retained) => {
        const page = editorPage(`<div contenteditable="true"><b>原文${suffix}</b></div>`);
        const text = page.element.querySelector('b')!.firstChild! as Text;
        const caret = new FakeRange();
        caret.selectNodeContents(page.element);
        caret.setEnd(text, text.data.length);
        caret.collapse(false);
        page.selection.ranges = [caret];
        page.element.addEventListener('paste', event => {
            expect(page.selection.toString()).toBe(suffix.slice(-2));
            event.preventDefault();
            text.data = text.data.slice(0, -2);
        });
        await expect(settle(replaceEditableText(page.element, '', () => true, 'trigger', symbol))).resolves.toBe('replaced');
        expect(page.element.innerHTML).toBe(`<b>原文${retained}</b>`);
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it('光标前符号不匹配或为空时不会删除原文', async () => {
        const page = editorPage('<div contenteditable="true">原文</div>');
        const caret = new FakeRange();
        caret.selectNodeContents(page.element);
        caret.setEnd(page.element.firstChild!, 2);
        caret.collapse(false);
        page.selection.ranges = [caret];
        await expect(replaceEditableText(page.element, '', () => true, 'trigger', '=')).resolves.toBe('unsupported');
        await expect(replaceEditableText(page.element, '', () => true, 'trigger', '')).resolves.toBe('unsupported');
        Object.defineProperty(page.element.firstChild!, 'textContent', {value: null});
        await expect(replaceEditableText(page.element, '', () => true, 'trigger', '=')).resolves.toBe('unsupported');
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it('清理触发符缺少可靠文本光标时保留宿主内容', async () => {
        const page = editorPage('<div contenteditable="true">原文</div>');
        await expect(replaceEditableText(page.element, '', () => true, 'trigger', '=')).resolves.toBe('unsupported');
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it('编辑器同步接管纯文本粘贴时不再调用 insertText，并先选中全文再等待选区同步', async () => {
        const page = editorPage('<div contenteditable="true"><p>Hello <b>world</b></p></div>');
        const pasted: string[] = [];
        page.element.addEventListener('paste', (event: Event) => {
            const data = (event as ClipboardEvent).clipboardData!;
            pasted.push(data.getData('text/plain'));
            expect(page.selection.ranges[0].toString()).toBe('Hello world');
            event.preventDefault();
            page.element.textContent = data.getData('text/plain');
        });

        const result = await settle(replaceEditableText(page.element, '你好\n世界', () => true));

        expect(result).toBe('replaced');
        expect(pasted).toEqual(['你好\n世界']);
        expect(page.element.focus).toHaveBeenCalledWith({preventScroll: true});
        expect(page.selection.removeAllRanges).toHaveBeenCalledOnce();
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it('编辑器异步渲染粘贴结果时轮询等待，不会重复插入', async () => {
        const page = editorPage('<div contenteditable="true">Hello</div>');
        page.element.addEventListener('paste', (event: Event) => {
            event.preventDefault();
            setTimeout(() => { page.element.textContent = 'Bonjour'; }, 45);
        });

        await expect(settle(replaceEditableText(page.element, 'Bonjour', () => true))).resolves.toBe('replaced');
        expect(page.execCommand).not.toHaveBeenCalled();
    });

    it('普通 contenteditable 不处理合成粘贴时退回原生 insertText', async () => {
        const page = editorPage('<div contenteditable="true"></div>');

        await expect(settle(replaceEditableText(page.element, 'Hello', () => true))).resolves.toBe('replaced');
        expect(page.execCommand).toHaveBeenCalledWith('insertText', false, 'Hello');
        expect(page.element.textContent).toBe('Hello');
    });

    it('原生 insertText 不可用时报告 unsupported，不改写 DOM', async () => {
        const page = editorPage('<div contenteditable="true">Hello</div>');
        page.execCommand.mockReturnValue(false);

        await expect(settle(replaceEditableText(page.element, 'Bonjour', () => true))).resolves.toBe('unsupported');
        expect(page.element.textContent).toBe('Hello');
    });

    it('页面拦截粘贴但没有写入时，确认请求仍有效后再走原生插入', async () => {
        const page = editorPage('<div contenteditable="true">Hello</div>');
        page.element.addEventListener('paste', (event: Event) => event.preventDefault());

        const running = replaceEditableText(page.element, 'Bonjour', () => true);
        await vi.advanceTimersByTimeAsync(EDITABLE_PASTE_SETTLE_LIMIT_MS - 40);
        expect(page.execCommand).not.toHaveBeenCalled();

        await expect(settle(running)).resolves.toBe('replaced');
        expect(page.execCommand).toHaveBeenCalledOnce();
    });

    it('拦截粘贴后若请求失效或选区被改动，不再退回原生插入', async () => {
        for (const change of ['request', 'selection'] as const) {
            const page = editorPage('<div contenteditable="true">Hello</div>');
            let current = true;
            page.element.addEventListener('paste', (event: Event) => {
                event.preventDefault();
                if (change === 'request') current = false;
                else page.selection.ranges = [];
            });

            await expect(settle(replaceEditableText(page.element, 'Bonjour', () => current))).resolves.toBe('stale');
            expect(page.execCommand).not.toHaveBeenCalled();
        }
    });

    it('等待选区同步期间请求失效或用户改变选区时不写入', async () => {
        const cases: Array<(page: ReturnType<typeof editorPage>) => {isCurrent: () => boolean}> = [
            () => ({isCurrent: () => false}),
            (page) => {
                page.document.addEventListener('selectionchange', () => { page.selection.ranges = []; });
                return {isCurrent: () => true};
            },
            (page) => {
                page.document.addEventListener('selectionchange', () => {
                    const partial = new FakeRange();
                    partial.selectNodeContents(page.element);
                    partial.setEnd(page.element.firstChild!, 2);
                    page.selection.ranges = [partial];
                });
                return {isCurrent: () => true};
            },
            (page) => {
                page.document.addEventListener('selectionchange', () => {
                    const outside = new FakeRange();
                    outside.selectNodeContents(page.document.getElementById('outside')!);
                    page.selection.ranges = [outside];
                });
                return {isCurrent: () => true};
            },
            (page) => {
                page.document.addEventListener('selectionchange', () => {
                    const escaped = new FakeRange();
                    escaped.selectNodeContents(page.element);
                    escaped.endContainer = page.document.getElementById('outside');
                    page.selection.ranges = [escaped];
                });
                return {isCurrent: () => true};
            },
        ];
        for (const setup of cases) {
            const page = editorPage('<div contenteditable="true">Hello</div>');
            const paste = vi.fn();
            page.element.addEventListener('paste', paste);
            const {isCurrent} = setup(page);

            await expect(settle(replaceEditableText(page.element, 'Bonjour', isCurrent))).resolves.toBe('stale');
            expect(paste).not.toHaveBeenCalled();
            expect(page.execCommand).not.toHaveBeenCalled();
        }
    });

    it('selectionchange 未触发时按超时继续校验并写入', async () => {
        const page = editorPage('<div contenteditable="true">Hello</div>', {selectionEvents: false});

        await expect(settle(replaceEditableText(page.element, 'Bonjour', () => true))).resolves.toBe('replaced');
        expect(page.execCommand).toHaveBeenCalledOnce();
    });

    it('缺少剪贴板事件构造器或窗口时直接使用原生插入，没有选区时报告 unsupported', async () => {
        const noClipboard = editorPage('<div contenteditable="true">Hello</div>');
        Object.assign(noClipboard.window, {ClipboardEvent: undefined});
        await expect(settle(replaceEditableText(noClipboard.element, 'Bonjour', () => true))).resolves.toBe('replaced');

        const noDataTransfer = editorPage('<div contenteditable="true">Hello</div>');
        Object.assign(noDataTransfer.window, {DataTransfer: undefined});
        await expect(settle(replaceEditableText(noDataTransfer.element, 'Bonjour', () => true))).resolves.toBe('replaced');

        const detached = editorPage('<div contenteditable="true">Hello</div>');
        Object.defineProperty(detached.document, 'defaultView', {value: null});
        await expect(settle(replaceEditableText(detached.element, 'Bonjour', () => true))).resolves.toBe('replaced');

        const noSelection = editorPage('<div contenteditable="true">Hello</div>');
        noSelection.document.getSelection = vi.fn(() => null) as never;
        await expect(settle(replaceEditableText(noSelection.element, 'Bonjour', () => true))).resolves.toBe('unsupported');
        expect(noSelection.element.focus).not.toHaveBeenCalled();
    });
});
