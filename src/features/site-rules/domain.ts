/**
 * @file src/features/site-rules/domain.ts
 * 文件职责：保留网站规则 feature 下的域名算法公共入口，让设置和页面生命周期代码通过业务语义路径访问统一的站点匹配实现。
 * 主要内容：文件完整再导出 src/core/site-rules/domain 中的基础域名提取、规范化与规则匹配等纯函数，不定义第二套规则或状态。
 * 模块边界：这是单向门面，不读取 location、配置或 Public Suffix 数据之外的浏览器状态；算法权威实现位于 core，站点启停与自动翻译编排由 app/content 和 settings UI 完成。
 */
/** 网站规则 feature 对纯域名算法的公开出口。 */
export * from '@/src/core/site-rules/domain';
