import {describe, expect, it, vi} from 'vitest';
import {
    createOcrWorkerRuntime,
    type OcrWorkerPort,
} from '@/src/features/image-translation/services/ocrWorkerRuntime';

type RecognitionResult = {worker: string; image: string};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return {promise, resolve, reject};
}

function createWorker(name: string): OcrWorkerPort<RecognitionResult> {
    return {
        setParameters: vi.fn(async () => undefined),
        recognize: vi.fn(async image => ({worker: name, image})),
        terminate: vi.fn(async () => undefined),
    };
}

describe('OCR worker runtime', () => {
    it('复用同语言 Worker，并为每次识别设置稀疏文本参数', async () => {
        const worker = createWorker('eng');
        const factory = vi.fn(async () => worker);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await expect(runtime.recognize('first', 'eng')).resolves.toEqual({worker: 'eng', image: 'first'});
        await expect(runtime.recognize('second', 'eng')).resolves.toEqual({worker: 'eng', image: 'second'});

        expect(factory).toHaveBeenCalledOnce();
        expect(worker.setParameters).toHaveBeenCalledTimes(2);
        expect(worker.setParameters).toHaveBeenLastCalledWith({
            tessedit_pageseg_mode: 11,
            preserve_interword_spaces: '1',
        });
        expect(worker.recognize).toHaveBeenLastCalledWith('second', {}, {blocks: true});
    });

    it('等待正在进行的识别结束后才终止 Worker 并切换语言', async () => {
        const firstRecognition = deferred<RecognitionResult>();
        const english = createWorker('eng');
        const japanese = createWorker('jpn');
        vi.mocked(english.recognize).mockReturnValueOnce(firstRecognition.promise);
        const factory = vi.fn(async languages => languages === 'eng' ? english : japanese);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 'sparse'});

        const recognizing = runtime.recognize('active', 'eng');
        await vi.waitFor(() => expect(english.recognize).toHaveBeenCalledOnce());
        const switching = runtime.recognize('next', 'jpn');

        await Promise.resolve();
        expect(english.terminate).not.toHaveBeenCalled();
        expect(factory).toHaveBeenCalledTimes(1);

        firstRecognition.resolve({worker: 'eng', image: 'active'});
        await expect(recognizing).resolves.toEqual({worker: 'eng', image: 'active'});
        await expect(switching).resolves.toEqual({worker: 'jpn', image: 'next'});
        expect(english.terminate).toHaveBeenCalledOnce();
        expect(factory).toHaveBeenLastCalledWith('jpn');
    });

    it('串行化同 Worker 的并发识别，防止参数与识别调用交叉', async () => {
        const firstRecognition = deferred<RecognitionResult>();
        const worker = createWorker('eng');
        vi.mocked(worker.recognize).mockReturnValueOnce(firstRecognition.promise);
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async () => worker),
            sparseTextMode: 11,
        });

        const first = runtime.recognize('first', 'eng');
        await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledOnce());
        const second = runtime.recognize('second', 'eng');
        await Promise.resolve();
        expect(worker.setParameters).toHaveBeenCalledOnce();

        firstRecognition.resolve({worker: 'eng', image: 'first'});
        await expect(first).resolves.toEqual({worker: 'eng', image: 'first'});
        await expect(second).resolves.toEqual({worker: 'eng', image: 'second'});
        expect(worker.setParameters).toHaveBeenCalledTimes(2);
    });

    it('下载语言包也等待识别结束，并忽略旧 Worker 的终止异常', async () => {
        const recognition = deferred<RecognitionResult>();
        const english = createWorker('eng');
        const packs = createWorker('packs');
        vi.mocked(english.recognize).mockReturnValueOnce(recognition.promise);
        vi.mocked(english.terminate).mockRejectedValueOnce(new Error('already closed'));
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async languages => languages === 'eng' ? english : packs),
            sparseTextMode: 11,
        });

        const active = runtime.recognize('active', 'eng');
        await vi.waitFor(() => expect(english.recognize).toHaveBeenCalledOnce());
        const downloading = runtime.ensureLanguages(['chi_sim', 'eng']);
        expect(english.terminate).not.toHaveBeenCalled();

        recognition.resolve({worker: 'eng', image: 'active'});
        await active;
        await expect(downloading).resolves.toBeUndefined();
        expect(english.terminate).toHaveBeenCalledOnce();
    });

    it('空语言列表不创建 Worker', async () => {
        const factory = vi.fn(async () => createWorker('unused'));
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await expect(runtime.ensureLanguages([])).resolves.toBeUndefined();
        expect(factory).not.toHaveBeenCalled();
    });

    it('创建失败后清理状态，后续请求可以重试', async () => {
        const worker = createWorker('eng');
        const factory = vi.fn()
            .mockRejectedValueOnce(new Error('download failed'))
            .mockResolvedValueOnce(worker);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await expect(runtime.recognize('first', 'eng')).rejects.toThrow('download failed');
        await expect(runtime.recognize('retry', 'eng')).resolves.toEqual({worker: 'eng', image: 'retry'});
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('上一项识别失败后仍执行队列中的下一项', async () => {
        const worker = createWorker('eng');
        vi.mocked(worker.recognize)
            .mockRejectedValueOnce(new Error('recognize failed'))
            .mockResolvedValueOnce({worker: 'eng', image: 'second'});
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async () => worker),
            sparseTextMode: 11,
        });

        const first = runtime.recognize('first', 'eng');
        const second = runtime.recognize('second', 'eng');
        await expect(first).rejects.toThrow('recognize failed');
        await expect(second).resolves.toEqual({worker: 'eng', image: 'second'});
    });
});
