/**
 * @file src/core/translation/adapters/github.ts
 *
 * 文件职责：声明 GitHub 页面翻译适配规则，使 Markdown 正文、议题和评论成为候选，同时避开代码、导航及交互控件。
 * 主要内容：通过 createDeclarativeAdapter 配置 githubAdapter，集中列出 Markdown prose 等 GitHub 特有选择器，并将站点差异转换为通用 pass、skip 或 target 决策。 可核对的公开符号包括 githubAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

const markdownProseSelectors = [
    '.markdown-body p',
    '.markdown-body h1',
    '.markdown-body h2',
    '.markdown-body h3',
    '.markdown-body h4',
    '.markdown-body h5',
    '.markdown-body h6',
    '.markdown-body li',
    '.markdown-body blockquote',
    '.markdown-body figcaption',
    '.markdown-body summary',
    '.markdown-body dt',
    '.markdown-body dd',
    '.markdown-body th',
    '.markdown-body td',
] as const;

export const githubAdapter = createDeclarativeAdapter({
    id: 'github',
    priority: 500,
    hosts: [{hostname: 'github.com', includeSubdomains: false}],
    prune: [
        {
            selector: [
                'dialog',
                '[role="dialog"]',
                '[data-testid="search-modal"]',
                '[data-target="query-builder.queryBuilder"]',
                '[data-target="qbsearch-input.queryBuilder"]',
                '.js-command-palette-dialog',
                '#command-palette-pjax-container',
            ],
            reason: 'github-interactive-dialog',
        },
        {
            selector: [
                'form[role="search"]',
                '.js-site-search-form',
                'input[data-target="qbsearch-input.inputButton"]',
            ],
            reason: 'github-quick-search',
        },
    ],
    targets: [
        {
            selector: '.markdown-title',
            reason: 'github-markdown-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: [
                'h1.gh-header-title .js-issue-title',
                '[data-testid="issue-title"]',
                '[data-testid="pull-request-title"]',
                '[data-testid="issue-pr-title-link"]',
            ],
            reason: 'github-issue-or-pr-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: markdownProseSelectors,
            reason: 'github-markdown-prose',
            match: 'closest',
        },
        {
            selector: [
                '[itemprop="about"]',
                '[itemprop="description"]',
                '[data-testid="repository-description"]',
                '.repo-description p',
                '.repos-list-description',
                'p.f4.my-3',
            ],
            reason: 'github-repository-description',
            match: 'closest',
            atomic: true,
        },
    ],
    keepOriginal: [
        {
            selector: [
                '[aria-live]',
                '[role="status"]',
                '[role="alert"]',
                '[data-turbo-permanent]',
                '[data-turbo-temporary]',
                'relative-time',
                'time-ago',
                'local-time',
            ],
            reason: 'github-mutation-owned',
        },
    ],
    mutationExclude: [
        {
            selector: [
                'dialog',
                '[role="dialog"]',
                'form[role="search"]',
                '[aria-live]',
                '[role="status"]',
                '[role="alert"]',
                '[data-turbo-permanent]',
                '[data-turbo-temporary]',
                'relative-time',
                'time-ago',
                'local-time',
            ],
            reason: 'github-controlled-mutation',
        },
    ],
});
