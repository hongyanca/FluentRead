import {afterEach, describe, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const project = process.cwd();
const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true});
});

function audit(source: string) {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluentread-suite-audit-cli-'));
    directories.push(directory);
    for (const relative of ['entrypoints', 'scripts/testing', 'src', 'userscript', 'tests']) {
        mkdirSync(path.join(directory, relative), {recursive: true});
    }
    symlinkSync(path.join(project, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const scanner = process.env.FLUENTREAD_AUDIT_SUITE_SCANNER || path.join(project, 'scripts/testing/audit-test-suite.mjs');
    // The CLI derives its project root from its URL, so preserve exact source bytes in a fixture tree.
    writeFileSync(path.join(directory, 'scripts/testing/audit-test-suite.mjs'), readFileSync(scanner));
    writeFileSync(path.join(directory, 'tests/cases.test.ts'), source);
    writeFileSync(path.join(directory, 'tests/test-matrix.json'), JSON.stringify({groups: {
        architecture: [], unit: ['tests/cases.test.ts'], functional: [], regression: [],
    }}));
    return spawnSync(process.execPath, [path.join(directory, 'scripts/testing/audit-test-suite.mjs')], {
        cwd: directory, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL',
    });
}

describe('test-suite audit public CLI preserves template-name identity', () => {
    it('accepts distinct static template names within the same dynamically named suite', () => {
        const result = audit('describe(`suite ${variant}`, () => { it(`closes ${variant}`, () => {}); it(`retains ${variant}`, () => {}); });');
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({status: 'ok', files: 1, cases: 2});
    });

    it('keeps different static suite names distinct when their case labels are dynamic', () => {
        const result = audit('describe(`close ${variant}`, () => { it(`works ${variant}`, () => {}); }); describe(`cancel ${variant}`, () => { it(`works ${variant}`, () => {}); });');
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({status: 'ok', cases: 2});
    });

    it('still rejects identical static-and-dynamic name shapes within a suite', () => {
        const result = audit('describe("same", () => { it(`closes ${variant}`, () => {}); it(`closes ${variant}`, () => {}); });');
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('重复测试名');
    });

    it('still treats a literal and a template without substitutions as the same name', () => {
        const result = audit('describe("same", () => { it("closes", () => {}); it(`closes`, () => {}); });');
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('重复测试名');
    });
});
