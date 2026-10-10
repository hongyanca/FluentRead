import {describe, expect, it, vi} from 'vitest';
import {normalizeConfig} from '@/src/core/config/model';
import {prepareAreaVisionRecognition} from '@/src/features/area-translation/services/textTranslation';
import {getTranslationImageInput, getTranslationProviderConfig, getTranslationRequestControl} from '@/src/services/translation/requestSnapshot';

const selection = {left: 0, top: 0, width: 20, height: 10, viewportWidth: 40, viewportHeight: 20};
const base = () => normalizeConfig({service: 'openai', areaTranslationService: 'openai', areaTranslationMode: 'standard',
    areaRecognitionMode: 'prefer-vision', areaVisionPrompt: 'Read the sign exactly.', model: {openai: 'gpt-4o'},
    modelVision: {openai: { 'gpt-4o': true }}, to: 'zh-Hans', token: {openai: 'secret'}});
const options = (signal = new AbortController().signal, timeoutMs = 10_000) => ({requestId: 'vision-1', signal, timeoutMs});

describe('圈选视觉识别事务', () => {
    it('冻结服务、模型、prompt、目标语言，并在 crop 后扣除预算', async () => {
        const source = base(); source.customModel.openai = ''; let now = 0;
        const crop = vi.fn(async () => { now = 250; return {image: 'data:image/png;base64,AA==', lines: []}; });
        const translate = vi.fn(async (request: any) => {
            expect(getTranslationImageInput(request)).toBe('data:image/png;base64,AA==');
            expect(request.targetLanguage).toBe('zh-Hans');
            expect(request.serviceOverride).toBe('openai');
            expect(typeof request.modelOverride).toBe('string');
            expect(getTranslationRequestControl(request)?.ownershipKey).toBe('area:vision-1:vision');
            return 'Hello';
        });
        const run = prepareAreaVisionRecognition(source, 'en', 'Page', crop, translate, () => now);
        source.to = 'ja'; source.model.openai = 'changed'; source.areaVisionPrompt = 'changed'; now = 100;
        await expect(run('data:image/png;base64,full', selection, options())).resolves.toMatchObject({sourceText: 'Hello', recognitionMethod: 'vision'});
        expect(translate).toHaveBeenCalledOnce();
        expect((translate.mock.calls[0][0] as any).requestTimeoutMs).toBe(9_750);
        const snapshot = getTranslationProviderConfig(translate.mock.calls[0][0], translate.mock.calls[0][0]);
        expect(snapshot.user_role.openai).toContain('Read the sign exactly.');
    });

    it.each(['', '   '])('空转录失败且不进入文本翻译: %j', async value => {
        const translate = vi.fn(async () => value);
        const crop = vi.fn(async () => ({image: 'data:image/png;base64,AA==', lines: []}));
        await expect(prepareAreaVisionRecognition(base(), 'en', '', crop, translate)('image', selection, options())).rejects.toThrow('未返回有效文字');
        expect(translate).toHaveBeenCalledOnce();
    });

    it('不把“没有可识别文字”占位符当成可翻译原文', async () => {
        const translate = vi.fn(async () => '[无可识别文字]');
        const crop = vi.fn(async () => ({image: 'data:image/png;base64,AA==', lines: []}));
        await expect(prepareAreaVisionRecognition(base(), 'en', '', crop, translate)('image', selection, options()))
            .rejects.toThrow('未返回有效文字');
    });

    it('拒绝数组结果、超长结果和视觉网络错误，不调用 OCR', async () => {
        const crop = vi.fn(async () => ({image: 'data:image/png;base64,AA==', lines: []}));
        const translate = vi.fn<() => Promise<string | string[]>>(async () => ['bad']);
        await expect(prepareAreaVisionRecognition(base(), 'en', '', crop, translate)('image', selection, options())).rejects.toThrow('未返回有效文字');
        translate.mockResolvedValueOnce('x'.repeat(12_001));
        await expect(prepareAreaVisionRecognition(base(), 'en', '', crop, translate)('image', selection, options())).rejects.toThrow('文字过多');
        translate.mockRejectedValueOnce(new Error('auth failed'));
        await expect(prepareAreaVisionRecognition(base(), 'en', '', crop, translate)('image', selection, options())).rejects.toThrow('auth failed');
        expect(crop).toHaveBeenCalledTimes(3);
    });

    it('crop 前预算耗尽时不发起 crop 或模型请求', async () => {
        const crop = vi.fn(async () => ({image: 'data:image/png;base64,AA==', lines: []}));
        const translate = vi.fn(async () => 'text');
        let now = 0;
        const run = prepareAreaVisionRecognition(base(), 'en', '', crop, translate, () => now);
        now = 10_001;
        await expect(run('image', selection, options(undefined, 10_000)))
            .rejects.toThrow('总时间已耗尽');
        expect(crop).not.toHaveBeenCalled();
        expect(translate).not.toHaveBeenCalled();
    });

    it.each(['before', 'after-crop', 'after-model'] as const)('取消阶段 %s 不返回结果', async stage => {
        const controller = new AbortController();
        const crop = vi.fn(async () => {
            if (stage === 'after-crop') controller.abort();
            return {image: 'data:image/png;base64,AA==', lines: []};
        });
        const translate = vi.fn(async () => { if (stage === 'after-model') controller.abort(); return 'text'; });
        if (stage === 'before') controller.abort();
        await expect(prepareAreaVisionRecognition(base(), 'en', '', crop, translate)('image', selection, options(controller.signal))).rejects.toMatchObject({name: 'AbortError'});
        if (stage === 'before') expect(crop).not.toHaveBeenCalled();
    });
});
