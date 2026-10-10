/**
 * @file src/app/offscreen/mangaInferenceWorker.ts
 * 文件职责：将静态漫画 Worker 入口连接到图片翻译 feature。
 * 主要内容：转出启动函数，供 WXT 独立模块入口绑定消息生命周期。
 * 模块边界：不加载模型、不处理消息和图片；推理与资源限制归 feature 和 shared。
 */
export {startMangaInferenceWorker as startMangaInferenceWorkerApp} from '@/src/features/image-translation/services/mangaInference.worker';
