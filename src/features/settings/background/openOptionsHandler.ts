/**
 * @file src/features/settings/background/openOptionsHandler.ts
 * 文件职责：处理来自页面通知和扩展 UI 的打开设置请求，在后台严格校验目标分区并将导航动作委托给可注入的 Options 页面适配器。
 * 主要内容：定义 openOptionsPage 消息、允许的 section ID 列表、请求响应与依赖契约，parseSection 拒绝未知值，createOpenOptionsPageHandler 返回类型化 handler。
 * 模块边界：本文件不直接绑定 browser.runtime、不渲染设置页也不持久化配置；浏览器页面创建由 app 注入，分区展示与搜索逻辑属于 settings/model 和 Options composition root。
 */
import {NAVIGATION_SECTION_ALIASES} from '@/src/features/settings/model/navigation';

export const OPEN_OPTIONS_PAGE_MESSAGE_TYPE = 'openOptionsPage' as const;

export const OPTIONS_SECTION_IDS = [
    'settings-general',
    'settings-services',
    'settings-translation',
    'settings-image-translation',
    'settings-video',
    'settings-sites',
    'settings-translation-center',
    'settings-vocabulary',
    'settings-advanced',
    'settings-data',
    'settings-about',
] as const;

export type OptionsSectionId = typeof OPTIONS_SECTION_IDS[number];

export interface OpenOptionsPageMessage {
    type: typeof OPEN_OPTIONS_PAGE_MESSAGE_TYPE;
    section?: unknown;
}

export interface OpenOptionsPageResponse {
    success: true;
}

export interface OpenOptionsPageDependencies {
    readonly openDefaultPage: () => Promise<void>;
    readonly openSection: (section: OptionsSectionId) => Promise<void>;
}

export interface OpenOptionsPageHandler {
    readonly type: typeof OPEN_OPTIONS_PAGE_MESSAGE_TYPE;
    handle(message: OpenOptionsPageMessage): Promise<OpenOptionsPageResponse>;
}

const OPTIONS_SECTIONS = new Set<string>(OPTIONS_SECTION_IDS);

function parseSection(value: unknown): OptionsSectionId | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new TypeError('无效的设置页面');
    }
    const resolvedSection = NAVIGATION_SECTION_ALIASES.get(value) ?? value;
    if (!OPTIONS_SECTIONS.has(resolvedSection)) {
        throw new TypeError('无效的设置页面');
    }
    return resolvedSection as OptionsSectionId;
}

/** 创建设置页导航 handler；URL 与 tabs API 由 WXT composition root 负责。 */
export function createOpenOptionsPageHandler(
    dependencies: OpenOptionsPageDependencies,
): OpenOptionsPageHandler {
    return {
        type: OPEN_OPTIONS_PAGE_MESSAGE_TYPE,
        async handle(message) {
            const section = parseSection(message.section);
            if (section === undefined) {
                await dependencies.openDefaultPage();
            } else {
                await dependencies.openSection(section);
            }
            return {success: true};
        },
    };
}
