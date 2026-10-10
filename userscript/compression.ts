import {inflateWithPako} from '@/userscript/pakoRuntime';

/** 解开内嵌的 gzip 文本；旧内核使用脚本管理器预载或内置的 pako。 */
export async function inflateGzipBase64(base64: string): Promise<string> {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (typeof DecompressionStream === 'function') {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).text();
    }
    return inflateWithPako(bytes);
}
