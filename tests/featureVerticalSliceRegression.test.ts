import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const projectRoot = resolve(__dirname, '..');

function source(path: string): string {
    return readFileSync(resolve(projectRoot, path), 'utf8');
}

describe('划词、圈选和图片翻译纵向切片回归', () => {
    it('WXT 内容入口只启动 app composition root，垂直功能由 app 静态组装', () => {
        const content = source('entrypoints/content.ts');
        const runtime = source('src/app/content/runtime.ts');
        const appFeatures = source('src/app/content/features.ts');

        expect(content).toContain("from '@/src/app/content/runtime'");
        expect(content).not.toContain('@/src/features/');
        expect(runtime).toContain("from './features'");
        expect(appFeatures).toContain("from '@/src/features/selection-translation/public'");
        expect(appFeatures).toContain("from '@/src/features/area-translation/public'");
        expect(appFeatures).toContain("from '@/src/features/image-translation/public'");
    });

    it('旧工具实现不再形成第二份运行时真源', () => {
        for (const path of [
            'entrypoints/utils/selectionTranslator.ts',
            'entrypoints/utils/areaTranslator.ts',
            'entrypoints/utils/areaTranslationClient.ts',
            'entrypoints/utils/imageTranslation.ts',
            'entrypoints/utils/imageOcrClient.ts',
            'entrypoints/utils/imageFetch.ts',
            'entrypoints/utils/imageInpainting.ts',
            'entrypoints/offscreen/imageOcr.ts',
            'components/SelectionTranslator.vue',
            'components/AreaTranslator.vue',
        ]) {
            expect(existsSync(resolve(projectRoot, path)), path).toBe(false);
        }
    });

    it('扩展后台和 offscreen 从 app 层进入图片翻译，userscript 精确替换不支持的浏览器功能', () => {
        const background = source('entrypoints/background.ts');
        const messageRuntime = source('src/app/background/messageRuntime.ts');
        expect(background).toContain("@/src/app/background/runtime");
        expect(messageRuntime).toContain("from './handlers/imageTranslation'");
        expect(messageRuntime).toContain("@/src/features/image-translation/background/offscreenAdapter");
        expect(messageRuntime).toContain("@/src/features/area-translation/background/offscreenAdapter");
        expect(background).not.toContain("@/src/features/image-translation/background");
        expect(source('entrypoints/offscreen/main.ts')).toContain("@/src/app/offscreen/runtime");
        expect(source('src/app/offscreen/runtime.ts')).toContain("from './imageTranslation'");
        expect(existsSync(resolve(projectRoot, 'entrypoints/offscreen/imageTranslation.ts'))).toBe(false);
        expect(source('src/app/offscreen/imageTranslation.ts')).toContain("@/src/features/image-translation/services/ocrRuntime");
        expect(source('src/app/offscreen/imageTranslation.ts')).toContain("@/src/features/image-translation/services/offscreenRuntime");
        const offscreenImageRuntime = source('src/features/image-translation/services/offscreenRuntime.ts');
        expect(offscreenImageRuntime).toContain("from '@/src/features/area-translation/protocol'");
        expect(offscreenImageRuntime).not.toContain("from '@/src/features/area-translation/public'");
        expect(offscreenImageRuntime).not.toContain('services/config/store');
        expect(source('src/features/area-translation/background/offscreenAdapter.ts'))
            .toContain("@/src/features/image-translation/public");
        expect(source('src/features/area-translation/background/offscreenAdapter.ts'))
            .not.toContain("@/src/features/image-translation/services/");

        const userscriptConfig = source('userscript/vite.config.ts');
        expect(userscriptConfig).toContain("find: '@/src/features/area-translation/public'");
        expect(userscriptConfig).toContain("find: '@/src/features/image-translation/public'");
        expect(userscriptConfig).toContain("find: '@/src/features/video-subtitle/public'");
        expect(userscriptConfig).not.toContain("find: '@/entrypoints/utils/areaTranslator'");
        expect(userscriptConfig).not.toContain("find: '@/entrypoints/utils/imageTranslation'");
    });

    it('OCR 下载把接收端初始化故障与真实资源下载失败分开提示', () => {
        const settings = source('src/features/image-translation/ui/ImageOcrSettings.vue');
        expect(settings).toContain('OCR 服务初始化失败，请重新打开设置页后重试。');
        expect(settings).toContain("message.includes('Receiving end does not exist')");
        expect(settings).toContain('请检查网络后重试');
    });
});
