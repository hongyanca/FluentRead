/**
 * @file src/features/full-page-translation/content/plainText.ts
 * 文件职责：把浏览器直接打开的 .txt 文档临时转换为可发现的段落节点，并在全文翻译结束时恢复原始 pre。
 * 主要内容：校验 .txt URL 与 body > pre 结构、按空行拆分段落、创建 FluentRead 专属容器，并以原节点身份执行可逆恢复。
 * 模块边界：本模块只处理纯文本页面的临时 DOM 适配，不发现翻译候选、不发起请求、不保存配置；会话启动与恢复由全文翻译 runtime 调用。
 */

interface PlainTextTransformation {
    pre: HTMLPreElement;
    container: HTMLDivElement;
}

let activeTransformation: PlainTextTransformation | null = null;

export function transformPlainTextPage(documentRef: Document = document): boolean {
    if (activeTransformation?.container.isConnected) return true;
    activeTransformation = null;
    const pathname = documentRef.location?.pathname;
    if (!pathname?.toLowerCase().endsWith('.txt')) return false;

    const body = documentRef.body;
    const pre = body.querySelector(':scope > pre');
    if (pre?.tagName.toLowerCase() !== 'pre') return false;
    const paragraphs = (pre.textContent || '').split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
    if (paragraphs.length === 0) return false;

    const container = documentRef.createElement('div');
    container.id = 'fluent-read-plain-text';
    container.style.cssText = 'white-space: pre-wrap; font-family: monospace; padding: 8px; line-height: 1.6;';
    for (const paragraph of paragraphs) {
        const element = documentRef.createElement('p');
        element.textContent = paragraph;
        element.style.cssText = 'margin: 0.5em 0;';
        container.appendChild(element);
    }
    pre.replaceWith(container);
    activeTransformation = {pre: pre as HTMLPreElement, container};
    return true;
}

export function restorePlainTextPage(): void {
    const transformation = activeTransformation;
    activeTransformation = null;
    if (transformation?.container.isConnected) {
        transformation.container.replaceWith(transformation.pre);
    }
}
