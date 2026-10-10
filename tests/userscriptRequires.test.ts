import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {describe, expect, it} from 'vitest';

const root = process.cwd();
const vue = readFileSync(resolve(root, 'node_modules/vue/dist/vue.global.prod.js'), 'utf8');
const elementPlus = readFileSync(resolve(root, 'node_modules/element-plus/dist/index.full.min.js'), 'utf8');
const bridge = readFileSync(resolve(root, 'userscript/vueElementPlusBridge.v1.js'), 'utf8');

describe('userscript @require UMD compatibility', () => {
    it('exposes Vue to Element Plus inside a manager scoped wrapper', () => {
        const run = (middle: string) => runInNewContext(
            `(function () {\n${vue}\n${middle}\n${elementPlus}\nreturn typeof ElementPlus.ElButton;\n}())`,
            {},
            {timeout: 5_000},
        );

        // Violentmonkey keeps Vue's `var Vue` lexical while Element Plus reads globalThis.Vue.
        expect(() => run('')).toThrow(/defineComponent/u);
        expect(run(bridge)).toBe('object');
    });
});
