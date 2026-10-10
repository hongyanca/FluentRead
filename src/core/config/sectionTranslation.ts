/**
 * @file src/core/config/sectionTranslation.ts
 * 文件职责：定义“局部翻译”（点选网页中的一块区域、只翻译这部分）进入选择模式的快捷键默认值、可选预设与纯归一化规则，让配置、设置界面、Popup 提示和网页运行时共用同一份按键真值。
 * 主要内容：导出 DEFAULT_SECTION_TRANSLATION_HOTKEY 与 SECTION_TRANSLATION_HOTKEY_OPTIONS，提供 normalizeSectionTranslationHotkey、normalizeCustomSectionTranslationHotkey、resolveSectionTranslationHotkey、sectionTranslationHotkeyDisplayName 和 matchesSectionTranslationHotkey。
 * 模块边界：本文件只做字符串归一化与键盘事件比较，不读取配置存储、不注册监听、不渲染界面；按键解析规则归 core/hotkey，区域选择与翻译编排由 features/section-translation 和全文翻译 feature 负责。
 */
import {canonicalizeHotkey, matchesHotkey, parseHotkey} from '@/src/core/hotkey';

/**
 * 局部翻译的默认组合键。R 取 Region 之意；避开 Alt+T（全文翻译）、Alt+C（段落复制）、
 * Shift+Z（圈选翻译），也避开 Windows 浏览器用 Alt+E/Alt+F 打开菜单、Firefox 用 Alt+S 打开历史菜单。
 */
export const DEFAULT_SECTION_TRANSLATION_HOTKEY = 'Alt+R';

/** 设置界面的预设选项；界面再追加“自定义快捷键”入口，对应 custom 取值。 */
export const SECTION_TRANSLATION_HOTKEY_OPTIONS: readonly {value: string; label: string}[] = [
    {value: 'Alt+R', label: 'Alt+R / Option+R'},
    {value: 'Alt+X', label: 'Alt+X / Option+X'},
    {value: 'Shift+R', label: 'Shift+R'},
    {value: 'Shift+X', label: 'Shift+X'},
    {value: 'Ctrl+Alt+R', label: 'Ctrl+Alt+R / Control+Option+R'},
];

const PRESET_HOTKEYS: readonly string[] = SECTION_TRANSLATION_HOTKEY_OPTIONS.map((option) => option.value);

/** 预设选择只接受列表内的组合键，其余值（含 none 和单键）回到默认值。 */
export function normalizeSectionTranslationHotkey(value: unknown): string {
    if (value === 'custom') return 'custom';
    if (typeof value !== 'string') return DEFAULT_SECTION_TRANSLATION_HOTKEY;
    const canonical = canonicalizeHotkey(value);
    const preset = PRESET_HOTKEYS.find((hotkey) => hotkey.toLocaleLowerCase() === canonical.toLocaleLowerCase());
    return preset ?? DEFAULT_SECTION_TRANSLATION_HOTKEY;
}

/** 自定义组合键保存为平台无关的规范写法；无法解析时留空，交由预设兜底。 */
export function normalizeCustomSectionTranslationHotkey(value: unknown): string {
    return typeof value === 'string' ? canonicalizeHotkey(value) : '';
}

/**
 * 返回运行时真正监听的组合键。选择了自定义但尚未录制成功时回到默认值，
 * 避免快捷键开关仍为开启时却没有可用的组合。
 */
export function resolveSectionTranslationHotkey(hotkey: unknown, customHotkey: unknown): string {
    const choice = normalizeSectionTranslationHotkey(hotkey);
    if (choice !== 'custom') return choice;
    return normalizeCustomSectionTranslationHotkey(customHotkey) || DEFAULT_SECTION_TRANSLATION_HOTKEY;
}

/** 生成界面展示用的按键名称，Mac 上显示 Option/Control 习惯写法。 */
export function sectionTranslationHotkeyDisplayName(hotkey: unknown, customHotkey: unknown): string {
    return parseHotkey(resolveSectionTranslationHotkey(hotkey, customHotkey)).displayName;
}

/** 判断键盘事件是否为已配置的局部翻译快捷键；修饰键必须完全一致。 */
export function matchesSectionTranslationHotkey(event: KeyboardEvent, hotkey: unknown, customHotkey: unknown): boolean {
    return matchesHotkey(event, parseHotkey(resolveSectionTranslationHotkey(hotkey, customHotkey)));
}
