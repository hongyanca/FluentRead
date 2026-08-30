import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function readSource(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('standalone userscript privacy boundaries', () => {
    const userscriptStorage = readSource('userscript/storage.ts');
    const userscriptCount = readSource('userscript/count.ts');
    const userscriptMain = readSource('userscript/main.ts');
    const userscriptHttp = readSource('userscript/http.ts');
    const translationCache = readSource('src/services/translation/cache.ts');
    const legacyPageCache = readSource('src/services/translation/legacyPageCache.ts');
    const gemini = readSource('src/providers/translation/gemini.ts');
    const httpError = readSource('src/platform/http/errors.ts');

    it('keeps userscript configuration in GM storage instead of host-page Web Storage', () => {
        expect(userscriptStorage).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
        expect(userscriptStorage).toContain('globalThis.GM_getValue');
        expect(userscriptStorage).toContain('globalThis.GM_setValue');
        expect(userscriptStorage).toContain('globalThis.GM_deleteValue');
    });

    it('计数副本只使用随机 GM 命名空间，不把页面证据或凭据写入键名', () => {
        expect(userscriptCount).toContain("'fluentread:count:v1:base:'");
        expect(userscriptCount).toContain("'fluentread:count:v1:replica:'");
        expect(userscriptCount).not.toMatch(/\b(?:location|localStorage|sessionStorage)\b/u);
        expect(userscriptCount).not.toMatch(/config\.(?:token|proxy|custom)\b/u);
    });

    it('初始化失败和页面离开都会释放消息、可见性与设置监听器', () => {
        expect(userscriptMain).toContain('browser.runtime.onMessage.removeListener(toggleTranslationListener)');
        expect(userscriptMain).toContain('resetPlatformMessageHandler()');
        expect(userscriptMain).toContain('disposeUserscriptRuntime?.()');
        expect(userscriptMain).toContain("document.removeEventListener('visibilitychange', synchronizeVisibleCount)");
    });

    it('migrates only FluentRead-owned legacy page-cache keys', () => {
        expect(legacyPageCache).not.toContain('.clear(');
        expect(legacyPageCache).toContain('key?.startsWith(LEGACY_TRANSLATION_CACHE_PREFIX)');
        expect(legacyPageCache).toContain('pageStorage.removeItem(LEGACY_CACHE_TIMESTAMP_KEY)');
        expect(legacyPageCache).not.toMatch(/(?:localStorage|sessionStorage)\.clear\(\)/);
    });

    it('uses per-entry hard TTL for the shared IndexedDB translation cache', () => {
        expect(translationCache).toContain('createdAt + TRANSLATION_CACHE_TTL_MS <= now');
        expect(translationCache).toContain('expiresAt: now + TRANSLATION_CACHE_TTL_MS');
        expect(translationCache).toContain(".where('createdAt')");
        expect(translationCache).toContain('belowOrEqual(now - TRANSLATION_CACHE_TTL_MS)');
        expect(translationCache).not.toContain('lastAccessedAt + TRANSLATION_CACHE_TTL_MS');
    });

    it('keeps Gemini credentials out of URLs and custom proxies', () => {
        expect(gemini).not.toContain('generateContent?key=');
        expect(gemini).toContain("'x-goog-api-key'");
        expect(gemini).toContain('if (usesOfficialEndpoint)');
        expect(gemini).not.toContain('responseText');
    });

    it('does not reflect provider response bodies in transport errors', () => {
        const errorFunction = userscriptHttp.match(
            /function errorFromResponse\([\s\S]*?\n\}/,
        )?.[0] || '';
        expect(httpError).toContain('return new Error(`${label}: ${response.status}`);');
        expect(httpError).toContain('throw new Error(label);');
        expect(httpError).not.toContain('response.text');
        expect(httpError).not.toContain('response.statusText');
        expect(userscriptHttp).toContain("response?.statusText || (response?.status ? `HTTP ${response.status}` : 'unknown error')");
        expect(errorFunction).toBeTruthy();
        expect(errorFunction).not.toContain('responseText');
    });

    it('uses the safe JSON reader for successful Gemini responses', () => {
        expect(gemini).toContain("readJsonResponse<any>(resp, 'Gemini 返回的不是有效 JSON')");
        expect(gemini).not.toMatch(/JSON\.parse\(/);
        expect(httpError).toContain('catch {');
    });

    it('does not log provider credentials or raw response objects in the userscript transport', () => {
        expect(userscriptHttp).not.toMatch(/console\.(?:log|debug|info|warn|error)\(/);
        expect(httpError).not.toMatch(/console\.(?:log|debug|info|warn|error)\(/);
        expect(gemini).not.toMatch(/console\.(?:log|debug|info|warn|error)\(/);
    });
});
