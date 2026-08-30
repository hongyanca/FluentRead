/**
 * @file src/core/translation/adapters/hackernews.ts
 *
 * 文件职责：声明 Hacker News 列表和评论页面的站点级候选规则，识别标题、正文与评论等有阅读价值的文本。
 * 主要内容：导出 hackerNewsAdapter，通过声明式选择器描述目标与排除区域，使紧凑表格布局仍使用与其他站点一致的候选决策接口。 可核对的公开符号包括 hackerNewsAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

export const hackerNewsAdapter = createDeclarativeAdapter({
    id: 'hacker-news',
    priority: 380,
    hosts: ['news.ycombinator.com'],
    targets: [
        {
            selector: '.titleline > a',
            reason: 'hacker-news-story-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: ['span.commtext', '.toptext'],
            reason: 'hacker-news-comment-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['.rank', '.sitestr', '.score', '.hnuser', '.age', '.subtext', '.pagetop'],
            reason: 'hacker-news-metadata',
        },
    ],
    mutationExclude: [
        {
            selector: ['.age', '.score'],
            reason: 'hacker-news-dynamic-metadata',
        },
    ],
});
