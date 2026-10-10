/**
 * @file entrypoints/localTranslationWorker.ts
 * 文件职责：声明本地翻译 Worker 的独立 WXT 产物。
 */
import {startLocalTranslationWorkerApp} from '@/src/app/offscreen/localTranslationWorker';

export default defineUnlistedScript(startLocalTranslationWorkerApp);
