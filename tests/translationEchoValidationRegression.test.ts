/**
 * @file tests/translationEchoValidationRegression.test.ts
 * 文件职责：用公开 X 短句摘录及独立编写的英文正文夹具验证标点/U+200B 回显门禁及统一 broker 的恢复、失败和缓存行为。
 * 主要内容：覆盖既有外语证据、分词边界、专名/技术标识、同目标语言、简繁、真实字词和字形差异，并通过真实 broker 入口注入内存 provider/cache。
 * 模块边界：不运行浏览器、不调用网络或真实存储；只替换配置存储与纯槽协议出口，不修改语言识别或展示比较规则。
 */
import {describe, expect, it, vi} from 'vitest';
import {isLikelyUntranslatedResponse} from '@/src/core/translation/resultValidation';
import {createTranslationBroker} from '@/src/services/translation/broker';
import type {TranslationConfigSource, TranslationProvider} from '@/src/services/translation/types';
import {resolveTranslationLanguages} from '@/src/core/translation/languages';

vi.mock('@/src/services/config/store', () => ({config: {}}));
vi.mock('@/src/core/translation/public', () => import('@/src/core/translation/slotProtocol'));

// 只保留公开帖子的一段短句摘录；长正文独立编写，数字是测试数据。
// https://x.com/thsottiaux/status/2107913674593644711
const corpusSentence = 'This test reports a high count of 40M active sample readers in GPT-6, but all numbers are fictional and describe fixture data.';
const oembedClosing = "Loading a banked reset in everyone's paid accounts. See you again tomorrow!";
const corpusText = 'Test excerpt/\n\n' + corpusSentence + '\n\n' + oembedClosing + ' https://example.test/fixture';
const chineseTranslation = '这个测试虚构了 GPT-6 和四千万活跃读者的数字，只用于验证翻译。';

const echoVariants = [
    ['末尾增加标点', corpusSentence, corpusSentence + '!'],
    ['末尾替换标点', corpusSentence, corpusSentence.replace(/\.$/u, '!?')],
    ['标点形成分词边界', corpusSentence, corpusSentence.replace(', but', ' — but')],
    ['移除逗号但保留词边界', corpusSentence, corpusSentence.replace(', but', ' but')],
    ['引号包装', corpusSentence, '“' + corpusSentence + '”'],
    ['末尾 U+200B', corpusSentence, corpusSentence + '\u200b'],
    ['词内 U+200B', corpusSentence, corpusSentence.replace('active', 'ac\u200btive')],
    ['U+200B 和末尾标点', corpusSentence, corpusSentence + '\u200b!?'],
    ['完整多段夹具 U+200B', corpusText, corpusText + '\u200b'],
    ['完整多段夹具标点', corpusText, corpusText + '!'],
    ['保留撇号词边界', oembedClosing, oembedClosing + '.'],
    ['既有短职业标题证据', 'Frontend Developer', 'Frontend Developer!'],
    ['既有标签列表证据', 'solo, blush, smile, bangs, looking_at_viewer, long_hair, blue_eyes',
        'solo; blush; smile; bangs; looking_at_viewer; long_hair; blue_eyes!'],
] as const;

const acceptedCases = [
    ['两个词的人名', 'Taylor Swift', 'Taylor Swift!'],
    ['两个词的品牌', 'Visual Studio', 'Visual Studio\u200b'],
    ['纯技术名称', 'OpenAI API', 'OpenAI API!'],
    ['多词技术名称', 'Microsoft Visual Studio Code', 'Microsoft Visual Studio Code!'],
    ['多词专名', 'World Wide Web', 'World Wide Web\u200b'],
    ['模型编号', 'GPT-6', 'GPT-6!'],
    ['版本编号', 'SGLang 0.5.21', 'SGLang 0.5.21\u200b'],
    ['标识符列表', 'id, status, user_name, updated_at, created_at, action',
        'id; status; user_name; updated_at; created_at; action!'],
    ['裸网址', 'https://docs.sglang.io/cookbook', 'https://docs.sglang.io/cookbook\u200b'],
    ['纯符号', '—', '—!?'],
    ['纯数字', '123', '123!'],
    ['空原文', '', '\u200b!'],
    ['短文本仍无外语证据', 'Day 3/', 'Day 3/!'],
    ['可信中文同目标', '今天已经更新了功能，可以开始使用。', '今天已经更新了功能，可以开始使用！'],
    ['中文同目标含品牌', '今天发布了 GPT-6，新功能可以在 Codex 中使用。', '今天发布了 GPT-6，新功能可以在 Codex 中使用！'],
    ['中文真实改写', '今天已经更新了功能，可以开始使用。', '今天功能已经更新，可以开始使用。'],
    ['简体转繁体', '允许清空设置，并保留用户的原始文字。', '允許清空設定，並保留使用者的原始文字。'],
    ['繁体转简体', '允許清空設定，並保留使用者的原始文字。', '允许清空设置，并保留用户的原始文字。'],
    ['真实中文译文', corpusSentence, chineseTranslation],
    ['替换一个英文词', corpusSentence, corpusSentence.replace('high', 'peak')],
    ['改变数字内容', corpusSentence, corpusSentence.replace('40M', '41M')],
    ['不折叠大小写', corpusSentence, corpusSentence.toLowerCase()],
    ['连字符不能拼接字词', 'We will re-sign the agreement after we read every sentence.',
        'We will resign the agreement after we read every sentence.'],
    ['删除分词标点不能连接内容', 'Please read alpha,beta before you start the application.',
        'Please read alphabeta before you start the application.'],
    ['运算符不能被忽略', 'Read the C++ guide before you start the application.',
        'Read the C guide before you start the application.'],
    ['乘法和除法不能折叠', 'Please read a*b before you start the application.',
        'Please read a/b before you start the application.'],
    ['标识符不能丢下划线', 'Please read user_name before you start the application.',
        'Please read user name before you start the application.'],
    ['减法不能被当作逗号', 'Please read a-b before you start the application.',
        'Please read a,b before you start the application.'],
    ['不能移除逻辑否定', 'Please check !flag before you start the application.',
        'Please check flag before you start the application.'],
    ['不等号不能变成赋值', 'Please check value != expected before you start the application.',
        'Please check value = expected before you start the application.'],
    ['不能移除可选链', 'Please check settings?.value before you start the application.',
        'Please check settings.value before you start the application.'],
    ['三元运算符不能被移除', 'Please check x ? y : z before you start the application.',
        'Please check x y z before you start the application.'],
    ['三元表达式不能移除冒号', 'Please check x ? y : z before you start the application.',
        'Please check x ? y z before you start the application.'],
    ['保留重音内容', 'Please read the Café guide before you start the application.',
        'Please read the Cafe guide before you start the application.'],
    ['不移除 ZWJ', corpusSentence, corpusSentence.replace('active', 'ac\u200dtive')],
    ['不移除 ZWNJ', corpusSentence, corpusSentence.replace('active', 'ac\u200ctive')],
    ['不泛化错语种', corpusSentence, 'これは日本語です。'],
] as const;

function createHarness(targetLanguage = 'zh-Hans') {
    const config: TranslationConfigSource = {
        service: 'mock', from: 'auto', to: targetLanguage, useCache: true, enableAIContext: false,
        model: {mock: 'mock-model'}, customModel: {}, proxy: {}, custom: '', deeplx: '', newApiUrl: '',
        minimaxBillingPlan: 'payg', minimaxRegion: 'cn', mimoBillingPlan: 'payg', mimoRegion: 'cn',
        azureOpenaiEndpoint: '', customBody: {}, system_role: {}, user_role: {},
        deepseekApiType: 'auto', deepseekThinkingMode: 'disabled',
    };
    const provider = vi.fn<TranslationProvider>();
    const store = new Map<string, string>();
    const cacheGet = vi.fn(async (key: string) => store.get(key) ?? null);
    const cacheSet = vi.fn(async (key: string, translation: string) => {
        store.set(key, translation);
        return true;
    });
    const broker = createTranslationBroker({
        ready: Promise.resolve(),
        getConfig: () => config,
        providers: {mock: provider},
        cache: {get: cacheGet, set: cacheSet, clear: async () => { store.clear(); }, cleanup: async () => undefined},
        serviceTypes: {machine: new Set(['mock']), isAI: () => false, isAiSdk: () => false, isUseAIContext: () => false},
        endpointResolver: {
            resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://unused.example.test'}),
            aiSdkTransportProfile: 'unused',
        },
        promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => ''},
        getMissingCredentialMessage: () => null,
        getTranslationLanguages: overrides => resolveTranslationLanguages(overrides, {sourceLanguage: 'auto', targetLanguage}),
        resolveConfiguredModel: (selected, custom) => custom || selected || '',
        buildTranslationCacheKey: identity => JSON.stringify(identity),
    });
    return {broker, provider, store, cacheGet, cacheSet};
}

describe('保守回显比较沿用原文已有的外语证据', () => {
    it.each(echoVariants)('%s 只变边界或 U+200B 时拒绝回显', (_label, origin, result) => {
        // 对照证明新增比较没有引入新的外语识别规则。
        expect(isLikelyUntranslatedResponse(origin, origin, 'zh-Hans')).toBe(true);
        expect(isLikelyUntranslatedResponse(origin, result, 'zh-Hans')).toBe(true);
        expect(isLikelyUntranslatedResponse(origin, result, 'zh-Hant')).toBe(true);
    });

    it.each(acceptedCases)('%s 不被扩大回显比较误拒绝', (_label, origin, result) => {
        expect(isLikelyUntranslatedResponse(origin, result, 'zh-Hans')).toBe(false);
    });

    it.each(['en', 'en-US', 'en-Latn'])('可信英文同目标 %s 允许原样词字加标点/U+200B', target => {
        expect(isLikelyUntranslatedResponse(corpusSentence, corpusSentence + '\u200b!', target)).toBe(false);
    });

    it('可信非中文同目标保持原有语言判断', () => {
        const german = 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.';
        expect(isLikelyUntranslatedResponse(german, german + '!', 'de')).toBe(false);
    });
});

describe('真实 broker 入口拒绝回显并保护内存缓存', () => {
    it.each(echoVariants)('%s 连续回显沿 UNTRANSLATED_RESPONSE 失败且不写缓存', async (_label, origin, result) => {
        const harness = createHarness();
        harness.provider.mockResolvedValue(result);
        await expect(harness.broker.translateWithCache({origin})).rejects.toMatchObject({
            kind: 'response', code: 'UNTRANSLATED_RESPONSE', retryable: false,
        });
        expect(harness.provider).toHaveBeenCalledTimes(2);
        expect(harness.cacheSet).not.toHaveBeenCalled();
        expect(harness.store.size).toBe(0);
    });

    it.each(['!', '\u200b'])('旧缓存中的 %j 回显不能命中，持续回显仍失败且不新增缓存', async suffix => {
        const harness = createHarness();
        harness.cacheGet.mockResolvedValueOnce(corpusSentence + suffix);
        harness.provider.mockResolvedValue(corpusSentence + suffix);
        await expect(harness.broker.translateWithCache({origin: corpusSentence})).rejects.toMatchObject({
            code: 'UNTRANSLATED_RESPONSE',
        });
        expect(harness.provider).toHaveBeenCalledTimes(2);
        expect(harness.cacheSet).not.toHaveBeenCalled();
    });

    it('一次回显后恢复真实译文，只缓存成功译文并允许下一次复用', async () => {
        const harness = createHarness();
        harness.provider.mockResolvedValueOnce(corpusSentence + '\u200b!').mockResolvedValueOnce(chineseTranslation);
        await expect(harness.broker.translateWithCache({origin: corpusSentence})).resolves.toBe(chineseTranslation);
        await expect(harness.broker.translateWithCache({origin: corpusSentence})).resolves.toBe(chineseTranslation);
        expect(harness.provider).toHaveBeenCalledTimes(2);
        expect(harness.cacheSet).toHaveBeenCalledOnce();
        expect([...harness.store.values()]).toEqual([chineseTranslation]);
    });

    it('旧回显缓存重新请求成功后只写入真实译文', async () => {
        const harness = createHarness();
        harness.cacheGet.mockResolvedValueOnce(corpusSentence + '\u200b');
        harness.provider.mockResolvedValue(chineseTranslation);
        await expect(harness.broker.translateWithCache({origin: corpusSentence})).resolves.toBe(chineseTranslation);
        expect(harness.provider).toHaveBeenCalledOnce();
        expect([...harness.store.values()]).toEqual([chineseTranslation]);
    });

    it('普通批量逐槽恢复也拒绝持续回显，不把该批次写入缓存', async () => {
        const harness = createHarness();
        const echo = corpusSentence + '\u200b!';
        harness.provider.mockResolvedValueOnce([echo, '中文']).mockResolvedValueOnce(echo);
        await expect(harness.broker.translateWithCache({origin: [corpusSentence, '中文']})).rejects.toMatchObject({
            code: 'UNTRANSLATED_RESPONSE',
        });
        expect(harness.provider).toHaveBeenCalledTimes(2);
        expect(harness.provider.mock.calls[1][0]).toMatchObject({origin: corpusSentence});
        expect(harness.cacheSet).not.toHaveBeenCalled();
    });

    it('关闭缓存仍经过已有回显恢复线路', async () => {
        const harness = createHarness();
        harness.provider.mockResolvedValue(corpusSentence + '!');
        await expect(harness.broker.translateWithCache({origin: corpusSentence, useCache: false})).rejects.toMatchObject({
            code: 'UNTRANSLATED_RESPONSE',
        });
        expect(harness.provider).toHaveBeenCalledTimes(2);
        expect(harness.cacheGet).not.toHaveBeenCalled();
        expect(harness.cacheSet).not.toHaveBeenCalled();
    });

    it.each([
        ['纯人名', 'Taylor Swift', 'Taylor Swift!', 'zh-Hans'],
        ['纯技术标识', 'OpenAI API', 'OpenAI API\u200b', 'zh-Hans'],
        ['可信同目标', corpusSentence, corpusSentence + '\u200b!', 'en'],
        ['真实不同字词', corpusSentence, chineseTranslation, 'zh-Hans'],
        ['简繁转换', '允许清空设置，并保留用户的原始文字。', '允許清空設定，並保留使用者的原始文字。', 'zh-Hant'],
    ])('%s 仍可成功、写缓存并复用', async (_label, origin, result, target) => {
        const harness = createHarness(target);
        harness.provider.mockResolvedValue(result);
        await expect(harness.broker.translateWithCache({origin})).resolves.toBe(result);
        await expect(harness.broker.translateWithCache({origin})).resolves.toBe(result);
        expect(harness.provider).toHaveBeenCalledOnce();
        expect(harness.cacheSet).toHaveBeenCalledOnce();
        expect([...harness.store.values()]).toEqual([result]);
    });
});
