/**
 * @file src/core/translation/adapters/gnu.ts
 *
 * 文件职责：声明 GNU 在线手册页面的翻译候选边界，让章节正文进入统一翻译核心并排除目录或结构性区域。
 * 主要内容：导出 gnuManualAdapter，以 GNU 手册的 host 与 DOM 选择器配置声明式适配器，不自行遍历文本或渲染译文。 可核对的公开符号包括 gnuManualAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

/** Texinfo HTML 的上一页/下一页导航面板只使用普通 div，需要通过站点规则明确排除。 */
export const gnuManualAdapter = createDeclarativeAdapter({
    id: 'gnu-manual',
    priority: 360,
    hosts: [{hostname: 'gnu.org', includeSubdomains: true}],
    prune: [
        {
            selector: '.nav-panel',
            reason: 'gnu-manual-navigation',
        },
    ],
    targets: [
        {
            selector: [
                '.section-level-extent > p',
                '.chapter-level-extent > p',
                '.subsection-level-extent > p',
            ],
            reason: 'gnu-manual-prose',
            match: 'closest',
        },
    ],
});
