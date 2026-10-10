/**
 * @file src/features/image-translation/services/mangaGpu.ts
 * 文件职责：为共享 ONNX Runtime 的漫画模型探测可用硬件 GPU。
 * 主要内容：复用有超时和软件适配器过滤的探测，不再用旧版运行时的 GPUDevice.adapterInfo 条件屏蔽可用硬件。
 * 模块边界：不创建模型或设备、不改变其他音频模型的兼容性要求；各漫画运行时负责初始化和推理失败回退。
 */
import {probeWebGpu,type WebGpuProbeResult} from '@/src/shared/onnx/webgpu';

export async function probeMangaGpu():Promise<WebGpuProbeResult> {
    return probeWebGpu();
}
