#!/usr/bin/env node
// 检查可复制的品牌文案与唯一语言来源一致，避免以后只改界面而漏掉宣传资料。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const taglines = JSON.parse(read('src/core/i18n/messages/brand-taglines.json'));
const combined = `${taglines['en-US']} ${taglines['zh-CN']}`;

assert.equal(Object.keys(taglines).length, 7, 'Seven interface languages need brand copy');
assert.equal(taglines['en-US'], 'Closer languages. A bigger world.');
assert.equal(taglines['zh-CN'], '让语言更近，让世界更大。');
assert.equal(JSON.parse(read('package.json')).description, combined, 'Package description');
for (const [language, tagline] of Object.entries(taglines)) {
    assert.ok(typeof tagline === 'string' && tagline.trim(), `${language}: empty tagline`);
    assert.ok(read(`src/core/i18n/messages/${language}.ts`).includes(`"brand.tagline": brandTaglines['${language}']`), `${language}: interface resource`);
    assert.ok(read('marketing/brand.md').includes(tagline), `${language}: copyable brand guide`);
}
for (const [locale, language] of [['en', 'en-US'], ['zh-CN', 'zh-CN']]) {
    const folder = `marketing/chrome-web-store/${locale}`;
    const short = read(`${folder}/short-description.txt`).trim();
    assert.equal(short, combined, `${locale}: short description`);
    assert.ok([...short].length <= 132, `${locale}: short description length`);
    assert.equal(JSON.parse(read(`${folder}/listing.json`)).shortDescription, short, `${locale}: listing`);
    assert.ok(read(`${folder}/description.txt`).startsWith(`${taglines[language]}\n\n`), `${locale}: full description`);
    assert.ok(read(`marketing/copy/${locale}.md`).includes(taglines[language]), `${locale}: community copy`);
}
for (const [file, language, counterpart] of [
    ['README.md', 'en-US', './misc/README_ZH.md'],
    ['misc/README_ZH.md', 'zh-CN', '../README.md'],
]) {
    const intro = read(file).split('</div>')[0];
    assert.ok(intro.includes(taglines[language]), `${file}: localized opening`);
    assert.ok(intro.includes(`](${counterpart})`), `${file}: language switch in opening`);
}
console.log('Brand copy verified: 7 languages, localized README openings and language links, package and store descriptions, community copy.');
