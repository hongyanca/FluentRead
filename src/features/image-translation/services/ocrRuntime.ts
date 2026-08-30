/**
 * @file src/features/image-translation/services/ocrRuntime.ts
 * 文件职责：将 Tesseract.js Worker 适配为图片翻译可调用的 OCR 服务，配置扩展内 worker/core 资源并按源语言串行执行识别或语言包预下载。
 * 主要内容：创建具体 OcrWorkerPort，设置 PSM、logger 和语言资源路径，导出 recognizeImage 与 downloadImageOcrLanguages，并把原始识别结果交给 core 的 OCR 行规范化。
 * 模块边界：该文件是 Tesseract 基础设施边界，不保存下载状态、不翻译识别文本也不绘制图片；并发所有权由 ocrWorkerRuntime 管理，持久化由后台 repository 负责。
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { getOcrLanguages, normalizeOcrLines, type OcrLine } from '@/src/features/image-translation/core';
import type { ImageOcrLanguageCode } from '@/src/features/image-translation/ocrLanguages';
import { createOcrWorkerRuntime, type OcrWorkerPort } from './ocrWorkerRuntime';

function extensionAsset(path: string): string {
    const getRuntimeUrl = chrome.runtime.getURL as (assetPath: string) => string;
    return getRuntimeUrl(`/fluent-read-ocr/${path}`);
}

type TesseractRecognitionResult = Awaited<ReturnType<Worker['recognize']>>;

const ocrWorkerRuntime = createOcrWorkerRuntime<TesseractRecognitionResult>({
    sparseTextMode: PSM.SPARSE_TEXT,
    createWorker: async languages => createWorker(languages, 1, {
        workerPath: extensionAsset('worker/worker.min.js'),
        corePath: extensionAsset('core'),
        cachePath: 'fluent-read-image-ocr',
        // 不再把 traineddata 打进扩展；Tesseract.js 会从 jsDelivr 按需下载，
        // 并将解压后的语言包缓存到 Offscreen Document 的 IndexedDB。
        // Offscreen 页面拥有扩展源，直接加载本地 worker 可避免 Blob Worker 的 CSP/源限制。
        workerBlobURL: false,
    }) as unknown as Promise<OcrWorkerPort<TesseractRecognitionResult>>,
});

export async function recognizeImage(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    const languages = getOcrLanguages(sourceLanguage).join('+');
    const result = await ocrWorkerRuntime.recognize(image, languages);
    return normalizeOcrLines(result.data.blocks);
}

export async function downloadImageOcrLanguages(languages: ImageOcrLanguageCode[]): Promise<void> {
    await ocrWorkerRuntime.ensureLanguages(languages);
}
