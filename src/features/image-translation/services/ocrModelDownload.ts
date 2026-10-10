/**
 * @file src/features/image-translation/services/ocrModelDownload.ts
 * 文件职责：在 Tesseract.js 加载语言包之前，先把尚未缓存的识别模型带真实字节进度地下载好，让语言包下载不再只有转圈。
 * 主要内容：按 Tesseract.js 的 LSTM 数据地址流式下载缺失的 traineddata，同一语言包的多个模型并行接收并合并为一条进度，解压后写入引擎自己的缓存；已缓存的模型直接跳过。
 * 模块边界：这里只是带进度的快速通道，不创建 Worker、不记录下载状态；任何失败都不在这里报错，随后由 Tesseract.js 按原有路径加载并给出最终结论。
 */
import {createDownloadProgressTracker, type DownloadProgress} from '@/src/core/download/progress';
import {withModelDownload} from '@/src/platform/http/modelDownloads';
import {listCachedOcrModelFiles, writeOcrModelFile} from './ocrModelCache';

/** 与 Tesseract.js 6 在仅 LSTM 引擎下的默认语言数据地址一致；ocrRuntime 未自定义 langPath。 */
const OCR_MODEL_SOURCE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const OCR_MODEL_VARIANT = '4.0.0_best_int';
const OCR_MODEL_DOWNLOAD_TIMEOUT_MS = 120_000;

export function getOcrModelFileUrl(language: string): string {
    return `${OCR_MODEL_SOURCE}/${language}/${OCR_MODEL_VARIANT}/${language}.traineddata.gz`;
}

async function gunzip(response: Response): Promise<Uint8Array> {
    const unpacked = response.body!.pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(unpacked).arrayBuffer());
}

export async function prefetchOcrModelFiles(
    languages: readonly string[],
    options: {signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void} = {},
): Promise<void> {
    // 取消、断网、存储不可用都交给随后的 Tesseract.js 加载处理，避免同一失败出现两种提示。
    const cached = await listCachedOcrModelFiles(languages).catch(() => languages);
    const missing = languages.filter(language => !cached.includes(language));
    // 各模型的响应头几乎同时到达，总大小随即确定；在那之前不给出百分比。
    const tracker = createDownloadProgressTracker(missing.length, 0, progress => options.onProgress?.(progress));
    // 等全部模型结束后再返回：个别失败时其余下载不会在调用方收尾之后继续回报进度。
    await Promise.allSettled(missing.map(async (language) => {
        const progress = tracker.file();
        const data = await withModelDownload(getOcrModelFileUrl(language), gunzip, {
            signal: options.signal,
            timeoutMs: OCR_MODEL_DOWNLOAD_TIMEOUT_MS,
            onProgress: progress.advance,
        });
        await writeOcrModelFile(language, data);
        progress.complete();
    }));
}
