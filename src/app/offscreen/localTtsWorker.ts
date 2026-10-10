/**
 * @file src/app/offscreen/localTtsWorker.ts
 * 文件职责：作为本地 TTS Worker 产物的应用层组合根，把 WXT unlisted script 入口连接到本地语音 feature。
 * 主要内容：仅以 startLocalTtsWorkerApp 名称转出 Kokoro 合成 Worker 的启动函数，保持入口文件只依赖 app 层。
 * 模块边界：不加载模型、不处理合成消息，也不决定在线或本地朗读策略；Worker 协议与推理生命周期归 local-tts feature。
 */
export {startLocalTtsWorker as startLocalTtsWorkerApp} from '@/src/features/local-tts/offscreen/tts.worker';
