/**
 * @file src/core/translation/adapters/youtube.ts
 *
 * 文件职责：声明 YouTube 页面正文区域的翻译适配规则，识别标题、说明与评论，同时避开播放器控制和导航框架。
 * 主要内容：导出 youtubeAdapter，通过声明式 host 与 selector 规则补充通用布局判断，使页面翻译不侵入字幕或媒体播放逻辑。 可核对的公开符号包括 youtubeAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

export const youtubeAdapter = createDeclarativeAdapter({
    id: 'youtube',
    priority: 370,
    hosts: [
        {hostname: 'youtube.com', includeSubdomains: true},
        'youtu.be',
    ],
    prune: [
        {
            selector: [
                '#movie_player',
                'ytd-live-chat-frame',
                'yt-live-chat-app',
                'ytd-video-preview',
            ],
            reason: 'youtube-player-or-live-ui',
        },
        {
            selector: ['input#search', 'ytd-comment-simplebox-renderer'],
            reason: 'youtube-text-input',
        },
    ],
    targets: [
        {
            selector: 'ytd-watch-metadata h1 yt-formatted-string',
            reason: 'youtube-video-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: [
                '#description-inline-expander yt-attributed-string',
                'ytd-text-inline-expander yt-attributed-string',
            ],
            reason: 'youtube-description',
            match: 'closest',
        },
        {
            selector: [
                'ytd-comment-view-model #content-text',
                'ytd-comment-renderer #content-text',
            ],
            reason: 'youtube-comment',
            match: 'closest',
        },
        {
            selector: 'ytd-transcript-segment-renderer .segment-text',
            reason: 'youtube-transcript-segment',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['#owner-sub-count', '#info span', 'yt-formatted-string#vote-count-middle'],
            reason: 'youtube-dynamic-metadata',
        },
    ],
});
