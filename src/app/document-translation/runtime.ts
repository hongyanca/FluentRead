/**
 * @file src/app/document-translation/runtime.ts
 * 文件职责：把通用翻译客户端、配置 store 与文档 feature 的纯服务连接起来，为页面提供可直接调用的分段翻译和文件下载适配器。
 * 主要内容：标记支持批量请求的服务集合，利用 createDocumentSegmentTranslator 组装单条/批量翻译；生成下载时注入 PDF 译文页栅格化器及当前运行时配置。
 * 模块边界：本文件是 app adapter，不解析源文件、不维护页面进度，也不实现 PDF/EPUB/DOCX 编码；业务算法归 document-translation feature，网络请求归 translation client。
 */
import {translateText, translateTextBatch} from '@/src/app/translation/client';
import {services} from '@/src/core/config/catalog';
import {
    createDocumentDownload as createDocumentDownloadWithAdapters,
    type CreateDocumentDownloadOptions,
} from '@/src/features/document-translation/services/binary';
import {createDocumentSegmentTranslator} from '@/src/features/document-translation/services/translation';
import {rasterizePdfTranslationPage} from '@/src/features/document-translation/ui/pdfPreview';
import {config, configReady} from '@/src/services/config/store';
import type {
    DocumentRenderMode,
    ParsedDocument,
} from '@/src/features/document-translation/core/document';

const BATCH_DOCUMENT_SERVICES = new Set<string>([
    services.microsoft,
    services.freeTranslation,
]);

/** WXT 组合根：把运行时配置和翻译 API 注入纯文档业务服务。 */
export const translateDocumentSegments = createDocumentSegmentTranslator({
    waitUntilReady: () => configReady,
    getDefaultService: () => config.service,
    supportsBatch: (service) => BATCH_DOCUMENT_SERVICES.has(service),
    translateText,
    translateTextBatch,
});

/** 浏览器组合根为 PDF 下载注入 Canvas rasterizer；其他格式仍走同一纯二进制服务。 */
export function createDocumentDownload(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode,
    options: CreateDocumentDownloadOptions = {},
) {
    return createDocumentDownloadWithAdapters(document, translations, mode, {
        ...options,
        pdfPageRasterizer: options.pdfPageRasterizer ?? rasterizePdfTranslationPage,
    });
}
