import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// 从生产目录生成可直接导入的独立规则包；不复制配置、凭证或维护证据。
const root = fileURLToPath(new URL('../', import.meta.url));
const readCatalog = async name => JSON.parse(await readFile(resolve(root, 'src/core/site-adaptation/catalog', name), 'utf8'));
const [established, websites, profiles] = await Promise.all([
    readCatalog('established.json'), readCatalog('websites.json'), readCatalog('profiles.json'),
]);
const output = resolve(root, process.argv[2] ?? '.output/site-rule-pack.json');
const pack = {version: 1, profiles, rules: [...established, ...websites]};
await mkdir(dirname(output), {recursive: true});
await writeFile(output, JSON.stringify(pack, null, 2) + '\n');
console.log(`Exported ${pack.rules.length} website rules to ${output}`);
