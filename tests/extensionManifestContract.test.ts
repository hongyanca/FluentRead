import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createExtensionManifest} from '@/wxt.config';

const PROJECT_ROOT = resolve(__dirname, '..');

function sourceBody(path: string): string {
    const source = readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
    const header = source.match(/^\/\*\*[\s\S]*?\*\/\s*/u)?.[0];
    return header?.includes(`@file ${path}`) ? source.slice(header.length) : source;
}

function permissionsFor(browser: string, manifestVersion: 2 | 3): string[] {
    const manifest = createExtensionManifest({browser, manifestVersion} as Parameters<typeof createExtensionManifest>[0]);
    return manifest.permissions as string[];
}

describe('extension manifest capability contract', () => {
    it('declares Offscreen exactly once only for supported Chrome and Edge MV3 builds', () => {
        for (const [browser, manifestVersion, expected] of [
            ['chrome', 3, 1],
            ['edge', 3, 1],
            ['chrome', 2, 0],
            ['firefox', 2, 0],
            ['firefox', 3, 0],
            ['opera', 3, 0],
        ] as const) {
            const permissions = permissionsFor(browser, manifestVersion);
            expect(permissions.filter((permission) => permission === 'offscreen'), `${browser}-mv${manifestVersion}`)
                .toHaveLength(expected);
            expect(permissions).toEqual(expect.arrayContaining([
                'storage',
                'unlimitedStorage',
                'alarms',
                'contextMenus',
            ]));
        }
    });

    it('keeps the Offscreen page entrypoint target-limited and delegates to the app composition root', () => {
        const html = readFileSync(resolve(PROJECT_ROOT, 'entrypoints/offscreen/index.html'), 'utf8');
        const main = sourceBody('entrypoints/offscreen/main.ts');
        expect(html).toContain('<meta name="wxt.include" content="[\'chrome\', \'edge\']">');
        expect(html).toContain('<script type="module" src="./main.ts"></script>');
        expect(html).not.toContain('firefox');
        expect(html).not.toContain('opera');
        expect(main).toBe(
            "import {startOffscreenApp} from '@/src/app/offscreen/runtime';\n\nstartOffscreenApp();\n",
        );
    });

    it('uses the capability-derived manifest factory instead of a static Offscreen permission', () => {
        const source = readFileSync(resolve(PROJECT_ROOT, 'wxt.config.ts'), 'utf8');
        expect(source).toContain('manifest: createExtensionManifest');
        expect(source).toContain("...(capabilities.offscreenDocument ? ['offscreen'] : [])");
        expect(source).not.toContain("permissions: ['storage', 'alarms', 'contextMenus', 'offscreen']");
    });

    it('从任意 YouTube 起始页预注入 timedtext bridge，但不扩大到非 YouTube 站点', () => {
        const source = sourceBody('entrypoints/youtubeBridge.content.ts');
        const matches = [...source.matchAll(/['"](\*:\/\/[^'"]+)['"]/gu)].map((match) => match[1]);

        expect(matches).toEqual([
            '*://*.youtube.com/*',
            '*://youtube.com/*',
        ]);
        expect(source).toContain("runAt: 'document_start'");
        expect(source).toContain("world: 'MAIN'");
        expect(matches).not.toContain('*://*/*');
        expect(matches.some((match) => match.includes('youtube-nocookie'))).toBe(false);
        expect(matches.every((match) => match.includes('youtube'))).toBe(true);
    });
});
