/**
 * @file src/core/translation/adapters/learnopengl.ts
 *
 * 文件职责：声明 LearnOpenGL 教程站点的内容结构规则，优先选择章节 prose 并保护代码示例、目录和页面控件。
 * 主要内容：导出 learnOpenGLAdapter，将教程正文相关 selector 交给 createDeclarativeAdapter，处理该站点特有的嵌套布局而不改变通用核心。 可核对的公开符号包括 learnOpenGLAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

/**
 * LearnOpenGL 的旧式图片导航使用固定高度菜单行。追加双语块会使相邻行重叠，
 * 甚至遮住点击目标，因此站点拥有的导航保持原样；`#content` 下的阅读区域
 * 仍可参与常规候选发现。
 */
export const learnOpenGLAdapter = createDeclarativeAdapter({
    id: 'learnopengl',
    priority: 300,
    hosts: [{hostname: 'learnopengl.com', includeSubdomains: true}],
    prune: [
        {
            selector: '#nav',
            reason: 'learnopengl-fixed-navigation',
        },
    ],
});
