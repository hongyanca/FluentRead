import {createImageTranslationBackgroundHandlers} from '@/src/features/image-translation/background/handlers';
import {describe, expect, it, vi} from 'vitest';

import {createImageOcrLanguageRepository} from '@/src/features/image-translation/background/ocrLanguageRepository';
import {IMAGE_OCR_LANGUAGE_STATE_KEY} from '@/src/features/image-translation/ocrLanguages';

describe('图片后台服务', () => {
    it('共享识别资源管理在能力缺失时明确失败，存在时返回状态并完成清理', async () => {
        const dependencies={assertLanguagesDownloaded:vi.fn(),translateImage:vi.fn(),fetchImage:vi.fn(),translateTexts:vi.fn(),getTranslationService:()=> 'google',supportsBatchTranslation:()=>false,downloadLanguages:vi.fn(),markLanguagesDownloaded:vi.fn()};
        const call=(extra: object,type: 'fluentReadMangaModelStatus'|'fluentReadMangaModelRemove')=>createImageTranslationBackgroundHandlers({...dependencies,...extra}).find(h=>h.type===type)!.handle({type});
        await expect(call({},'fluentReadMangaModelStatus')).rejects.toThrow('管理不可用');
        await expect(call({},'fluentReadMangaModelRemove')).rejects.toThrow('管理不可用');
        await expect(call({getMangaModelStatus:async()=>({ready:true,bytes:30,inpaintingReady:false})},'fluentReadMangaModelStatus')).resolves.toEqual({success:true,ready:true,bytes:30,inpaintingReady:false});
        const removeMangaModels=vi.fn(async()=>{});await expect(call({removeMangaModels},'fluentReadMangaModelRemove')).resolves.toEqual({success:true});expect(removeMangaModels).toHaveBeenCalledOnce();
    });
    it('普通图片按已保存引擎选择语言资源，漫画保持独立专用链路', async () => {
        let engine: 'paddle' | 'tesseract'='paddle';
        const translated = vi.fn(async (_image: string, _language: string, _title: string, _options: object) => ({image:'data:image/png,x',lines:[]}));
        const dependencies={getImageOcrEngine:()=>engine,assertLanguagesDownloaded:vi.fn(async()=>{}),translateImage:translated,fetchImage:vi.fn(),translateTexts:vi.fn(),getTranslationService:()=> 'google',supportsBatchTranslation:()=>false,downloadLanguages:vi.fn(),markLanguagesDownloaded:vi.fn()};
        const handler=createImageTranslationBackgroundHandlers(dependencies).find(h=>h.type==='fluentReadImageTranslate')!;
        const message={type:'fluentReadImageTranslate' as const,image:'data:image/png,x',sourceLanguage:'ja'};
        await handler.handle(message);expect(dependencies.assertLanguagesDownloaded).not.toHaveBeenCalled();
        expect(translated).toHaveBeenLastCalledWith(message.image,'ja','',expect.objectContaining({ocrEngine:'paddle'}));
        expect(translated.mock.calls.at(-1)?.[3]).not.toHaveProperty('manga');
        engine='tesseract';await handler.handle(message);expect(dependencies.assertLanguagesDownloaded).toHaveBeenCalledWith('ja');
        expect(translated.mock.calls.at(-1)?.[3]).not.toHaveProperty('ocrEngine');
        dependencies.assertLanguagesDownloaded.mockClear();await handler.handle({...message,manga:true});
        expect(dependencies.assertLanguagesDownloaded).not.toHaveBeenCalled();expect(translated).toHaveBeenLastCalledWith(message.image,'ja','',expect.objectContaining({manga:true}));
    });
    it('OCR 语言仓库归一化读取并合并持久化下载状态', async () => {
        const get = vi.fn(async () => ({
            [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'bad', 'eng'],
        }));
        const set = vi.fn(async () => undefined);
        const repository = createImageOcrLanguageRepository({get, set});

        await expect(repository.getDownloaded()).resolves.toEqual(['eng']);
        await expect(repository.markDownloaded(['chi_sim', 'eng'])).resolves.toEqual(['eng', 'chi_sim']);
        expect(get).toHaveBeenCalledWith(IMAGE_OCR_LANGUAGE_STATE_KEY);
        expect(set).toHaveBeenCalledWith({
            [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'chi_sim'],
        });
    });

    it('OCR 语言仓库串行合并并发下载结果，避免后写覆盖先写', async () => {
        let downloaded: unknown = [];
        let releaseFirstWrite!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let allowFirstWrite!: () => void;
        const firstWriteGate = new Promise<void>((resolve) => {
            allowFirstWrite = resolve;
        });
        let writeCount = 0;
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: downloaded,
            })),
            set: vi.fn(async (values: Record<string, unknown>) => {
                writeCount += 1;
                if (writeCount === 1) {
                    releaseFirstWrite();
                    await firstWriteGate;
                }
                downloaded = values[IMAGE_OCR_LANGUAGE_STATE_KEY];
            }),
        };
        const repository = createImageOcrLanguageRepository(storage);

        const english = repository.markDownloaded(['eng']);
        await firstWriteStarted;
        const chinese = repository.markDownloaded(['chi_sim']);
        await Promise.resolve();
        expect(storage.get).toHaveBeenCalledOnce();

        allowFirstWrite();
        await expect(english).resolves.toEqual(['eng']);
        await expect(chinese).resolves.toEqual(['eng', 'chi_sim']);
        expect(downloaded).toEqual(['eng', 'chi_sim']);
        expect(storage.get).toHaveBeenCalledTimes(2);
    });

    it('OCR 语言仓库在一次持久化失败后仍会继续后续合并', async () => {
        let downloaded: unknown = ['eng'];
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: downloaded,
            })),
            set: vi.fn()
                .mockRejectedValueOnce(new Error('write failed'))
                .mockImplementationOnce(async (values: Record<string, unknown>) => {
                    downloaded = values[IMAGE_OCR_LANGUAGE_STATE_KEY];
                }),
        };
        const repository = createImageOcrLanguageRepository(storage);

        await expect(repository.markDownloaded(['chi_sim'])).rejects.toThrow('write failed');
        await expect(repository.markDownloaded(['jpn'])).resolves.toEqual(['eng', 'jpn']);
        expect(downloaded).toEqual(['eng', 'jpn']);
    });

    it('OCR 语言仓库允许已安装组合并报告缺失语言包中文名', async () => {
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng'],
            })),
            set: vi.fn(async () => undefined),
        };
        const repository = createImageOcrLanguageRepository(storage);

        await expect(repository.assertDownloaded('en')).resolves.toBeUndefined();
        await expect(repository.assertDownloaded('zh-Hans')).rejects.toThrow(
            '图片文字识别需要先下载简体中文语言包，请前往设置 > 图片翻译下载',
        );
        storage.get.mockResolvedValueOnce({});
        await expect(repository.assertDownloaded('auto')).rejects.toThrow('简体中文、繁體中文、English');
        storage.get.mockResolvedValueOnce({[IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'chi_sim']});
        await expect(repository.assertDownloaded('zh-TW')).rejects.toThrow('繁體中文语言包');
        storage.get.mockResolvedValueOnce({[IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'chi_tra']});
        await expect(repository.assertDownloaded('zh-Hant')).resolves.toBeUndefined();
    });
});


describe('OCR 语言包任务的用户可见状态', () => {
    function harness() {
        const downloaded = new Set<string>();
        const dependencies = {
            assertLanguagesDownloaded: async () => {}, translateImage: async () => ({}), fetchImage: async () => '',
            getTranslationService: () => 'google', supportsBatchTranslation: () => false, translateTexts: async () => '',
            getDownloadedLanguages: vi.fn(async () => [...downloaded] as any),
            downloadLanguages: vi.fn(async (_codes: string[]) => {}),
            markLanguagesDownloaded: vi.fn(async (codes: string[]) => {codes.forEach(code => downloaded.add(code)); return [...downloaded] as any;}),
            removeLanguages: vi.fn(async (_codes: string[]) => {}),
            markLanguagesRemoved: vi.fn(async (codes: string[]) => {codes.forEach(code => downloaded.delete(code)); return [...downloaded] as any;}),
        };
        const handlers = createImageTranslationBackgroundHandlers(dependencies);
        const request = (type: string, languages?: string[]) => handlers.find(handler => handler.type === type)!.handle({type, languages} as any);
        return {dependencies, request, downloaded};
    }
    it('下载器返回非 Error 失败仍保留可读错误，旧适配器缺少状态读取时安全返回空快照', async () => {
        const {request, dependencies} = harness();
        dependencies.downloadLanguages.mockRejectedValueOnce('network unavailable');
        await expect(request('fluentReadImageOcrDownload', ['eng'])).rejects.toBe('network unavailable');
        expect(await request('fluentReadImageOcrStatus')).toMatchObject({states: {eng: {phase: 'error', error: 'network unavailable'}}});
        const {getDownloadedLanguages: _read, ...legacy} = dependencies;
        const handler = createImageTranslationBackgroundHandlers(legacy).find(item => item.type === 'fluentReadImageOcrStatus')!;
        expect(await handler.handle({type: 'fluentReadImageOcrStatus'})).toEqual({success: true, languages: [], states: {}});
    });
    it('并发重复下载合并为单包任务，并显示真实排队与执行状态', async () => {
        const {request, dependencies} = harness();
        let finish!: () => void;
        dependencies.downloadLanguages.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const first = request('fluentReadImageOcrDownload', ['eng', 'jpn']);
        const duplicate = request('fluentReadImageOcrDownload', ['eng']);
        await vi.waitFor(() => expect(dependencies.downloadLanguages).toHaveBeenCalledTimes(1));
        expect(await request('fluentReadImageOcrStatus')).toMatchObject({languages: [], states: {eng: {phase: 'downloading'}, jpn: {phase: 'queued'}}});
        finish();
        await Promise.all([first, duplicate]);
        expect(dependencies.downloadLanguages.mock.calls).toEqual([[['eng']], [['jpn']]]);
        expect(await request('fluentReadImageOcrStatus')).toMatchObject({languages: ['eng', 'jpn'], states: {}});
        await request('fluentReadImageOcrDownload', ['eng']);
        expect(dependencies.downloadLanguages).toHaveBeenCalledTimes(2);
    });
    it('中途失败保留前后成功项，只重试缺失包并清理行内错误', async () => {
        const {request, dependencies} = harness();
        dependencies.downloadLanguages.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('offline'));
        await expect(request('fluentReadImageOcrDownload', ['eng', 'jpn', 'fra'])).rejects.toThrow('offline');
        expect(await request('fluentReadImageOcrStatus')).toMatchObject({languages: ['eng', 'fra'], states: {jpn: {phase: 'error', error: 'offline'}}});
        await request('fluentReadImageOcrDownload', ['eng', 'jpn', 'fra']);
        expect(dependencies.downloadLanguages.mock.calls).toEqual([[['eng']], [['jpn']], [['fra']], [['jpn']]]);
        expect(await request('fluentReadImageOcrStatus')).toMatchObject({languages: ['eng', 'fra', 'jpn'], states: {}});
    });
    it('下载后排队移除再下载，最后一次用户操作胜出', async () => {
        const {request, dependencies, downloaded} = harness();
        let finish!: () => void;
        dependencies.downloadLanguages.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const first = request('fluentReadImageOcrDownload', ['eng']);
        await vi.waitFor(() => expect(dependencies.downloadLanguages).toHaveBeenCalledOnce());
        const remove = request('fluentReadImageOcrRemove', ['eng']);
        const last = request('fluentReadImageOcrDownload', ['eng']);
        finish();
        await Promise.all([first, remove, last]);
        expect(dependencies.downloadLanguages).toHaveBeenCalledTimes(2);
        expect(downloaded.has('eng')).toBe(true);
    });
    it('旧下载失败不会移除后来排队的重试，重试期间仍能合并重复请求', async () => {
        const {request, dependencies, downloaded} = harness();
        let fail!: (error: Error) => void;
        let finishRetry!: () => void;
        dependencies.downloadLanguages
            .mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}))
            .mockImplementationOnce(() => new Promise(resolve => {finishRetry = resolve;}));
        const first = request('fluentReadImageOcrDownload', ['eng']);
        const failed = expect(first).rejects.toThrow('offline');
        await vi.waitFor(() => expect(dependencies.downloadLanguages).toHaveBeenCalledOnce());
        const remove = request('fluentReadImageOcrRemove', ['eng']);
        const retry = request('fluentReadImageOcrDownload', ['eng']);
        fail(new Error('offline'));
        await failed;
        await vi.waitFor(() => expect(dependencies.downloadLanguages).toHaveBeenCalledTimes(2));
        const duplicate = request('fluentReadImageOcrDownload', ['eng']);
        finishRetry();
        await Promise.all([remove, retry, duplicate]);
        expect(dependencies.downloadLanguages).toHaveBeenCalledTimes(2);
        expect(downloaded.has('eng')).toBe(true);
        expect(await request('fluentReadImageOcrStatus')).toMatchObject({languages: ['eng'], states: {}});
    });
});
