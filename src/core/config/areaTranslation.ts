/**
 * @file src/core/config/areaTranslation.ts
 * 文件职责：定义圈选翻译触发快捷键的默认值、可选预设与纯归一化规则，让配置、设置界面和网页运行时共用同一份按键真值。
 * 主要内容：导出 DEFAULT_AREA_TRANSLATION_HOTKEY 与 AREA_TRANSLATION_HOTKEY_OPTIONS，提供 normalizeAreaTranslationHotkey、normalizeCustomAreaTranslationHotkey、resolveAreaTranslationHotkey、areaTranslationHotkeyDisplayName 和 matchesAreaTranslationHotkey。
 * 模块边界：本文件只做字符串归一化与键盘事件比较，不读取配置存储、不注册监听、不渲染界面；按键解析规则归 core/hotkey，选区交互与截图仍由 features/area-translation 负责。
 */
import {canonicalizeHotkey, matchesHotkey, parseHotkey} from '@/src/core/hotkey';

/** 圈选翻译的默认触发组合键；单键会与网页输入冲突，因此始终带修饰键。 */
export const DEFAULT_AREA_TRANSLATION_HOTKEY = 'Shift+Z';

/** 设置界面的预设选项；界面再追加“自定义快捷键”入口，对应 custom 取值。 */
export const AREA_TRANSLATION_HOTKEY_OPTIONS: readonly {value: string; label: string}[] = [
    {value: 'Shift+Z', label: 'Shift+Z'},
    {value: 'Shift+X', label: 'Shift+X'},
    {value: 'Shift+S', label: 'Shift+S'},
    {value: 'Alt+Z', label: 'Alt+Z / Option+Z'},
    {value: 'Alt+X', label: 'Alt+X / Option+X'},
    {value: 'Ctrl+Shift+Z', label: 'Ctrl+Shift+Z / Control+Shift+Z'},
];

const PRESET_HOTKEYS: readonly string[] = AREA_TRANSLATION_HOTKEY_OPTIONS.map((option) => option.value);

/** 预设选择只接受列表内的组合键，其余值（含 none 和单键）回到默认值。 */
export function normalizeAreaTranslationHotkey(value: unknown): string {
    if (value === 'custom') return 'custom';
    if (typeof value !== 'string') return DEFAULT_AREA_TRANSLATION_HOTKEY;
    const canonical = canonicalizeHotkey(value);
    const preset = PRESET_HOTKEYS.find((hotkey) => hotkey.toLocaleLowerCase() === canonical.toLocaleLowerCase());
    return preset ?? DEFAULT_AREA_TRANSLATION_HOTKEY;
}

/** 自定义组合键保存为平台无关的规范写法；无法解析时留空，交由预设兜底。 */
export function normalizeCustomAreaTranslationHotkey(value: unknown): string {
    return typeof value === 'string' ? canonicalizeHotkey(value) : '';
}

/**
 * 返回运行时真正监听的组合键。选择了自定义但尚未录制成功时回到默认值，
 * 避免圈选翻译在开关仍为开启的情况下变成没有入口的功能。
 */
export function resolveAreaTranslationHotkey(hotkey: unknown, customHotkey: unknown): string {
    const choice = normalizeAreaTranslationHotkey(hotkey);
    if (choice !== 'custom') return choice;
    return normalizeCustomAreaTranslationHotkey(customHotkey) || DEFAULT_AREA_TRANSLATION_HOTKEY;
}

/** 生成界面展示用的按键名称，Mac 上显示 Option/Control 习惯写法。 */
export function areaTranslationHotkeyDisplayName(hotkey: unknown, customHotkey: unknown): string {
    return parseHotkey(resolveAreaTranslationHotkey(hotkey, customHotkey)).displayName;
}

/** 判断键盘事件是否为已配置的圈选快捷键；修饰键必须完全一致。 */
export function matchesAreaTranslationHotkey(event: KeyboardEvent, hotkey: unknown, customHotkey: unknown): boolean {
    return matchesHotkey(event, parseHotkey(resolveAreaTranslationHotkey(hotkey, customHotkey)));
}
