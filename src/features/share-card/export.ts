/**
 * @file src/features/share-card/export.ts
 * 文件职责：把已经生成的 PNG 交给浏览器下载或图片剪贴板。
 * 主要内容：同步发起需要用户手势的浏览器 API，能力不足或拒绝时由调用方显示保存回退。
 * 模块边界：不生成图片、不访问网络，临时对象 URL 由 UI 管理并回收。
 */
export function shareCardFilename(): string { return `FluentRead-${new Date().toISOString().slice(0, 10)}.png`; }
export function canCopyCardImage(): boolean {
    return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}
export function copyCardImage(blob: Blob): Promise<void> {
    if (!canCopyCardImage()) return Promise.reject(new Error('clipboard-unavailable'));
    return navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
}
