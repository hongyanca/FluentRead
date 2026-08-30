export interface UserscriptMetadataOptions {
    version: string;
    iconDataUrl?: string;
}
const grants = [
    'GM_getValue',
    'GM_setValue',
    'GM_deleteValue',
    'GM_listValues',
    'GM_xmlhttpRequest',
    'GM_registerMenuCommand',
    'GM_addStyle',
];

export function createUserscriptMetadata({version, iconDataUrl}: UserscriptMetadataOptions): string {
    const lines = [
        '// ==UserScript==',
        '// @name         流畅阅读',
        '// @name:en      FluentRead',
        '// @namespace    https://fr.unmeta.cn/',
        `// @version      ${version}`,
        '// @description  双语网页翻译、悬浮翻译与划词翻译的 FluentRead userscript 版本。',
        '// @description:en FluentRead bilingual page, hover, and selection translation userscript.',
        '// @author       ThinkStu',
        '// @license      GPL-3.0-only',
        '// @homepageURL  https://github.com/FluentRead/FluentRead',
        '// @supportURL   https://github.com/FluentRead/FluentRead/issues/220',
        '// @match        http://*/*',
        '// @match        https://*/*',
        '// @run-at       document-start',
        '// @inject-into  content',
        '// @noframes',
        '// @connect      *',
        ...grants.map((grant) => `// @grant        ${grant}`),
        ...(iconDataUrl ? [`// @icon         ${iconDataUrl}`] : []),
        '// ==/UserScript==',
    ];
    return `${lines.join('\n')}\n`;
}
