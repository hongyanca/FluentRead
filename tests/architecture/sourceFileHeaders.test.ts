import {readdirSync, readFileSync, statSync} from 'node:fs';
import {relative, resolve, sep} from 'node:path';
import {describe, expect, it} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '../..');
const SRC_ROOT = resolve(PROJECT_ROOT, 'src');
const DOCUMENTED_EXTENSIONS = new Set(['.css', '.cts', '.md', '.mts', '.ts', '.tsx', '.vue']);
const REQUIRED_SECTIONS = ['文件职责：', '主要内容：', '模块边界：'] as const;

function relativePath(path: string): string {
    return relative(PROJECT_ROOT, path).split(sep).join('/');
}

function extensionOf(path: string): string {
    const dotIndex = path.lastIndexOf('.');
    return dotIndex >= 0 ? path.slice(dotIndex) : '';
}

function listSourceFiles(): string[] {
    const files: string[] = [];

    const visit = (directory: string) => {
        for (const entry of readdirSync(directory)) {
            const absolute = resolve(directory, entry);
            if (statSync(absolute).isDirectory()) {
                visit(absolute);
            } else {
                files.push(relativePath(absolute));
            }
        }
    };

    visit(SRC_ROOT);
    return files.sort();
}

function readHeader(path: string): string | undefined {
    const source = readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
    const isHtmlComment = path.endsWith('.vue') || path.endsWith('.md');
    const match = isHtmlComment
        ? source.match(/^<!--[\s\S]*?-->/u)
        : source.match(/^\/\*\*[\s\S]*?\*\//u);
    return match?.[0];
}

function normalizedHeaderLines(header: string): string[] {
    return header.split('\n')
        .map((line) => line.trim())
        .map((line) => ['/**', '<!--', '*/', '-->'].includes(line)
            ? ''
            : line.replace(/^\*\s?/u, '').trim())
        .filter(Boolean);
}

describe('src file header documentation', () => {
    const allSourceFiles = listSourceFiles();
    const sourceFiles = allSourceFiles.filter((path) => DOCUMENTED_EXTENSIONS.has(extensionOf(path)));

    it('src 中每个文件都属于强制首部说明支持的文本源码类型', () => {
        const unsupported = allSourceFiles.filter((path) => !DOCUMENTED_EXTENSIONS.has(extensionOf(path)));
        expect(unsupported).toEqual([]);
        expect(sourceFiles.length).toBeGreaterThan(0);
    });

    it.each(sourceFiles)('%s 以语义化长注释说明职责、内容与边界', (path) => {
        const header = readHeader(path);

        expect(header, path + ' 必须从第一个字符开始书写文件说明').toBeDefined();
        const lines = normalizedHeaderLines(header!);
        const fileLines = lines.filter((line) => line.startsWith('@file '));
        expect(fileLines).toEqual(['@file ' + path]);

        for (const label of REQUIRED_SECTIONS) {
            const sectionLines = lines.filter((line) => line.startsWith(label));
            expect(sectionLines, path + ' 的“' + label + '”必须是唯一独立行').toHaveLength(1);
            const value = sectionLines[0].slice(label.length).trim();
            expect(value.length, path + ' 的“' + label + '”不能是空泛占位').toBeGreaterThanOrEqual(12);
            expect(value, path + ' 的“' + label + '”应使用中文解释').toMatch(/\p{Script=Han}/u);
        }

        expect(header!.length, path + ' 的文件说明应是可独立阅读的长注释').toBeGreaterThanOrEqual(160);
        expect(header).not.toMatch(/(?:TODO|待补充|此文件负责相关功能|文件职责：\s*(?:无|未知|待定))/u);
    });

    it('不同文件不能复制相同的职责或主要内容说明', () => {
        const owners = new Map<string, string>();
        const duplicates: Array<{first: string; second: string; section: string}> = [];

        for (const path of sourceFiles) {
            const header = readHeader(path);
            if (!header) continue;
            const lines = normalizedHeaderLines(header);
            for (const label of REQUIRED_SECTIONS.slice(0, 2)) {
                const value = lines.find((line) => line.startsWith(label))?.slice(label.length).trim() ?? '';
                const key = label + value;
                const first = owners.get(key);
                if (first) duplicates.push({first, second: path, section: label});
                else owners.set(key, path);
            }
        }

        expect(duplicates).toEqual([]);
    });
});
