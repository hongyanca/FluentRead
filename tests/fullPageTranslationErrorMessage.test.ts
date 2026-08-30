import {describe, expect, it} from 'vitest';

import {getTranslationErrorMessage} from '@/src/features/full-page-translation/core/errorMessage';

describe('全文翻译错误文案', () => {
  it.each([
    ['当前翻译服务的 API Key 无效', '当前翻译服务的 API Key 无效'],
    ['请求 ID：abc-123', '请求 ID：abc-123'],
    ['Provider 拒绝请求（HTTP 403）', 'Provider 拒绝请求（HTTP 403）'],
    ['DeepSeek 需要 API Key，当前尚未配置', 'DeepSeek 需要 API Key，当前尚未配置'],
    ['DeepSeek 尚未配置', '当前翻译服务还没有配置 API Key，请前往设置页面填写后再试。'],
    ['当前还没有配置', '当前翻译服务还没有配置 API Key，请前往设置页面填写后再试。'],
    ['auth failed', 'auth failed'],
    ['invalid api key', 'invalid api key'],
    ['unauthorized request', 'unauthorized request'],
    ['访问令牌已过期', '访问令牌已过期'],
    ['鉴权失败', '鉴权失败'],
    ['quota exceeded', '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~'],
    ['rate limit', '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~'],
    ['HTTP-like 429 marker', '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~'],
    ['配额不足', '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~'],
    ['请求频率过高', '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~'],
    ['network error', '网络连接好像不稳定，请检查网络后再试。'],
    ['networkerror', '网络连接好像不稳定，请检查网络后再试。'],
    ['failed to fetch', '网络连接好像不稳定，请检查网络后再试。'],
    ['网络连接失败', '网络连接好像不稳定，请检查网络后再试。'],
    ['model not found', '模型配置可能有误，请前往设置页面进行检查和调整。'],
    ['模型不可用', '模型配置可能有误，请前往设置页面进行检查和调整。'],
    ['timeout', '请求超时啦，请稍后再试一次。'],
    ['timed out', '请求超时啦，请稍后再试一次。'],
    ['请求超时', '请求超时啦，请稍后再试一次。'],
    ['provider unavailable', 'provider unavailable'],
    ['', '出现了未知错误，请前往开源社区联系开发者吧~'],
  ])('归类 %s', (message, expected) => {
    expect(getTranslationErrorMessage(message, 'DeepSeek')).toBe(expected);
  });
});
