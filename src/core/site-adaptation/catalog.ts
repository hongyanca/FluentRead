/**
 * @file src/core/site-adaptation/catalog.ts
 * 文件职责：静态组装 FluentRead 自有网站适配目录，让构建产物、设置预览和候选引擎使用同一份 JSON。
 * 主要内容：合并已经建立回归契约的专用规则、分类网站规则与单层结构模板，导出版本化内置规则包。
 * 模块边界：仅依赖数据与领域类型，不读取用户配置、不联网更新目录，也不在导入时操作 DOM。
 */
import established from './catalog/established.json';
import websites from './catalog/websites.json';
import profiles from './catalog/profiles.json';
import type {SiteRulePack} from './types';

/** 内置包与用户导出的包遵循相同契约；新增网站只需修改 JSON 并补充验证。 */
export const builtinSiteRulePack = Object.freeze({
    version: 1,
    profiles,
    rules: [...established, ...websites],
}) as SiteRulePack;
