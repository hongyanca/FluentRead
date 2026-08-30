import {describe, expect, it} from 'vitest';
import {
    isAreaTranslatorMounted,
    isYouTubeVideoPage,
    mountAreaTranslator,
    mountImageTranslator,
    mountNewApiComponent,
    mountVideoSubtitleTranslation,
    unmountAreaTranslator,
    unmountImageTranslator,
    unmountNewApiComponent,
} from '@/userscript/unsupportedCapabilities';

describe('userscript extension-only capability stubs', () => {
    it('never mounts area, image, or video runtimes', () => {
        expect(isAreaTranslatorMounted()).toBe(false);
        expect(mountAreaTranslator()).toBeUndefined();
        expect(mountImageTranslator()).toBeUndefined();
        expect(unmountAreaTranslator()).toBeUndefined();
        expect(unmountImageTranslator()).toBeUndefined();
        expect(mountNewApiComponent()).toBeUndefined();
        expect(unmountNewApiComponent()).toBeUndefined();
        expect(mountVideoSubtitleTranslation()()).toBeUndefined();
        expect(isYouTubeVideoPage()).toBe(false);
    });
});
