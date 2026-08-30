/**
 * @file src/features/full-page-translation/core/errorMessage.ts
 * 文件职责：把底层翻译异常字符串转换成适合全文翻译失败提示的中文用户文案，并在需要时带上当前翻译服务名称。
 * 主要内容：函数识别凭据未配置、请求超时、网络错误、频率限制、额度不足、服务异常等常见模式，返回可操作且不暴露内部堆栈的提示文本。
 * 模块边界：这是无副作用的错误文案映射，不记录日志、不打开设置也不处理重试；错误 UI 由 translationIndicators 调用，provider 原始异常的产生和分类属于服务层。
 */
/**
 * 把 provider 错误转成面向用户的全文翻译提示。
 *
 * 该函数不读取全局配置，由 UI glue 传入当前服务名，因此可以独立单测。
 */
export function getTranslationErrorMessage(errMsg: string, serviceLabel: string): string {
  const normalizedError = errMsg.toLowerCase();

  if (/^当前翻译服务/u.test(errMsg) || /请求 ID：|\bHTTP\s+\d{3}\b/iu.test(errMsg)) {
    return errMsg;
  }
  if (/需要\s+(?:API Key|访问令牌|App Key|App Secret|SecretId|SecretKey).+当前尚未(?:完整)?配置/iu.test(errMsg)) {
    return errMsg;
  }
  if (errMsg.includes('尚未配置') || errMsg.includes('还没有配置')) {
    return '当前翻译服务还没有配置 API Key，请前往设置页面填写后再试。';
  }
  if (normalizedError.includes('auth failed')
    || normalizedError.includes('api key')
    || normalizedError.includes('unauthorized')
    || errMsg.includes('访问令牌')
    || errMsg.includes('鉴权')) {
    return errMsg;
  }
  if (normalizedError.includes('quota')
    || normalizedError.includes('limit')
    || normalizedError.includes('429')
    || errMsg.includes('配额')
    || errMsg.includes('频率')) {
    return `你的请求频率过高，被【${serviceLabel}】拒绝了，请稍后再试吧~`;
  }
  if (normalizedError.includes('network error')
    || normalizedError.includes('networkerror')
    || normalizedError.includes('failed to fetch')
    || errMsg.includes('网络连接失败')) {
    return '网络连接好像不稳定，请检查网络后再试。';
  }
  if (normalizedError.includes('model') || errMsg.includes('模型')) {
    return '模型配置可能有误，请前往设置页面进行检查和调整。';
  }
  if (normalizedError.includes('timeout')
    || normalizedError.includes('timed out')
    || errMsg.includes('超时')) {
    return '请求超时啦，请稍后再试一次。';
  }
  return errMsg || '出现了未知错误，请前往开源社区联系开发者吧~';
}
