/**
 * @file src/shared/dom/documentType.ts
 * 文件职责：按浏览器报告的文档 MIME 类型识别应交给浏览器原生展示的 XML 文档。
 * 主要内容：排除原始 XML、RSS、SVG 和 XSL 文件，保留 XHTML、纯文本及其他原本可由内容脚本处理的页面。
 * 模块边界：只读取传入文档的 contentType，不访问全局 DOM、不注入脚本或样式；内容应用和 MAIN world 桥共用此判断。
 */
export function isRawXmlContentDocument(pageDocument: Pick<Document, 'contentType'>): boolean {
    const contentType = pageDocument.contentType;
    return contentType !== 'application/xhtml+xml' && (
        contentType === 'text/xml'
        || contentType === 'application/xml'
        || contentType === 'text/xsl'
        || contentType.endsWith('+xml')
    );
}
