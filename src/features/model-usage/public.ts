/**
 * @file src/features/model-usage/public.ts
 * 文件职责：提供模型用量 feature 的稳定公开入口，让设置页面无需依赖内部 UI 文件结构即可挂载统计面板。
 * 主要内容：集中导出 ModelUsageDashboard Vue 组件，作为 Options 设置编排层与模型用量界面的唯一连接点。
 * 模块边界：本文件不查询统计、不访问浏览器消息或保存筛选状态；数据交互和展示逻辑均封装在 feature 内部组件中。
 */
export {default as ModelUsageDashboard} from './ui/ModelUsageDashboard.vue'
