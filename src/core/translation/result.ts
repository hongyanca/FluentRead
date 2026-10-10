/**
 * @file src/core/translation/result.ts
 * 文件职责：为翻译入口与后台缓存提供统一的有效内容和展示判定，避免空译文成功缓存或相同结果重复显示。
 * 主要内容：只在比较副本中统一 Unicode 组合形式与空白、忽略不显示字形的 U+200B；空译文和相同文本均不产生额外译文，保留大小写、标点、可见词间空格、ZWJ/ZWNJ 及简繁差异。
 * 模块边界：本模块是纯文本规则，不修改来源或结果、不读取配置、不调用翻译服务，也不操作 DOM。
 */
export function hasTranslationContent(text: string): boolean {
    return /[^\s\u200b]/u.test(text);
}

export function hasDistinctTranslation(source: string, translation: string | undefined): boolean {
    const text = translation ?? '';
    if (!hasTranslationContent(text)) return false;
    const normalize = (text: string) => text.normalize('NFC').replace(/\u200b/gu, '').replace(/[\s\u3000]+/gu, ' ').trim();
    return normalize(text) !== normalize(source);
}
