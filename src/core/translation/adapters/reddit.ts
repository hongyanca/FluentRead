/**
 * @file src/core/translation/adapters/reddit.ts
 *
 * 文件职责：声明 Reddit 页面中帖子与评论文本的翻译适配规则，限制候选在用户可读内容而非导航或操作区。
 * 主要内容：导出 redditAdapter，以 host 和站点 DOM selector 建立声明式规则，供候选引擎按照统一优先级和安全守卫执行。 可核对的公开符号包括 redditAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

export const redditAdapter = createDeclarativeAdapter({
    id: 'reddit',
    priority: 390,
    hosts: [
        {hostname: 'reddit.com', includeSubdomains: true},
        {hostname: 'redd.it', includeSubdomains: true},
    ],
    prune: [
        {
            selector: ['reddit-composer', '[data-testid="comment-submission-form"]'],
            reason: 'reddit-composer',
        },
    ],
    targets: [
        {
            selector: ['shreddit-post [slot="title"]', 'h1[id^="post-title-"]'],
            reason: 'reddit-post-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: [
                'shreddit-post [slot="text-body"] p',
                '[data-testid="post-content"] p',
                '[data-click-id="text"] p',
            ],
            reason: 'reddit-post-prose',
            match: 'closest',
        },
        {
            selector: [
                'shreddit-comment [slot="comment"] p',
                '[data-testid="comment"] p',
            ],
            reason: 'reddit-comment-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['faceplate-timeago', '[data-testid="post_timestamp"]', '[data-testid="vote-arrows"]'],
            reason: 'reddit-dynamic-metadata',
        },
    ],
    mutationExclude: [
        {
            selector: [
                'faceplate-timeago',
                '[data-testid="post_timestamp"]',
                '[data-testid="vote-arrows"]',
                'shreddit-status',
                '[aria-live]',
            ],
            reason: 'reddit-controlled-mutation',
        },
    ],
});
