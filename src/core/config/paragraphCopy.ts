/**
 * @file src/core/config/paragraphCopy.ts
 * 文件职责：定义"复制鼠标所指段落"的触发快捷键与复制内容口径的默认值、可选项与纯归一化规则，让配置、设置界面和网页运行时共用同一份真值。
 * 主要内容：导出 DEFAULT_PARAGRAPH_COPY_HOTKEY、PARAGRAPH_COPY_HOTKEY_OPTIONS 与 ParagraphCopyContentMode，提供 normalizeParagraphCopyHotkey、normalizeCustomParagraphCopyHotkey、resolveParagraphCopyHotkey、paragraphCopyHotkeyDisplayName、matchesParagraphCopyHotkey 和 normalizeParagraphCopyContentMode。
 * 模块边界：本文件只做字符串归一化与键盘事件比较，不读取配置存储、不注册监听、不访问剪贴板，也不渲染界面；按键解析规则归 core/hotkey，段落取词与写入剪贴板由 features/paragraph-copy 负责。
 */
import {canonicalizeHotkey, matchesHotkey, parseHotkey} from '@/src/core/hotkey';

/**
 * 段落复制的默认组合键。不使用 Ctrl+C：那是浏览器复制选中文本的既有语义，
 * 而且悬浮翻译的默认触发键就是 Control，抢过来会同时破坏两种既有操作。
 */
export const DEFAULT_PARAGRAPH_COPY_HOTKEY = 'Alt+C';

/** 设置界面的预设选项；界面再追加"自定义快捷键"入口，对应 custom 取值。 */
export const PARAGRAPH_COPY_HOTKEY_OPTIONS: readonly {value: string; label: string}[] = [
    {value: 'Alt+C', label: 'Alt+C / Option+C'},
    {value: 'Alt+D', label: 'Alt+D / Option+D'},
    {value: 'Shift+C', label: 'Shift+C'},
    {value: 'Shift+D', label: 'Shift+D'},
    {value: 'Ctrl+Alt+C', label: 'Ctrl+Alt+C / Control+Option+C'},
];

const PRESET_HOTKEYS: readonly string[] = PARAGRAPH_COPY_HOTKEY_OPTIONS.map((option) => option.value);

/**
 * 复制内容口径：
 * - auto：跟随段落当前的显示形态，双语复制原文和译文，仅译文复制译文，未翻译复制原文；
 * - original/translation/bilingual：始终复制指定内容，缺少译文时回退原文并在提示中说明。
 */
export type ParagraphCopyContentMode = 'auto' | 'original' | 'translation' | 'bilingual';

export const PARAGRAPH_COPY_CONTENT_MODES: readonly ParagraphCopyContentMode[] = [
    'auto', 'original', 'translation', 'bilingual',
];

export const DEFAULT_PARAGRAPH_COPY_CONTENT_MODE: ParagraphCopyContentMode = 'auto';

/** 预设选择只接受列表内的组合键，其余值（含 none 和单键）回到默认值。 */
export function normalizeParagraphCopyHotkey(value: unknown): string {
    if (value === 'custom') return 'custom';
    if (typeof value !== 'string') return DEFAULT_PARAGRAPH_COPY_HOTKEY;
    const canonical = canonicalizeHotkey(value);
    const preset = PRESET_HOTKEYS.find((hotkey) => hotkey.toLocaleLowerCase() === canonical.toLocaleLowerCase());
    return preset ?? DEFAULT_PARAGRAPH_COPY_HOTKEY;
}

/** 自定义组合键保存为平台无关的规范写法；无法解析时留空，交由预设兜底。 */
export function normalizeCustomParagraphCopyHotkey(value: unknown): string {
    return typeof value === 'string' ? canonicalizeHotkey(value) : '';
}

/**
 * 返回运行时真正监听的组合键。选择了自定义但尚未录制成功时回到默认值，
 * 避免段落复制在开关仍为开启的情况下变成没有入口的功能。
 */
export function resolveParagraphCopyHotkey(hotkey: unknown, customHotkey: unknown): string {
    const choice = normalizeParagraphCopyHotkey(hotkey);
    if (choice !== 'custom') return choice;
    return normalizeCustomParagraphCopyHotkey(customHotkey) || DEFAULT_PARAGRAPH_COPY_HOTKEY;
}

/** 生成界面展示用的按键名称，Mac 上显示 Option/Control 习惯写法。 */
export function paragraphCopyHotkeyDisplayName(hotkey: unknown, customHotkey: unknown): string {
    return parseHotkey(resolveParagraphCopyHotkey(hotkey, customHotkey)).displayName;
}

/** 判断键盘事件是否为已配置的段落复制快捷键；修饰键必须完全一致。 */
export function matchesParagraphCopyHotkey(event: KeyboardEvent, hotkey: unknown, customHotkey: unknown): boolean {
    return matchesHotkey(event, parseHotkey(resolveParagraphCopyHotkey(hotkey, customHotkey)));
}

/** 复制内容口径只接受既定取值，历史配置或异常输入回到跟随显示形态。 */
export function normalizeParagraphCopyContentMode(value: unknown): ParagraphCopyContentMode {
    return PARAGRAPH_COPY_CONTENT_MODES.includes(value as ParagraphCopyContentMode)
        ? value as ParagraphCopyContentMode
        : DEFAULT_PARAGRAPH_COPY_CONTENT_MODE;
}
