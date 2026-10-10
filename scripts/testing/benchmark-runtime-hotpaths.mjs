// 比较指定 Git 基线与工作树的实际模块；只编译到临时目录，不访问供应商或修改构建产物。
// 用法：node scripts/testing/benchmark-runtime-hotpaths.mjs <baseline-ref> [report.json]
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir, cpus} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = process.argv[2];
if (!baseline) throw new Error('Pass an explicit baseline Git ref');
const revision = execFileSync('git', ['rev-parse', '--verify', `${baseline}^{commit}`], {cwd: root, encoding: 'utf8'}).trim();
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('vite'))('esbuild');
const temporary = await mkdtemp(path.join(tmpdir(), 'fluentread-hotpaths-'));
const report = {baseline: revision, node: process.version, cpu: cpus()[0]?.model,
    scope: 'Local synthetic CPU workloads; excludes provider, network, DOM and browser rendering time', cases: []};

async function modulePair(file, name) {
    const current = await readFile(path.join(root, file), 'utf8');
    const original = execFileSync('git', ['show', `${revision}:${file}`], {cwd: root, encoding: 'utf8'});
    const modules = [];
    for (const [label, contents] of [['baseline', original], ['current', current]]) {
        const outfile = path.join(temporary, `${name}-${label}.mjs`);
        await build({stdin: {contents, loader: 'ts', resolveDir: path.dirname(path.join(root, file))},
            bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
            alias: {'@': root}});
        modules.push(await import(pathToFileURL(outfile).href));
    }
    return modules;
}

async function compare(name, iterations, operations) {
    const samples = [[], []];
    for (const operation of operations) for (let i = 0; i < 100; i += 1) await operation();
    for (let round = 0; round < 7; round += 1) {
        // 交替先后顺序减小升温、后台负载和 JIT 对单边的偏差；统计中位数而非最快一次。
        for (const index of round % 2 ? [1, 0] : [0, 1]) {
            const start = performance.now();
            for (let i = 0; i < iterations; i += 1) await operations[index]();
            samples[index].push(performance.now() - start);
        }
    }
    const median = values => [...values].sort((a, b) => a - b)[3];
    const before = median(samples[0]);
    const after = median(samples[1]);
    report.cases.push({name, iterations, baselineMs: before, currentMs: after,
        reductionPercent: (before - after) / before * 100, samples});
}

try {
    const subtitle = await modulePair('src/features/video-subtitle/content/subtitleLogic.ts', 'subtitle');
    const cues = Array.from({length: 6000}, (_, index) => ({startMs: index * 1000, durationMs: 1000, text: `Caption ${index}`}));
    await compare('Match current caption in a 6000-cue timeline', 500,
        subtitle.map(module => () => module.selectYoutubeCaptionCue(cues, 'Caption 3000', 3_000_500)));
    const rotation = await modulePair('src/services/translation/apiKeyRotation.ts', 'rotation');
    const config = {token: {demo: 'synthetic-key'}, apiKeys: {demo: ['synthetic-key']}, model: {demo: 'fixture'}};
    await compare('Single-key request orchestration', 10_000,
        rotation.map(module => () => module.runWithApiKeyRotation(config, 'demo', async selected => selected.token.demo)));
    const legacy = require('crypto-js/sha256');
    const {sha256} = require('@noble/hashes/sha2');
    const {bytesToHex} = require('@noble/hashes/utils');
    for (const size of [64, 1024, 50_000]) {
        const text = '流畅阅读abc'.repeat(Math.ceil(size / 7)).slice(0, size);
        await compare(`SHA-256 of ${size} UTF-16 units`, size < 2000 ? 5000 : 200,
            [() => legacy(text).toString(), () => bytesToHex(sha256(text))]);
    }
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (process.argv[3]) await writeFile(path.resolve(process.argv[3]), json);
    console.log(json);
} finally {
    await rm(temporary, {recursive: true, force: true});
}
