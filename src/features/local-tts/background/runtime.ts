/**
 * @file src/features/local-tts/background/runtime.ts
 * 文件职责：装配本地 TTS 模型管理的后台消息 handler，作为 feature 内的后台组合根。
 * 主要内容：把共享 Offscreen 适配器和 browser.storage.local 读写端口注入 createLocalTtsBackgroundHandlers，并转出模型状态存储键。
 * 模块边界：只做依赖接线，不解析消息、不合成语音；handler 行为由 handlers.ts 负责，消息总入口由 app/background 注册。
 */

import {LOCAL_TTS_MODEL_STATE_KEY} from '@/src/core/config/localTts';
import {localTtsOffscreenAdapter} from './offscreenAdapter';
import {createLocalTtsBackgroundHandlers} from './handlers';

export function createLocalTtsBackgroundRuntime() {
    return createLocalTtsBackgroundHandlers({
        offscreen: localTtsOffscreenAdapter,
        storage: {
            get: async (key) => browser.storage.local.get(key),
            set: async (value) => { await browser.storage.local.set(value); },
        },
    });
}

export {LOCAL_TTS_MODEL_STATE_KEY};
