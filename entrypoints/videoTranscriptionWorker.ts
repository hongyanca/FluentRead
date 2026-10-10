/**
 * @file entrypoints/videoTranscriptionWorker.ts
 * 文件职责：声明本地字幕模型的独立 WXT Worker 产物。
 * 主要内容：将离屏应用组合根注册为 unlisted script，供 Offscreen 按 URL 创建 Worker。
 * 模块边界：只负责构建入口元数据，模型推理和 Worker 消息归视频 feature 管理。
 */
import {startVideoTranscriptionWorkerApp} from '@/src/app/offscreen/videoTranscriptionWorker';
export default defineUnlistedScript(startVideoTranscriptionWorkerApp);
