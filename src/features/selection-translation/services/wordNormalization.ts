/**
 * @file src/features/selection-translation/services/wordNormalization.ts
 * 文件职责：在内容脚本与后台之间共享英文单词识别规则。
 * 主要内容：折叠常见排版引号和连字符，并拒绝超长、零宽或混淆字符。
 * 模块边界：纯文本函数，不加载词典索引、网络 provider 或后台缓存。
 */

const MAX_WORD_LENGTH = 64;

/** 把网页排版符号折叠为词典协议接受的 ASCII 形式，其余 Unicode 字符仍会被拒绝。 */
export function normalizeEnglishWord(value: string): string | null {
    const normalized = String(value || '')
        .trim()
        .normalize('NFC')
        .replace(/[‘’ʼ]/gu, "'")
        .replace(/[‐‑‒–—]/gu, '-');
    if (normalized.length === 0 || normalized.length > MAX_WORD_LENGTH) return null;
    if (!/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/u.test(normalized)) return null;
    return normalized.toLowerCase();
}

export function isSingleEnglishWord(value: string): boolean {
    return normalizeEnglishWord(value) !== null;
}
