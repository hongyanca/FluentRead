/**
 * @file src/core/translation/visionProbeImage.ts
 * 文件职责：在没有 DOM 或 Canvas 的后台环境中生成仅含随机字符的微型识图测试 PNG。
 * 主要内容：以固定点阵绘制六位十六进制字符，编码灰度 PNG、无压缩 DEFLATE、Adler 与 CRC 校验；字符只出现在像素中，不写入 PNG 元数据。
 * 模块边界：纯字节算法，不读取网页、截图、字体、凭据或网络；随机数由调用方提供，供扩展、userscript 和确定性测试共用。
 */
const GLYPHS = ['01110100011001110101110011000101110', '00100011000010000100001000010001110',
    '01110100010000100010001000100011111', '11110000010000101110000010000111110',
    '00010001100101010010111110001000010', '11111100001000011110000010000111110',
    '01110100001000011110100011000101110', '11111000010001000100010000100001000',
    '01110100011000101110100011000101110', '01110100011000101111000010000101110',
    '01110100011000111111100011000110001', '11110100011000111110100011000111110',
    '01111100001000010000100001000001111', '11110100011000110001100011000111110',
    '11111100001000011110100001000011111', '11111100001000011110100001000010000'];

function u32(value: number): number[] { return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function chunk(type: string, data: number[]): number[] {
    const content = [...Array.from(type, c => c.charCodeAt(0)), ...data];
    let crc = 0xffffffff;
    for (const byte of content) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
    }
    return [...u32(data.length), ...content, ...u32((crc ^ 0xffffffff) >>> 0)];
}

export function createVisionProbeImage(bytes: Uint8Array): {answer: string; image: string} {
    if (bytes.length !== 3) throw new TypeError('识图测试需要三个随机字节');
    const answer = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    const width = 224, height = 64, rowBytes = width / 8;
    const pixels = new Uint8Array((rowBytes + 1) * height).fill(255);
    for (let y = 0; y < height; y++) pixels[y * (rowBytes + 1)] = 0;
    for (let index = 0; index < answer.length; index++) {
        const glyph = GLYPHS[parseInt(answer[index], 16)];
        for (let cell = 0; cell < 35; cell++) {
            if (glyph[cell] !== '1') continue;
            for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
                const x = 22 + index * 30 + (cell % 5) * 5 + dx;
                const y = 14 + Math.floor(cell / 5) * 5 + dy;
                pixels[y * (rowBytes + 1) + 1 + (x >>> 3)] &= ~(128 >>> (x & 7));
            }
        }
    }
    let a = 1, b = 0;
    for (const byte of pixels) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    const length = pixels.length;
    const deflate = [0x78, 0x01, 0x01, length & 255, length >>> 8, (~length) & 255, ((~length) >>> 8) & 255,
        ...pixels, ...u32((b << 16) | a)];
    const png = [137, 80, 78, 71, 13, 10, 26, 10,
        ...chunk('IHDR', [...u32(width), ...u32(height), 1, 0, 0, 0, 0]),
        ...chunk('IDAT', deflate), ...chunk('IEND', [])];
    return {answer, image: `data:image/png;base64,${btoa(String.fromCharCode(...png))}`};
}
