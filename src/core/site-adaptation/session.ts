/**
 * @file src/core/site-adaptation/session.ts
 * 文件职责：协调当前文档的网站适配配置切换，保证旧翻译会话先失效，再发布新的候选边界。
 * 主要内容：通过规范化配置快照去重存储回声，只在适配字段变化时重新编译，并以注入端口清理旧请求和更新核心。
 * 模块边界：这是纯同步状态机，不订阅配置、不读取浏览器或全局 DOM；内容应用负责持有和释放生命周期。
 */
import {composeSiteAdapters} from './compiler';
import {normalizeSiteAdaptationSettings} from './schema';
import type {SiteRulePack} from './types';
import type {TranslationSiteAdapter} from '../translation/types';

export interface SiteAdaptationSession {
    update(value: unknown, url?: URL): boolean;
    routeChanged(url: URL): boolean;
}

/** 发布前失效旧会话，避免在途请求穿越更新后的保护区。 */
export function createSiteAdaptationSession(pack: SiteRulePack, ports: {
    invalidate(): void;
    apply(adapters: readonly TranslationSiteAdapter[]): void;
}): SiteAdaptationSession {
    let previous: string | null = null;
    let adapters: readonly TranslationSiteAdapter[] = [];
    let routeHref: string | null = null;
    let matchedRules: string | null = null;
    const matchingKey = (url: URL): string => JSON.stringify(adapters
        .filter((adapter) => adapter.matches(url)).map((adapter) => adapter.id));
    return {
        update(value, url) {
            const settings = normalizeSiteAdaptationSettings(value);
            const key = JSON.stringify(settings);
            if (key === previous) return false;
            const nextAdapters = composeSiteAdapters(pack, settings);
            if (previous !== null) ports.invalidate();
            ports.apply(nextAdapters);
            adapters = nextAdapters;
            // 配置回调可能先于同一批次的路由事件。一次失效后同步最新 URL，
            // 后续路由事件不得再次恢复，也不能保留旧 URL 的匹配身份。
            routeHref = url?.href ?? routeHref;
            if (routeHref !== null) matchedRules = matchingKey(new URL(routeHref));
            previous = key;
            return true;
        },
        routeChanged(url) {
            const nextRules = matchingKey(url);
            const changed = matchedRules !== null && matchedRules !== nextRules;
            if (changed) ports.invalidate();
            routeHref = url.href;
            matchedRules = nextRules;
            return changed;
        },
    };
}
