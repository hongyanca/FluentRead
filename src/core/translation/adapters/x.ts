/**
 * @file src/core/translation/adapters/x.ts
 *
 * 文件职责：声明 X/Twitter 时间线与帖子详情的翻译候选规则，识别推文正文并排除指标、按钮和站点壳层。
 * 主要内容：导出 xAdapter，将 X 动态页面的特定 selector 表达为声明式适配决策，仍由通用核心负责文本提取和候选去重。 可核对的公开符号包括 xAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

export const xAdapter = createDeclarativeAdapter({
    id: 'x',
    priority: 400,
    hosts: [
        {hostname: 'x.com', includeSubdomains: true},
        {hostname: 'twitter.com', includeSubdomains: true},
    ],
    prune: [
        {
            selector: [
                '[data-testid="tweetTextarea_0"]',
                '[data-testid="DMComposerTextInput"]',
            ],
            reason: 'x-composer',
        },
        {
            selector: [
                '[data-testid="User-Name"]',
                '[data-testid="UserName"]',
            ],
            reason: 'x-user-name',
        },
    ],
    targets: [
        {
            selector: '[data-testid="tweetText"]',
            reason: 'x-post-text',
            match: 'closest',
        },
        {
            selector: '[data-testid="UserDescription"]',
            reason: 'x-user-description',
            match: 'closest',
        },
        {
            selector: '[data-testid="twitterArticleReadView"] p',
            reason: 'x-article-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['time', '[role="progressbar"]', '[data-testid="app-bar-back"]'],
            reason: 'x-dynamic-ui',
        },
    ],
});
