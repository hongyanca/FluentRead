/**
 * @file src/app/offscreen/videoTranscriptionWorker.ts
 * 文件职责：作为离屏识别 Worker 的应用入口，装配独立 Whisper 运行环境。
 * 主要内容：加载视频 feature 的 Worker 协议实现，让 WXT 输出独立可终止的识别脚本。
 * 模块边界：此入口不包含模型选择或字幕算法，Worker 生命周期和消息处理位于视频 feature。
 */
export {startVideoTranscriptionWorker as startVideoTranscriptionWorkerApp} from '@/src/features/video-subtitle/offscreen/transcription.worker';
