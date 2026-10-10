/**
 * @file src/features/video-subtitle/content/youtubeHumanCaptions.ts
 * 文件职责：读取 YouTube 目标语言人工字幕，供现有双语显示与下载优先使用。
 * 主要内容：选择当前视频的人工轨、取消过期请求、限制失败重试，并按播放时间读取目标语言原始时间轴。
 * 模块边界：网络函数由调用者注入，不切换原生字幕语言、不覆盖原文轨，也不调用翻译服务。
 */
import {chooseTargetHumanCaptionTrack} from './platforms';
import {buildYoutubeTimedTextUrl, extractYoutubeCaptionTracks, getYoutubeVideoId, parseYoutubeTimedTextResponse, finalizeVideoSubtitleCues, type VideoSubtitleCue} from './youtubeSubtitleData';
import {selectVideoSubtitleCueAtOffset} from './subtitleLogic';

export class YoutubeHumanCaptions {
    private key = '';
    private cues: VideoSubtitleCue[] = [];
    private controller: AbortController | undefined;
    private retryAt = 0;
    private pending: Promise<void> | undefined;
    private requestUrl = '';
    constructor(private readonly request: typeof fetch, private readonly onReady: () => void) {}

    sync(root: ParentNode, location: Pick<Location, 'hostname' | 'pathname' | 'search'>, target: string, enabled: boolean): void {
        const id = getYoutubeVideoId(location);
        const track = enabled && id ? chooseTargetHumanCaptionTrack(extractYoutubeCaptionTracks(root, id), target) : null;
        const key = track ? `${id}:${target}:${track.baseUrl}` : '';
        if (key !== this.key) { this.clear(); this.key = key; }
        if (!track || this.cues.length || this.pending || Date.now() < this.retryAt) return;
        let url: URL;
        try { url = new URL(buildYoutubeTimedTextUrl(track)); } catch { return; }
        // 初始化脚本是页面数据；只请求本站的 timedtext，不信任任意 baseUrl。
        if (url.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== '/api/timedtext') return;
        this.requestUrl = url.href;
        const controller = new AbortController();
        this.controller = controller;
        const pending = (async () => {
            try {
                const response = await this.request(url.href, {credentials: 'include', signal: controller.signal});
                if (!response.ok) throw new Error('人工字幕暂不可用');
                const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(await response.text()));
                if (controller.signal.aborted || this.key !== key) return;
                if (!cues.length) throw new Error('人工字幕为空');
                this.cues = cues;
                this.onReady();
            } catch {
                if (!controller.signal.aborted && this.key === key) this.retryAt = Date.now() + 5000;
            }
        })();
        this.pending = pending;
        void pending.finally(() => { if (this.pending === pending) this.pending = undefined; });
    }

    at(timeMs: number): string {
        return selectVideoSubtitleCueAtOffset(this.cues, timeMs, 0)?.text || '';
    }

    ownsUrl(url: string): boolean {
        if (!this.requestUrl) return false;
        try {
            const parsed = new URL(url);
            const base = new URL(this.requestUrl);
            return parsed.origin === base.origin && parsed.pathname === base.pathname
                && parsed.searchParams.get('v') === base.searchParams.get('v')
                && parsed.searchParams.get('lang') === base.searchParams.get('lang')
                && parsed.searchParams.get('kind') === base.searchParams.get('kind')
                && !parsed.searchParams.has('tlang');
        } catch { return false; }
    }

    async ready(): Promise<void> { await this.pending; }

    clear(): void {
        this.controller?.abort();
        this.controller = undefined;
        this.pending = undefined;
        this.key = '';
        this.requestUrl = '';
        this.cues = [];
        this.retryAt = 0;
    }
}
