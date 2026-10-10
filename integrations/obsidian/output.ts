/**
 * FluentRead 的 Obsidian 产物格式：原文件始终不变，双语结果存为相邻笔记。
 */
import type {DocumentSegment} from '../../src/features/document-translation/core/document';

export function bilingualNoteName(fileName: string): string {
    return fileName.toLowerCase().endsWith('.pdf')
        ? `${fileName}.bilingual.md`
        : `${fileName.replace(/\.(?:md|markdown)$/iu, '')}.bilingual.md`;
}

function escapeMarkdownText(value: string): string {
    return value.replace(/([\\`*_{}\[\]()#+.!>|~])/gu, '\\$1').replace(/\r?\n/gu, '\n> ');
}

export function renderBilingualPdfNote(
    sourcePath: string,
    segments: readonly DocumentSegment[],
    translations: readonly string[],
): string {
    const pages = new Map<number, string[]>();
    let currentPage = 1;
    for (const segment of segments) {
        const page = Number(segment.contextLabel?.match(/\d+/u)?.[0] ?? 0);
        // 只有每页第一个片段带 contextLabel，后续片段沿用上一个页码。
        if (page) currentPage = page;
        const rows = pages.get(currentPage) ?? [];
        rows.push(`**原文**\n> ${escapeMarkdownText(segment.source)}\n\n**译文**\n> ${escapeMarkdownText(translations[segment.id] ?? segment.source)}`);
        pages.set(currentPage, rows);
    }
    const title = sourcePath.split('/').at(-1) || sourcePath;
    const sections = [...pages].map(([page, rows]) => `## 第 ${page} 页\n\n${rows.join('\n\n')}`);
    return `# ${escapeMarkdownText(title)} · 双语翻译\n\n原 PDF：[[${sourcePath}]]\n\n${sections.join('\n\n')}\n`;
}
