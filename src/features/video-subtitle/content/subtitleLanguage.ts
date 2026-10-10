/**
 * @file src/features/video-subtitle/content/subtitleLanguage.ts
 * 文件职责：判断一条视频字幕是否已经是用户的目标语言，让运行时跳过请求并只显示原文一行。
 * 主要内容：中文目标把明确的简体与繁体中文都视为目标语言；其他目标使用统一语言识别，只在识别结论明确时跳过。
 * 模块边界：纯文本判定，不读取配置、不发起翻译，也不处理排除语言；单词、名称或不确定结果继续翻译。
 */
import {getChineseScript} from '@/src/core/language/chinese';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';

/**
 * 字幕只在画面上停留几秒，简繁转换后的第二行几乎与原文相同，只会遮挡画面。
 * 因此中文目标下，字形明确的简体或繁体中文都直接显示原文；粤语口语、日文或
 * 夹杂外语正文等无法确认的内容仍交给翻译服务。
 */
export function isVideoSubtitleInTargetLanguage(text: string, targetLanguage: string): boolean {
    if (getChineseScript(targetLanguage)) {
        return shouldSkipTranslationForTarget(text, 'zh-Hans', ['zh-Hant']);
    }
    return shouldSkipTranslationForTarget(text, targetLanguage);
}
