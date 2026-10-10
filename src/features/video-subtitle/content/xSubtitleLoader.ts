/**
 * @file src/features/video-subtitle/content/xSubtitleLoader.ts
 * 文件职责：为单个 X 播放器加载原生字幕资源，隔离媒体替换前后的网络结果。
 * 主要内容：限制 HLS 资源并发与体积、选取单一语言，切换媒体时取消请求并丢弃迟到结果。
 * 模块边界：通过注入 fetch 和 cue 回调工作，不查找页面播放器、不持久化字幕也不执行翻译。
 */
import {isXSubtitleResourceUrl, parseXSubtitleResource, selectXSubtitleLanguageResources, type XSubtitleResource} from './xVideoSubtitleData';
import {readBoundedMediaResponse} from './hlsAudio';
import type {VideoSubtitleCue} from './youtubeSubtitleData';

interface LoadJob { resource: XSubtitleResource; text?: string; generation: number }

export class XSubtitleLoader {
    private generation = 0;
    private controller = new AbortController();
    private readonly visited = new Set<string>();
    private queue: LoadJob[] = [];
    private active = 0;

    constructor(private readonly options: {
        fetch(url: string, options: {signal: AbortSignal}): Promise<Response>;
        language(): string;
        onCues(url: string, cues: VideoSubtitleCue[]): void;
    }) {}

    reset(): void {
        this.generation += 1;
        this.controller.abort();
        this.controller = new AbortController();
        this.queue = [];
        this.visited.clear();
    }

    load(resource: XSubtitleResource, text?: string): void {
        if (!isXSubtitleResourceUrl(resource.url) || this.visited.has(resource.url) || this.visited.size >= 96) return;
        this.visited.add(resource.url);
        this.queue.push({resource, text, generation: this.generation});
        this.pump();
    }

    private pump(): void {
        while (this.active < 3 && this.queue.length > 0) {
            const job = this.queue.shift()!;
            this.active += 1;
            void this.run(job, this.controller.signal).catch(() => undefined).finally(() => {
                this.active -= 1;
                this.pump();
            });
        }
    }

    private async run(job: LoadJob, signal: AbortSignal): Promise<void> {
        let source = job.text;
        if (source === undefined) {
            const response = await this.options.fetch(job.resource.url, {signal});
            if (!response.ok || Number(response.headers.get('content-length')) > 1_000_000) return;
            source = new TextDecoder().decode(await readBoundedMediaResponse(response, 1_000_000, signal));
        }
        if (signal.aborted || job.generation !== this.generation || source.length > 1_000_000) return;
        const parsed = parseXSubtitleResource(source, job.resource.url, job.resource.offsetMs);
        if (parsed.cues.length) this.options.onCues(job.resource.url, parsed.cues);
        const languages = parsed.resources.filter(resource => resource.languageCode);
        const resources = languages.length > 0
            ? selectXSubtitleLanguageResources(languages, this.options.language())
            : parsed.resources;
        for (const resource of resources.slice(0, 32)) this.load(resource);
    }
}
