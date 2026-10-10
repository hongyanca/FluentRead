import { describe, expect, it, vi } from 'vitest';
import { areaRectToImageCrop, isUsableAreaRect, normalizeAreaRect } from '@/src/features/area-translation/core';
import {
    areaTranslationHotkeyDisplayName,
    AREA_TRANSLATION_HOTKEY_OPTIONS,
    DEFAULT_AREA_TRANSLATION_HOTKEY,
    matchesAreaTranslationHotkey,
    normalizeAreaTranslationHotkey,
    normalizeCustomAreaTranslationHotkey,
    resolveAreaTranslationHotkey,
} from '@/src/core/config/areaTranslation';
import {shouldStartAreaTranslationFromHotkey} from '@/src/features/area-translation/content/areaHotkey';

function keyboardEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
    return {
        key: '',
        code: '',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...init,
    } as KeyboardEvent;
}

describe('圈选翻译快捷键配置', () => {
    it('预设只接受列表内的组合键，其他取值回到默认 Shift+Z', () => {
        expect(DEFAULT_AREA_TRANSLATION_HOTKEY).toBe('Shift+Z');
        expect(AREA_TRANSLATION_HOTKEY_OPTIONS.map(option => option.value)).toContain('Alt+Z');
        expect(normalizeAreaTranslationHotkey('custom')).toBe('custom');
        expect(normalizeAreaTranslationHotkey('shift+x')).toBe('Shift+X');
        expect(normalizeAreaTranslationHotkey('option+z')).toBe('Alt+Z');
        for (const invalid of [undefined, null, 42, '', 'none', 'Shift', 'Ctrl+C', 'Alt+F4']) {
            expect(normalizeAreaTranslationHotkey(invalid)).toBe('Shift+Z');
        }
    });

    it('自定义组合键保存为规范写法，无法解析时留空', () => {
        expect(normalizeCustomAreaTranslationHotkey('option+shift+k')).toBe('Alt+Shift+K');
        expect(normalizeCustomAreaTranslationHotkey('ctrl+f9')).toBe('Ctrl+F9');
        for (const invalid of [undefined, null, 7, '', 'z', 'cmd+z']) {
            expect(normalizeCustomAreaTranslationHotkey(invalid)).toBe('');
        }
    });

    it('选择自定义但尚未录制成功时仍然保留默认入口', () => {
        expect(resolveAreaTranslationHotkey('Shift+X', 'Alt+K')).toBe('Shift+X');
        expect(resolveAreaTranslationHotkey('custom', 'alt+k')).toBe('Alt+K');
        expect(resolveAreaTranslationHotkey('custom', '')).toBe('Shift+Z');
        expect(resolveAreaTranslationHotkey('custom', 'cmd+k')).toBe('Shift+Z');
        // 显示名称跟随平台习惯：macOS 写作 Control/Option，其他系统写作 Ctrl/Alt。
        expect(['Ctrl+Shift+K', 'Control+Shift+K']).toContain(areaTranslationHotkeyDisplayName('custom', 'ctrl+shift+k'));
        expect(areaTranslationHotkeyDisplayName('Shift+X', '')).toBe('Shift+X');
    });

    it('按已配置的组合键匹配事件，修饰键必须完全一致', () => {
        const shiftZ = keyboardEvent({key: 'Z', code: 'KeyZ', shiftKey: true});
        expect(matchesAreaTranslationHotkey(shiftZ, 'Shift+Z', '')).toBe(true);
        expect(matchesAreaTranslationHotkey(keyboardEvent({key: 'z', code: 'KeyZ'}), 'Shift+Z', '')).toBe(false);
        expect(matchesAreaTranslationHotkey(keyboardEvent({key: 'Z', code: 'KeyZ', shiftKey: true, altKey: true}), 'Shift+Z', '')).toBe(false);
        expect(matchesAreaTranslationHotkey(shiftZ, 'custom', 'Alt+X')).toBe(false);
        // macOS 上 Option+X 会把 key 变成不可配置字形，匹配必须回退到物理 code。
        expect(matchesAreaTranslationHotkey(keyboardEvent({key: '≈', code: 'KeyX', altKey: true}), 'custom', 'Alt+X')).toBe(true);
    });
});

describe('圈选翻译按需入口', () => {
    class FocusElement extends EventTarget {
        isContentEditable = false;
        editableAncestor = false;
        tabIndexEnabled = false;
        shadowRoot: {activeElement: FocusElement | null} | null = null;
        constructor(readonly tagName: string, private readonly role: string | null = null) { super(); }
        closest(selector: string): FocusElement | null { return selector.includes('contenteditable') && this.editableAncestor ? this : null; }
        getAttribute(name: string): string | null { return name === 'role' ? this.role : null; }
        hasAttribute(name: string): boolean { return name === 'tabindex' && this.tabIndexEnabled; }
        contains(target: EventTarget | null): boolean { return target === this; }
    }
    const settings = {on: true, selectionAreaEnabled: true, selectionAreaHotkey: 'Shift+Z', customSelectionAreaHotkey: ''};

    it('仅可信且不在编辑器中的快捷键会创建覆盖层', () => {
        vi.stubGlobal('HTMLElement', FocusElement);
        vi.stubGlobal('Node', FocusElement);
        try {
            const body = new FocusElement('BODY');
            const input = new FocusElement('INPUT');
            const button = new FocusElement('BUTTON');
            const opaqueHost = new FocusElement('MY-EDITOR');
            const roleEditor = new FocusElement('DIV', 'textbox');
            const nestedEditor = new FocusElement('SPAN');
            nestedEditor.editableAncestor = true;
            const focusContainer = new FocusElement('DIV');
            focusContainer.tabIndexEnabled = true;
            const openShadowHost = new FocusElement('MY-WIDGET');
            openShadowHost.shadowRoot = {activeElement: button};
            const doc = {activeElement: body, getElementById: () => null} as unknown as Document;
            const event = (target: FocusElement, overrides: Record<string, unknown> = {}) => ({
                key: 'Z', code: 'KeyZ', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
                isTrusted: true, repeat: false, isComposing: false, target,
                composedPath: () => [target], ...overrides,
            }) as unknown as KeyboardEvent;

            expect(shouldStartAreaTranslationFromHotkey(event(body), settings, doc)).toBe(true);
            expect(shouldStartAreaTranslationFromHotkey(event(body, {isTrusted: false}), settings, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(body, {repeat: true}), settings, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(body, {key: 'X', code: 'KeyX'}), settings, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(input), settings, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(roleEditor), settings, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(nestedEditor), settings, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(body, {composedPath: () => [new EventTarget(), body]}), settings, doc)).toBe(true);
            expect(shouldStartAreaTranslationFromHotkey(event(button), settings, {...doc, activeElement: button} as unknown as Document)).toBe(true);
            expect(shouldStartAreaTranslationFromHotkey(event(body), settings, {...doc, activeElement: focusContainer} as unknown as Document)).toBe(true);
            expect(shouldStartAreaTranslationFromHotkey(event(body), settings, {...doc, activeElement: openShadowHost} as unknown as Document)).toBe(true);
            expect(shouldStartAreaTranslationFromHotkey(event(body), settings, {...doc, activeElement: null} as unknown as Document)).toBe(true);
            expect(shouldStartAreaTranslationFromHotkey(event(body), settings, {...doc, activeElement: opaqueHost} as unknown as Document)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(body), {...settings, on: false}, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(body), {...settings, selectionAreaEnabled: false}, doc)).toBe(false);
            expect(shouldStartAreaTranslationFromHotkey(event(body), settings, {
                ...doc, getElementById: () => body,
            } as unknown as Document)).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('圈选翻译区域几何', () => {
    it('支持从任意方向拖拽，并把矩形限制在视口内', () => {
        expect(normalizeAreaRect({ x: 500, y: 400 }, { x: -20, y: 40 }, { width: 480, height: 360 })).toEqual({
            left: 0,
            top: 40,
            width: 480,
            height: 320,
        });
        expect(normalizeAreaRect({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { x: 8, y: 9 }, { width: Number.NaN, height: 0 })).toEqual({
            left: 0,
            top: 0,
            width: 1,
            height: 1,
        });
    });

    it('过滤过小的误触区域', () => {
        expect(isUsableAreaRect({ left: 0, top: 0, width: 11, height: 40 })).toBe(false);
        expect(isUsableAreaRect({ left: 0, top: 0, width: 12, height: 12 })).toBe(true);
    });

    it('把 CSS 视口矩形映射为高 DPI 截图像素坐标', () => {
        expect(areaRectToImageCrop({
            left: 50,
            top: 25,
            width: 200,
            height: 100,
            viewportWidth: 500,
            viewportHeight: 250,
        }, 1000, 500)).toEqual({ left: 100, top: 50, width: 400, height: 200 });
    });
});
