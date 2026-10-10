/**
 * @file tests/chineseTechnicalParagraphs.test.ts
 * 用户在 PR #779 的中文技术段落重复翻译：保留截图原文，验证名称、术语、单位、参数及仓库引用
 * 不改变中文归属；同时保留外语正文、引文、短歧义词和简繁转换。全部调用真实识别器。
 */
import {describe, expect, it} from 'vitest';
import paragraphs from './fixtures/chinese-technical-paragraphs.json';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import {clearLanguageIdentificationCache, identifyTextLanguage} from '@/src/core/language/identify';

const technical = [
    ...paragraphs,
    '把初始化日志级别降为 debug，其他警告保持原级别。',
    '将运行日志级别设为 trace，便于检查任务状态。',
    '这项更新采用 userscript 构建并保留原有配置。',
    '这项更新支持 manifest verifier 校验，确保安装正常。',
    '这项更新使用 novabrowser 浏览器验证按钮状态。',
    '这项更新为 lumina 插件增加了配置持久化。',
    '这项更新增加 atlas engine 引擎并检查缓存行为。',
    '这项更新增加 flux runtime 环境并验证原文恢复。',
    '在 Orion、Nebula 浏览器中检查扩展布局和链接。',
    '生产 Chrome、Firefox 构建与链接检查均已通过。',
    '生产 Chromium、Safari 构建与配置检查均已通过。',
    '这项更新完成 release 构建，并保留原有的设置。',
    '这项更新使用 worker 模块处理缓存读取和错误恢复。',
    '这项更新使用 offscreen 环境执行模型推理。',
    '这项更新使用 bridge 接口传递任务状态和设置。',
    '这项更新使用 tokenizer 模型处理输入内容。',
    '这项更新使用 playwright 测试检查设置持久化。',
    '这项更新使用 webdriver 验证页面翻译与恢复。',
    '这项更新使用 webassembly 环境处理模型推理。',
    '这项更新使用 vitepress 构建中英文文档。',
    '这项更新使用 eslint 校验，类型检查已经通过。',
    '这项更新使用 prettier 配置，并保留原有偏好。',
    '这项更新包含 linux/arm64 构建与安装包校验。',
    '这项更新包含 web/runtime verifier 校验与链接检查。',
    '这项更新安装 novabrowser，并重新验证页面布局。',
    '这项更新运行 inspector，检查缓存和原文恢复。',
    '这项更新在隔离环境中执行 benchmark，检查性能变化。',
    '这项更新加载 tokenizer，并检查模型推理状态。',
    '这项更新导出 settings，保留原有设置内容。',
    '这项更新无 console error，恢复后原文内容保持完整。',
    '这项更新无 memory leak，卸载时清理任务监听器。',
    '这项更新使用 MANGA Plus 章节验证漫画按钮交互。',
    '这项更新使用 NOVA Pro 模型验证识别与缓存行为。',
    '这项更新使用 LocalAI chat 模型检查回复格式。',
    'Firefox 只验证构建，尚未发布商店版本。',
    'Nebula 仅验证构建，尚未发布商店版本。',
];
const units = ['px', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax', 'ms', 's', 'Hz', 'kHz', 'MHz', 'GHz', 'KB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB', 'TiB'];
technical.push(...units.map(unit => `这项更新把配置数值设为 40 ${unit}，其他设置保持原状。`));
technical.push(...[
    'microsoft/onnxruntime#27399', 'vuejs/core#12345', 'owner/repo-name#2026', 'owner.name/repo_name#42',
    'vendor=0', 'vendor = 0', 'threads=-1', 'ratio=0.25', 'enabled=true', 'enabled=false', 'value=null',
].map(identifier => `这项更新确认 ${identifier} 是技术标识，原有设置和行为保持。`));

const traditional = [
    '這項更新將初始化日誌級別降為 debug，其他警告保持原級別。',
    '這項更新支援 userscript 構建與設定持久化。',
    '這項更新採用 novabrowser 瀏覽器驗證按鈕狀態。',
    '這項更新採用 flux runtime 環境並檢查原文恢復。',
    '這項更新新增 lumina 插件並保留原有設定。',
    '這項更新採用 manifest verifier 校驗安裝內容。',
    '這項更新採用 worker 模組處理快取和資料。',
    '這項更新採用 offscreen 環境執行模型推理。',
    '這項更新無 console error，恢復後原文保持完整。',
    '這項更新採用 MANGA Plus 章節驗證漫畫按鈕。',
    '這項更新把參數設為 40 px，原有設定保持。',
    '這項更新確認 vendor=0 是初始化參數。',
    '這項更新確認 microsoft/onnxruntime#27399 是倉庫引用。',
];

const foreign = [
    'Please translate this sentence.', 'Welcome to our website.', 'The login page is broken.',
    'Click Here', 'ERROR PLEASE RETRY', 'Save your changes.', 'Do not close this window.',
    'We use Chrome and Firefox for testing.', 'Bonjour et bienvenue sur notre site.',
    'Добро пожаловать на наш сайт.', 'これは日本語の説明です。', '한국어 설명입니다.',
    'café', 'русский', 'English', 'abcdefa', '“Hello”', '「Please retry」',
    '“novabrowser”', '“console error”',
];

describe('PR #779 截图原文', () => {
    it.each(paragraphs.map((text, index) => [index, text] as const))('段落 %i：简体目标无需再翻译', (_index, text) => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });
});

describe('中文技术语境矩阵', () => {
    const variants = [
        ['普通空格', (text: string) => text],
        ['制表符', (text: string) => text.replaceAll(' ', '\t')],
        ['不换行空格', (text: string) => text.replaceAll(' ', '\u00a0')],
        ['行内换行', (text: string) => text.replace(/，/gu, '，\n')],
    ] as const;
    const cases = technical.flatMap((text, index) => variants.map(([name, transform]) => [index, name, transform(text)] as const));
    it.each(cases)('样本 %i / %s：目标与排除语言共用结论', (_index, _variant, text) => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans']});
        for (const target of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG']) {
            expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        }
        expect(shouldSkipTranslationForTarget(text, 'en', ['zh-Hans'])).toBe(true);
        for (const target of ['en', 'de', 'ja', 'ko', 'zh-Hant']) {
            expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
        }
    });

    it.each(traditional.map((text, index) => [index, text] as const))('繁体样本 %i：仍允许简繁转换', (_index, text) => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en', ['zh-Hant'])).toBe(true);
    });

    it('缓存不存目标或排除语言的决定，改写后的文本重新识别', () => {
        clearLanguageIdentificationCache();
        const text = paragraphs[0]!;
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en', ['zh-Hans'])).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en', [])).toBe(false);
        expect(shouldSkipTranslationForTarget(`${text} Please translate this sentence.`, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
    });
});

describe('反证：技术段落不得掩盖外语正文', () => {
    const cases = paragraphs.flatMap((text, index) => foreign.map((suffix, foreignIndex) => [index, foreignIndex, `${text} ${suffix}`] as const));
    it.each(cases)('段落 %i + 外语 %i：保留翻译', (_index, _foreignIndex, text) => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'und', ['zh-Hans'])).toBe(false);
    });
    it.each([
        '这里是一段中文说明，请翻译 debug。',
        '这里是一段中文说明，请翻译 Debug 模式中的内容。',
        '这里是一段中文说明，英文 Nebula 模型中的内容需要翻译。',
        '这里是一段中文说明，请解释 console error。',
        '这里是一段中文说明，英文 novabrowser 需要翻译。',
        '这项更新使用“novabrowser”浏览器测试安装内容。',
        '这项更新使用 novabrowser”浏览器测试安装内容。',
        '这项更新在运行 Please retry 时出现了异常。',
        '这项更新使用 Click Here 模式并检查按钮。',
        '这项更新使用 hello 模型进行测试。',
        '这项更新采用 café 模型进行测试。',
        '这项更新采用 русский 模型进行测试。',
        '这项更新采用 Please translate this sentence 模式进行测试。',
        '这项更新运行 very long foreign phrase 并检查内容。',
        '这项更新采用 unknownwordthatexceedsthemaximumlength 模型进行测试。',
        '这项更新。这是繁體中文內容。',
        '这项更新包括其他未知字形𱀀。',
        '这项更新也包含粤语嘅内容。',
        '中文 debug', 'debug', 'userscript/manifest verifier', 'Chrome、Firefox',
        '日本国立大学 debug 模式', 'この機能は debug モードで動作します。', '한국어 debug 모델입니다.',
        '这项更新提供 40 cats 和其他外语词。',
        '这项更新提供 and/or 选项和其他内容。',
        '这项更新说明 vendor=unknown 不属于数值赋值。',
    ].map((text, index) => [index, text] as const))('边界 %i：不确定、引文及冲突继续翻译', (_index, text) => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });
});
