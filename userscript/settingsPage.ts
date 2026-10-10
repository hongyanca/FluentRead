/**
 * userscript 设置页的轻量路由标记。
 *
 * userscript 不能创建 chrome-extension://.../options.html，因此借用匹配网页的
 * URL 打开一个独立标签页；hash 只由 FluentRead 识别，不会改变服务端请求。
 */
export const USERSCRIPT_SETTINGS_HASH = '#fluentread-userscript-settings';

export function buildUserscriptSettingsHash(section?: string): string {
    const normalizedSection = typeof section === 'string' ? section.replace(/^#/u, '').trim() : '';
    return normalizedSection ? `${USERSCRIPT_SETTINGS_HASH}/${normalizedSection}` : USERSCRIPT_SETTINGS_HASH;
}

export function buildUserscriptSettingsUrl(currentUrl: string, section?: string): string {
    try {
        const url = new URL(currentUrl);
        url.hash = buildUserscriptSettingsHash(section);
        return url.toString();
    } catch {
        return currentUrl;
    }
}

export function isUserscriptSettingsUrl(currentUrl: string): boolean {
    try {
        const hash = new URL(currentUrl).hash;
        return hash === USERSCRIPT_SETTINGS_HASH || hash.startsWith(`${USERSCRIPT_SETTINGS_HASH}/`);
    } catch {
        return false;
    }
}
