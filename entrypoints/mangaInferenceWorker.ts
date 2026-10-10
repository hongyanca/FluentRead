/**
 * @file entrypoints/mangaInferenceWorker.ts
 * 文件职责：声明漫画 OCR 与修补的静态模块 Worker 产物。
 * 主要内容：绑定独立 Worker 启动函数。
 * 模块边界：仅处理 WXT 入口声明，推理与生命周期归 app 和 feature。
 */
import {startMangaInferenceWorkerApp} from '@/src/app/offscreen/mangaInferenceWorker';
export default defineUnlistedScript(startMangaInferenceWorkerApp);
