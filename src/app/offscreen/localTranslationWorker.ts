/**
 * @file src/app/offscreen/localTranslationWorker.ts
 *
 * 文件职责：作为本地翻译 Worker 的应用入口，转出翻译 feature 的 Worker 启动函数。
 * 主要内容：保持 WXT Worker 入口与本地翻译 Worker 实现解耦，供扩展 Offscreen 页面按 URL 创建。
 * 模块边界：只负责应用组合出口，不读取配置、不管理模型缓存，也不处理 Worker 消息。
 */
export {startLocalTranslationWorker as startLocalTranslationWorkerApp} from '@/src/features/local-translation/offscreen/translation.worker';
