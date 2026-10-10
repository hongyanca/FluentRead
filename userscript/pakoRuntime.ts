/** 精简脚本在不支持 DecompressionStream 的浏览器中使用脚本管理器预载的 pako。 */
export function inflateWithPako(bytes: Uint8Array): string {
    if (typeof pako !== 'undefined' && typeof pako.ungzip === 'function') {
        return String(pako.ungzip(bytes, {to: 'string'}));
    }
    throw new Error('当前浏览器缺少 gzip 解压能力，请检查 userscript 的 pako @require');
}
