/**
 * @file src/features/share-card/public.ts
 * 文件职责：提供双语分享卡片的稳定公共入口，让内容组合层与划词结果复用同一工作台。
 * 主要内容：导出功能挂载、卸载、状态查询和以原译文打开卡片的动作。
 * 模块边界：不在模块加载时创建 DOM、持久化数据或注册监听器；不导出内部渲染状态。
 */
export {mountShareCard, unmountShareCard, isShareCardMounted, openShareCard} from './content/runtime';
