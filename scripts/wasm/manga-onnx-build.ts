import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
const require = createRequire(import.meta.url);

/** 复用已锁定的 Kokoro ONNX 版本；所有浏览器推理端口及 Tensor 使用同一 ABI，静态 glue 单独打包。 */
export function sharedOnnxBuildPlugin() {
    const transformers = createRequire(require.resolve('@huggingface/transformers-kokoro'));
    const ort = transformers.resolve('onnxruntime-web/webgpu');
    const ortRequire = createRequire(ort);
    const common = ortRequire.resolve('onnxruntime-common');
    return {
        name: 'fluentread-shared-onnx',
        enforce: 'pre' as const,
        resolveId(source: string) {
            if (source === 'onnxruntime-web' || source === 'onnxruntime-web/webgpu') {
                return resolve(dirname(ort), 'ort.webgpu.min.mjs');
            }
            if (source === 'onnxruntime-common') {
                return resolve(dirname(common), '../esm/index.js');
            }
            return null;
        },
    };
}

export function sharedOnnxDist(): string {
    const transformers = createRequire(require.resolve('@huggingface/transformers-kokoro'));
    return dirname(transformers.resolve('onnxruntime-web/webgpu'));
}
