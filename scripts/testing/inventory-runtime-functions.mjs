// 枚举全部自有运行时代码的函数，并标记待人工核对的成本/生命周期操作。
// 用法：node scripts/testing/inventory-runtime-functions.mjs <report.json>
// 这是可复查的扫描索引；操作标记不是缺陷判断，不据此删除导出或声称没有 bug。
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {parse} from 'vue/compiler-sfc';

const root = fileURLToPath(new URL('../..', import.meta.url));
if (!process.argv[2]) throw new Error('Pass an output JSON path');
const files = [];
const excluded = [];
function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), {withFileTypes: true})) {
        if (['node_modules', 'dist', '.output', '.wxt'].includes(entry.name)) continue;
        const file = path.posix.join(directory, entry.name);
        if (file === 'userscript/resources') {
            excluded.push({path: file, reason: 'Generated and third-party pinned resource bundles; verified by userscript build and resource verifier'});
            continue;
        }
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|vue)$/.test(file) && !file.endsWith('.d.ts')) files.push(file);
    }
}
for (const directory of ['src', 'entrypoints', 'userscript', 'integrations']) walk(directory);
const operationGroups = {
    domRead: new Set(['querySelector', 'querySelectorAll', 'getBoundingClientRect', 'getComputedStyle']),
    subscription: new Set(['addEventListener', 'addListener', 'observe', 'watch', 'watchEffect', 'subscribe']),
    scheduling: new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback']),
    cleanup: new Set(['removeEventListener', 'removeListener', 'disconnect', 'abort', 'terminate', 'dispose', 'clearTimeout', 'clearInterval', 'cancelAnimationFrame', 'cancelIdleCallback', 'revokeObjectURL']),
    serialization: new Set(['stringify', 'parse', 'encode', 'decode', 'sha256', 'sha256Hex', 'createObjectURL']),
};
const modules = files.sort().map(file => {
    const source = readFileSync(path.join(root, file), 'utf8');
    let script = source;
    const errors = [];
    if (file.endsWith('.vue')) {
        const parsed = parse(source, {filename: file});
        errors.push(...parsed.errors.map(String));
        // 保留原文件行号；模板表达式交由 Vue 编译和组件测试验证，不冒充脚本函数。
        const blocks = [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean);
        let cursor = 0;
        script = '';
        for (const block of blocks.sort((a, b) => a.loc.start.offset - b.loc.start.offset)) {
            script += source.slice(cursor, block.loc.start.offset).replace(/[^\r\n]/g, ' ');
            script += block.content;
            cursor = block.loc.end.offset;
        }
        script += source.slice(cursor).replace(/[^\r\n]/g, ' ');
    }
    const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true,
        /\.jsx?$/.test(file) ? ts.ScriptKind.JS : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    errors.push(...ast.parseDiagnostics.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')));
    const functions = [];
    function visit(node, owner) {
        if (ts.isFunctionLike(node) && node.body) {
            const start = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
            const end = ast.getLineAndCharacterOfPosition(node.end).line + 1;
            owner = {name: node.name?.getText(ast) || node.parent?.name?.getText(ast) || '<callback>',
                line: start, end, kind: ts.SyntaxKind[node.kind], async: Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)),
                loops: 0, awaits: 0, operations: {}};
            functions.push(owner);
        }
        if (owner) {
            if (ts.isIterationStatement(node, false)) owner.loops++;
            if (ts.isAwaitExpression(node)) owner.awaits++;
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
                const expression = node.expression;
                const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : '';
                for (const [group, names] of Object.entries(operationGroups)) {
                    if (names.has(name)) (owner.operations[group] ??= []).push({name, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1});
                }
            }
        }
        ts.forEachChild(node, child => visit(child, owner));
    }
    visit(ast, null);
    return {file, sha256: createHash('sha256').update(source).digest('hex'), errors, functions};
});
const chains = {};
for (const module of modules) {
    const parts = module.file.split('/');
    const chain = parts[0] === 'src' ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/');
    const count = chains[chain] ??= {files: 0, functions: 0, flaggedFunctions: 0};
    count.files++;
    count.functions += module.functions.length;
    count.flaggedFunctions += module.functions.filter(fn => fn.loops || fn.awaits || Object.keys(fn.operations).length).length;
}
const report = {revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    scope: 'Working tree TS/JS functions and Vue script blocks, including callbacks; excludes vendor assets, templates, generated output and declaration-only signatures. Markers are review aids, not proof of defects or coverage.',
    files: modules.length, functions: modules.reduce((sum, module) => sum + module.functions.length, 0),
    parseErrors: modules.flatMap(module => module.errors.map(error => ({file: module.file, error}))), excluded, chains, modules};
writeFileSync(path.resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({files: report.files, functions: report.functions, parseErrors: report.parseErrors, chains}, null, 2));
if (report.parseErrors.length) process.exitCode = 1;
