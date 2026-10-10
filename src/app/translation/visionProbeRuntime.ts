/**
 * @file src/app/translation/visionProbeRuntime.ts
 * 文件职责：把识图探测服务装配到现有共享翻译 broker 与独立本地存储。
 * 主要内容：提供扩展后台及 userscript 共用的单例，所有探测走真实 provider 的图片传输、密钥轮换、请求限流、取消和用量记录。
 * 模块边界：只做静态依赖接线，探测策略、随机图片和存储各自由 services/core/platform 拥有。
 */
import {createModelVisionProbe} from '@/src/services/translation/visionProbe';
import {visionProbeStorage} from '@/src/platform/storage/visionProbeStorage';
import {translateWithCache} from './runtime';
export const modelVisionProbe = createModelVisionProbe({translate: translateWithCache, storage: visionProbeStorage});
