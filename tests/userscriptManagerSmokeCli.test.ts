import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const {parseArgs, readUserscriptMetadata} = require('../scripts/run-userscript-manager-smoke-test.cjs') as {
    parseArgs: (argv: string[]) => Record<string, string | number>;
    readUserscriptMetadata: (source: string) => {version: string; requires: string[]};
};

const args = [
    '--artifact', 'fluent-read.user.js',
    '--manager-extension', 'violentmonkey',
    '--browser-path', 'chromium',
    '--playwright-root', 'node_modules',
    '--focus-safe-helper', 'focus-safe-browser.cjs',
    '--artifacts-dir', 'evidence',
];

describe('userscript manager smoke CLI', () => {
    it('accepts pnpm argument separator and requires isolated manager inputs', () => {
        expect(parseArgs(['--', ...args])).toEqual(parseArgs(args));
        expect(parseArgs(args).timeout).toBe(60000);
        expect(parseArgs(args).installMode).toBe('file');
        expect(parseArgs(args).settingsMode).toBe('compact');
        expect(parseArgs([...args, '--settings-mode', 'full']).settingsMode).toBe('full');
        expect(() => parseArgs([...args, '--settings-mode', 'unknown'])).toThrow('--settings-mode');
        expect(parseArgs([...args, '--install-mode', 'url']).installMode).toBe('url');
        expect(() => parseArgs([...args, '--install-mode', 'remote'])).toThrow('--install-mode');
        expect(() => parseArgs(['--artifact', 'fluent-read.user.js'])).toThrow('Required argument');
        expect(() => parseArgs([...args, '--timeout', '0'])).toThrow('--timeout');
    });

    it('reads the version and ordered dependencies of the exact installed artifact', () => {
        expect(readUserscriptMetadata([
            '// ==UserScript==',
            '// @version      2.0.1',
            '// @require      https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js',
            '// ==/UserScript==',
        ].join('\n'))).toEqual({
            version: '2.0.1',
            requires: ['https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js'],
        });
        expect(readUserscriptMetadata('// ==UserScript==\n// @version      2.0.1\n// ==/UserScript=='))
            .toEqual({version: '2.0.1', requires: []});
        expect(() => readUserscriptMetadata('// ==UserScript==\n// ==/UserScript==')).toThrow('version declaration');
    });
});
