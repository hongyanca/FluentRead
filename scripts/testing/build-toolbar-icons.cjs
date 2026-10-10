/** 工具栏状态资源：保留原始品牌图标，在 16 CSS px 图标右下角绘制边长 8 px、底色不透明度 78% 的三角折角。 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.FLUENTREAD_SHARP_PATH || 'sharp');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'public/icon/toolbar');
fs.mkdirSync(output, {recursive: true});
const marks = {
    translated: ['#4caf50', '<path d="m11.1 13 1.25 1.2 2.6-3"/>'],
    translating: ['#2563eb', '<path d="M13.15 11.15v1.9l1.25.65"/>'],
    error: ['#b45309', '<path d="M13.15 11.1v2m0 1.2h0"/>'],
};
(async () => {
    for (const size of [16, 32, 48, 64, 128]) {
        for (const [status, [color, mark]] of Object.entries(marks)) {
            const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><path d="M15.8 7.8v6.4q0 1.6-1.6 1.6H7.8Z" fill="${color}" fill-opacity=".78"/><g fill="none" stroke="white" stroke-opacity=".96" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round">${mark}</g></svg>`);
            await sharp(path.join(root, `public/icon/${size}.png`)).composite([{input: overlay}]).png().toFile(path.join(output, `${status}-${size}.png`));
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
