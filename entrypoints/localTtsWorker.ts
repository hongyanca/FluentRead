/**
 * @file entrypoints/localTtsWorker.ts
 * 文件职责：声明本地 TTS Worker 的独立 WXT 产物。
 * 主要内容：同步调用应用启动函数，使 WXT 收集入口元数据时能够移除运行时导入。
 * 模块边界：只注册 Worker 入口，模型与消息生命周期归 app 和 feature。
 */
import {startLocalTtsWorkerApp} from '@/src/app/offscreen/localTtsWorker';

export default defineUnlistedScript(() => {
    startLocalTtsWorkerApp();
});
