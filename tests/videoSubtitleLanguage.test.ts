import {describe, expect, it} from 'vitest';

import {isVideoSubtitleInTargetLanguage} from '@/src/features/video-subtitle/content/subtitleLanguage';

describe('video subtitles already in the target language', () => {
  it('treats clear Simplified and Traditional Chinese as already readable for any Chinese target', () => {
    const traditional = '所以成進去的相機 然後基本上 這個東西 如果你要感受到';
    const simplified = '所以成进去的相机 然后基本上 这个东西 如果你要感受到';
    for (const target of ['zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW']) {
      expect(isVideoSubtitleInTargetLanguage(traditional, target), target).toBe(true);
      expect(isVideoSubtitleInTargetLanguage(simplified, target), target).toBe(true);
    }
    expect(isVideoSubtitleInTargetLanguage('對', 'zh-Hans')).toBe(true);
  });

  it('keeps translating uncertain or foreign subtitles for Chinese targets', () => {
    expect(isVideoSubtitleInTargetLanguage('This camera is really nice', 'zh-Hans')).toBe(false);
    expect(isVideoSubtitleInTargetLanguage('このカメラは本当にいいですね', 'zh-Hans')).toBe(false);
    expect(isVideoSubtitleInTargetLanguage('佢哋喺度食緊飯', 'zh-Hans')).toBe(false);
    expect(isVideoSubtitleInTargetLanguage('我用 iPhone 拍的 video', 'zh-Hans')).toBe(false);
    // 同时出现简繁冲突字形时无法确认，交给翻译服务。
    expect(isVideoSubtitleInTargetLanguage('这個東西', 'zh-Hans')).toBe(false);
  });

  it('uses the conservative global check for other targets', () => {
    expect(isVideoSubtitleInTargetLanguage('このカメラは本当にいいですね', 'ja')).toBe(true);
    expect(isVideoSubtitleInTargetLanguage('이 카메라 정말 좋네요', 'ko')).toBe(true);
    // 明确的短句与长句一样跳过；单个词无法区分语言，继续翻译。
    expect(isVideoSubtitleInTargetLanguage('This camera is great', 'en')).toBe(true);
    expect(isVideoSubtitleInTargetLanguage('Camera', 'en')).toBe(false);
    expect(isVideoSubtitleInTargetLanguage('So this is the camera we put inside, and basically if you want to feel it you need to hold it', 'en')).toBe(true);
    expect(isVideoSubtitleInTargetLanguage('这个东西如果你要感受到', 'en')).toBe(false);
  });
});
