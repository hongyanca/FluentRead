import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compileStyle, parse} from 'vue/compiler-sfc';
import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

describe('issue #574 compiled reading theme boundaries', () => {
    for (const [file, targetClass] of [['ReadingPanel.vue', 'fr-reading'], ['ReadingAnswer.vue', 'fr-reading-markdown']]) {
        it(`${file} applies dark declarations to its content without recoloring the popup shell`, () => {
            const filename = resolve('src/features/reading-assistant/ui', file);
            const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
            const {document} = parseHTML(`<html><body>
                <section class="fr-dark-theme"><div class="${targetClass}" data-v-theme-test></div></section>
                <section><div class="${targetClass}" data-v-theme-test></div></section>
            </body></html>`);
            const darkRoot = document.querySelector('.fr-dark-theme')!;
            const darkContent = darkRoot.firstElementChild!;
            const lightContent = document.querySelectorAll(`.${targetClass}`)[1];
            const compiled = compileStyle({source: descriptor.styles[0].content, filename, id: 'data-v-theme-test', scoped: true});
            expect(compiled.errors).toEqual([]);
            const matchedProperties = new Set<string>();
            compiled.rawResult!.root.walkRules(rule => {
                if (!rule.selector.includes('.fr-dark-theme')) return;
                // Vue 3 的 :global(.fr-dark-theme) 后接局部选择器会丢掉后半段；
                // 用编译后的真实选择器匹配父子 DOM，阻止主题声明再次错误落到弹窗壳。
                expect(darkRoot.matches(rule.selector), rule.selector).toBe(false);
                expect(lightContent.matches(rule.selector), rule.selector).toBe(false);
                if (darkContent.matches(rule.selector)) rule.walkDecls(decl => { matchedProperties.add(decl.prop); });
            });
            expect(matchedProperties.has(file === 'ReadingPanel.vue' ? 'color' : '--fr-answer-code')).toBe(true);
        });
    }
});
