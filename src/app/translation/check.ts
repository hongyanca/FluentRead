/**
 * @file src/app/translation/check.ts
 * 文件职责：在内容侧翻译调用前执行最小配置可用性检查，并对模型输出做统一后处理，向页面用户反馈可操作错误。
 * 主要内容：根据服务类型验证自定义模型和必需模型选择，使用 page-notice 发送中文提示；contentPostHandler 调用 stripTranslationReasoning 去除推理标记后返回净化文本。
 * 模块边界：本文件不验证受保护凭据、不发起请求，也不决定 provider endpoint；可信凭据检查在后台或 extension page，网络与重试由 translation/client 负责。
 */
import {customModelString, services, servicesType} from '@/src/core/config/catalog';
import {stripTranslationReasoning} from '@/src/core/translation/prompts';
import {config} from '@/src/services/config/store';
import {sendErrorMessage} from '@/src/features/page-notice/public';

// 翻译前检查配置。
export function checkConfig(): boolean {
    // 步骤 1：检查插件是否启用。
    if (!config.on) return false;

    // 凭据保存在扩展 session 存储中，按设计不向 content script 暴露。
    // 后台会在调用 provider 前，于请求边界完成校验。

    // 检查要求模型的服务是否已完成选择。
    if (servicesType.isUseModel(config.service)) {
        const model = config.model[config.service];
        const customModel = config.customModel[config.service];
        if (!model || (model === customModelString && !customModel)) {
            sendErrorMessage("模型尚未配置，请前往设置页配置");
            return false;
        }
    }

    // 部分翻译服务要求启用“双语模式”。
    if (config.display === 0 && config.service === services.google) {
        sendErrorMessage("「谷歌翻译」仅支持双语模式，请切换翻译服务");
        return false;
    }

    return true;
}

export function contentPostHandler(text: string) {
    return stripTranslationReasoning(text);
}
