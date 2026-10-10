/**
 * @file src/features/image-translation/failure.ts
 * 文件职责：定义图片文字翻译失败的稳定原因和可执行提示，避免跨后台、Offscreen 和页面传递时只剩嵌套错误文案。
 * 主要内容：校验本地模型错误键、序列化失败响应、还原错误对象，并提供语言方向、下载、运行与服务切换建议。
 * 模块边界：只处理错误数据，不读取配置、不切换模型、不发起网络或浏览器导航；控件与运行时负责用户操作。
 */
export const IMAGE_LOCAL_FAILURES = ['language', 'notDownloaded', 'removed', 'browser', 'timeout', 'repetition', 'failed'] as const;
export type ImageLocalFailure = typeof IMAGE_LOCAL_FAILURES[number];

export function imageTranslationFailureCode(value: unknown): ImageLocalFailure | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as {errorCode?: unknown; localTranslationErrorKey?: unknown};
    if (IMAGE_LOCAL_FAILURES.some(code => code === record.errorCode)) return record.errorCode as ImageLocalFailure;
    const key = record.localTranslationErrorKey;
    if (key === 'settings.localTranslation.trialError') return 'failed';
    if (typeof key !== 'string' || !key.startsWith('settings.localTranslation.error.')) return undefined;
    const code = key.slice('settings.localTranslation.error.'.length);
    return IMAGE_LOCAL_FAILURES.some(value => value === code) ? code as ImageLocalFailure : undefined;
}

export function createImageTranslationFailure(message: string, value: unknown): Error {
    const errorCode = imageTranslationFailureCode(value);
    return Object.assign(new Error(message), errorCode ? {errorCode} : {});
}

export function imageTranslationFailureResponse(error: unknown) {
    const errorCode = imageTranslationFailureCode(error);
    return {success: false as const, error: error instanceof Error ? error.message : String(error),
        ...(errorCode ? {errorCode} : {})};
}

export function imageLocalFailureMessage(code: ImageLocalFailure): string {
    switch (code) {
        case 'language': return '图片文字已识别，但当前本地模型无法翻译这个语言方向。短词或混合语言也可能影响自动检测。请确认原语言和目标语言，选择支持该方向的本地模型，或切换图片翻译服务。';
        case 'notDownloaded': case 'removed': return '图片文字已识别，但所选本地翻译模型尚未准备好。请在翻译服务设置中完成模型下载，或切换图片翻译服务，再回来重试。';
        case 'browser': return '图片文字已识别，但当前浏览器无法运行所选本地模型。请改用轻量本地模型或其他图片翻译服务，再回来重试。';
        case 'timeout': return '图片文字已识别，但本地模型翻译超时。请关闭占用内存的页面后重试，或改用轻量模型、其他图片翻译服务。';
        case 'repetition': return '图片文字已识别，但本地模型未生成完整可靠的译文。请尝试其他本地模型或图片翻译服务，再回来重试。';
        case 'failed': return '图片文字已识别，但本地模型翻译失败。请检查模型是否下载完成，尝试其他本地模型或图片翻译服务，再回来重试。';
    }
}
