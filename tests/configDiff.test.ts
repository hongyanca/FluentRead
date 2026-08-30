import {describe, expect, it} from 'vitest';

import {buildConfigDiff} from '@/src/core/config/diff';

function group(result: ReturnType<typeof buildConfigDiff>, id: string) {
    return result.groups.find((item) => item.id === id);
}

describe('配置差异预览', () => {
    it('按设置页稳定分组并把常用枚举、开关、数组和数字格式化为可读文本', () => {
        const result = buildConfigDiff({
            on: true,
            display: 1,
            service: 'microsoft',
            hotkey: 'Control',
            alwaysTranslateDomains: ['example.com'],
            disableImageTranslator: true,
            videoSubtitleFontSize: 100,
            useCache: true,
            translationCenterServices: ['microsoft'],
            futureSetting: false,
        }, {
            on: false,
            display: 0,
            service: 'openai',
            hotkey: 'Alt',
            alwaysTranslateDomains: ['example.com', 'openai.com'],
            disableImageTranslator: false,
            videoSubtitleFontSize: 140,
            useCache: false,
            translationCenterServices: ['openai', 'deepseek'],
            futureSetting: {mode: 'compact', enabled: true},
        });

        expect(result.groups.map((item) => item.id)).toEqual([
            'general',
            'translation',
            'siteRules',
            'imageAndArea',
            'videoSubtitles',
            'advanced',
            'tools',
            'other',
        ]);
        expect(result.changeCount).toBe(10);
        expect(group(result, 'general')?.changes[0]).toMatchObject({
            key: 'on', label: '插件状态', before: '开启', after: '关闭',
        });
        expect(group(result, 'general')?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
            label: '翻译模式', before: '双语对照模式', after: '仅译文模式',
        })]));
        expect(group(result, 'general')?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
            before: '微软翻译', after: 'OpenAI',
        })]));
        expect(group(result, 'translation')?.changes[0]).toMatchObject({before: 'Ctrl', after: 'Alt'});
        expect(group(result, 'siteRules')?.changes[0]).toMatchObject({
            before: 'example.com', after: 'example.com、openai.com',
        });
        expect(group(result, 'imageAndArea')?.changes[0]).toMatchObject({before: '关闭', after: '开启'});
        expect(group(result, 'videoSubtitles')?.changes[0]).toMatchObject({before: '100%', after: '140%'});
        expect(group(result, 'advanced')?.changes[0]).toMatchObject({before: '开启', after: '关闭'});
        expect(group(result, 'tools')?.changes[0]).toMatchObject({
            before: '微软翻译', after: 'OpenAI、DeepSeek',
        });
        expect(group(result, 'other')?.changes[0]).toMatchObject({
            key: 'futureSetting', label: 'future setting', before: '关闭', after: 'mode：compact；enabled：开启',
        });
    });

    it('展开服务对象映射，只报告真正变化的服务项且忽略对象键顺序', () => {
        const unchanged = buildConfigDiff(
            {model: {openai: 'gpt-5', deepseek: 'deepseek-chat'}},
            {model: {deepseek: 'deepseek-chat', openai: 'gpt-5'}},
        );
        expect(unchanged).toEqual({changeCount: 0, groups: []});

        const changed = buildConfigDiff({
            model: {openai: 'gpt-4.1', deepseek: 'deepseek-chat'},
            requireApiKey: {openai: true},
        }, {
            model: {openai: 'gpt-5', deepseek: 'deepseek-chat'},
            requireApiKey: {openai: false},
        });
        expect(changed.changeCount).toBe(2);
        expect(group(changed, 'translationServices')?.changes).toEqual([
            {key: 'model.openai', label: 'OpenAI模型', before: 'gpt-4.1', after: 'gpt-5'},
            {key: 'requireApiKey.openai', label: 'OpenAI API Key 校验', before: '开启', after: '关闭'},
        ]);

        expect(buildConfigDiff({model: 'legacy'}, {model: {openai: 'gpt-5'}}).changeCount).toBe(1);
        expect(buildConfigDiff({model: {openai: 'gpt-5'}}, {model: 'legacy'}).changeCount).toBe(1);
    });

    it('完全剔除凭据字段、疑似凭据字段和非用户配置元数据', () => {
        const result = buildConfigDiff({
            token: {openai: 'old-token'},
            ak: 'old-ak',
            sk: 'old-sk',
            appid: 'old-app',
            key: 'old-key',
            youdaoAppKey: 'old-youdao-key',
            youdaoAppSecret: 'old-youdao-secret',
            tencentSecretId: 'old-id',
            tencentSecretKey: 'old-secret',
            extra: {authorization: 'Bearer old'},
            apiToken: 'old-api-token',
            accountPassword: 'old-password',
            authorization: 'Bearer old',
            authorizationHeader: 'Bearer old-header',
            customBody: {openai: '{"Authorization":"Bearer old-body-token"}'},
            count: 1,
            persistCredentials: false,
            videoServiceDefaultMigrated: false,
            __fluentConfigRevision: 2,
        }, {
            token: {openai: 'new-token'},
            ak: 'new-ak',
            sk: 'new-sk',
            appid: 'new-app',
            key: 'new-key',
            youdaoAppKey: 'new-youdao-key',
            youdaoAppSecret: 'new-youdao-secret',
            tencentSecretId: 'new-id',
            tencentSecretKey: 'new-secret',
            extra: {authorization: 'Bearer new'},
            apiToken: 'new-api-token',
            accountPassword: 'new-password',
            authorization: 'Bearer new',
            authorizationHeader: 'Bearer new-header',
            customBody: {openai: '{"Authorization":"Bearer new-body-token"}'},
            count: 2,
            persistCredentials: true,
            videoServiceDefaultMigrated: true,
            __fluentConfigRevision: 3,
        });
        expect(result.changeCount).toBe(1);
        expect(JSON.stringify(result)).not.toContain('old-body-token');
        expect(JSON.stringify(result)).not.toContain('new-body-token');
        expect(group(result, 'translationServices')?.changes[0]).toMatchObject({
            key: 'customBody.openai',
            before: '0 个公开字段（内容已摘要）',
            after: '0 个公开字段（内容已摘要）',
        });
    });

    it('摘要长提示词和自定义请求体，并遮罩嵌套认证内容及地址凭据', () => {
        const longPrompt = '请保持术语一致。'.repeat(30);
        const result = buildConfigDiff({
            system_role: {openai: ''},
            customBody: {openai: '{"temperature":0.2,"Authorization":"Bearer old-secret"}'},
            proxy: {openai: ''},
            notes: '',
        }, {
            system_role: {openai: longPrompt},
            customBody: {openai: '{"temperature":0.8,"Authorization":"Bearer new-secret","password":"hidden"}'},
            proxy: {openai: 'https://user:password@example.com?token=secret'},
            notes: '普通说明。'.repeat(40),
        });
        const serialized = JSON.stringify(result);

        expect(serialized).not.toContain(longPrompt);
        expect(serialized).not.toContain('old-secret');
        expect(serialized).not.toContain('new-secret');
        expect(serialized).not.toContain('password@example.com');
        expect(group(result, 'translationServices')?.changes).toEqual([
            {
                key: 'customBody.openai',
                label: 'OpenAI自定义请求体',
                before: '1 个公开字段（内容已摘要）',
                after: '1 个公开字段（内容已摘要）',
            },
            {
                key: 'proxy.openai',
                label: 'OpenAI代理地址',
                before: '未设置',
                after: expect.stringContaining('敏感内容已隐藏'),
            },
            {
                key: 'system_role.openai',
                label: 'OpenAI System 提示词',
                before: '未设置',
                after: `已配置（${longPrompt.length} 字符）`,
            },
        ]);
        expect(group(result, 'other')?.changes[0]).toMatchObject({
            key: 'notes',
            before: '未设置',
            after: expect.stringMatching(/^长文本（\d+ 字符）$/u),
        });
    });

    it('脱敏后的显示摘要相同，也不会吞掉真实配置变化', () => {
        const result = buildConfigDiff(
            {customBody: {openai: '{"Authorization":"Bearer secret-a"}'}},
            {customBody: {openai: '{"Authorization":"Bearer secret-b"}'}},
        );

        expect(result.changeCount).toBe(1);
        expect(group(result, 'translationServices')?.changes[0]).toMatchObject({
            key: 'customBody.openai',
            before: '0 个公开字段（内容已摘要）',
            after: '0 个公开字段（内容已摘要）',
        });
        expect(JSON.stringify(result)).not.toContain('secret-a');
        expect(JSON.stringify(result)).not.toContain('secret-b');
    });

    it('把无效输入视为空配置，并安全处理新增、删除、空数组和循环引用', () => {
        const cyclic: Record<string, unknown> = {enabled: true};
        cyclic.self = cyclic;
        const result = buildConfigDiff(null, {
            alwaysTranslateDomains: [],
            removedLater: cyclic,
        });

        expect(result.changeCount).toBe(2);
        expect(group(result, 'siteRules')?.changes[0]).toEqual({
            key: 'alwaysTranslateDomains',
            label: '始终翻译网站',
            before: '未设置',
            after: '无',
        });
        expect(group(result, 'other')?.changes[0]?.after).toContain('循环引用');

        const removed = buildConfigDiff({theme: 'dark'}, undefined);
        expect(group(removed, 'general')?.changes[0]).toMatchObject({before: '暗色主题', after: '未设置'});
    });

    it('覆盖所有已知页面字段，并对异常旧值保持可预览而不泄露内容', () => {
        const cyclicArray: unknown[] = [];
        cyclicArray.push(cyclicArray);
        const result = buildConfigDiff({
            on: undefined,
            from: 'auto',
            to: 'zh-Hans',
            theme: 'auto',
            display: 1,
            style: 1,
            contextMenuEnabled: true,
            fullPageTranslationMode: 'viewport',
            disableFloatingBall: true,
            floatingBallPosition: 'right',
            floatingBallHotkey: 'Alt+T',
            customFloatingBallHotkey: '',
            translationProgressPanelEnabled: false,
            service: 'microsoft',
            model: 'legacy-invalid-model-map',
            customModel: {},
            requireApiKey: {},
            minimaxBillingPlan: 'payg',
            minimaxRegion: 'cn',
            mimoBillingPlan: 'payg',
            mimoRegion: 'cn',
            customBody: {},
            proxy: {},
            custom: '',
            deeplx: '',
            newApiUrl: '',
            azureOpenaiEndpoint: '',
            system_role: {},
            user_role: {},
            deepseekApiType: 'auto',
            deepseekThinkingMode: 'disabled',
            hotkey: 'Control',
            customHotkey: '',
            mouseHoverTranslationDelay: undefined,
            disableSelectionTranslator: true,
            selectionTranslatorMode: 'disabled',
            selectionTranslatorTrigger: 'icon',
            selectionTranslatorHotkey: 'Control',
            customSelectionTranslatorHotkey: '',
            selectionTranslatorDelay: 300,
            selectionTtsVoices: [],
            inputBoxTranslationTrigger: 'disabled',
            inputBoxTranslationTarget: 'en',
            autoTranslate: false,
            alwaysTranslateDomains: [],
            disabledExtensionDomains: [],
            disableImageTranslator: true,
            selectionAreaEnabled: false,
            videoTranslationEnabled: false,
            videoService: 'microsoft',
            videoSubtitleVisible: true,
            videoSubtitleDisplayMode: 'bilingual',
            videoSubtitleFontSize: 100,
            useCache: true,
            enableAIContext: false,
            maxConcurrentTranslations: 6,
            animations: true,
            documentService: 'microsoft',
            documentModel: {},
            documentCustomModel: {},
            translationCenterServices: 'microsoft',
            translationCenterSourceLanguage: '',
            translationCenterTargetLanguage: '',
            vocabularyBookEnabled: false,
            oddValue: false,
            blankValue: 'visible',
        }, {
            on: 'legacy-enabled',
            from: 'en',
            to: 'ja',
            theme: 'sepia',
            display: 0,
            style: 23,
            contextMenuEnabled: false,
            fullPageTranslationMode: 'all',
            disableFloatingBall: false,
            floatingBallPosition: 'left',
            floatingBallHotkey: 'F9',
            customFloatingBallHotkey: 'Meta+T',
            translationProgressPanelEnabled: true,
            service: 'openai',
            model: 'another-invalid-model-map',
            customModel: {openai: 'my-model', unlistedProvider: 'future-model'},
            requireApiKey: {openai: false},
            minimaxBillingPlan: 'token-plan',
            minimaxRegion: 'global',
            mimoBillingPlan: 'token-plan',
            mimoRegion: 'sgp',
            customBody: {
                openai: '[1,2,3]',
                deepseek: '{not-json',
                custom: 42,
                grok: 'token=hidden',
            },
            proxy: {openai: 'https://proxy.example.com'},
            custom: 'https://custom.example.com',
            deeplx: 'https://deeplx.example.com',
            newApiUrl: 'https://new-api.example.com',
            azureOpenaiEndpoint: 'https://example.openai.azure.com/chat/completions',
            system_role: {openai: 42, deepseek: 'short prompt'},
            user_role: {openai: 'authorization: Bearer hidden'},
            deepseekApiType: 'responses',
            deepseekThinkingMode: 'enabled',
            hotkey: 'Alt',
            customHotkey: 'Meta+H',
            mouseHoverTranslationDelay: 'fast',
            disableSelectionTranslator: false,
            selectionTranslatorMode: 'translation-only',
            selectionTranslatorTrigger: 'dot',
            selectionTranslatorHotkey: 'Shift',
            customSelectionTranslatorHotkey: 'Meta+S',
            selectionTranslatorDelay: 450,
            selectionTtsVoices: ['a', 'b', 'c', 'd', 'e'],
            inputBoxTranslationTrigger: 'triple_space',
            inputBoxTranslationTarget: 'de',
            autoTranslate: true,
            alwaysTranslateDomains: ['a.example'],
            disabledExtensionDomains: ['b.example'],
            disableImageTranslator: false,
            selectionAreaEnabled: true,
            videoTranslationEnabled: true,
            videoService: 'deepseek',
            videoSubtitleVisible: false,
            videoSubtitleDisplayMode: 'original-only',
            videoSubtitleFontSize: 'large',
            useCache: false,
            enableAIContext: true,
            maxConcurrentTranslations: 8,
            animations: false,
            documentService: 'openai',
            documentModel: {openai: 'gpt-5'},
            documentCustomModel: {openai: 'document-model'},
            translationCenterServices: ['openai'],
            translationCenterSourceLanguage: 'en',
            translationCenterTargetLanguage: 'ja',
            vocabularyBookEnabled: true,
            manyItems: ['a', 'b', 'c', 'd', 'e'],
            manyValues: {openai: 'model', one: 1, two: 2, three: 3, four: 4},
            emptyPublicMap: {password: 'hidden'},
            invalidNumber: Number.NaN,
            oddValue: () => 'legacy',
            blankValue: '   ',
            '---': cyclicArray,
        });

        expect(result.changeCount).toBeGreaterThan(60);
        expect(JSON.stringify(result)).not.toContain('Bearer hidden');
        expect(group(result, 'translationServices')?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'model', before: 'legacy-invalid-model-map', after: 'another-invalid-model-map'}),
            expect.objectContaining({key: 'customBody.openai', after: '3 项 JSON（内容已摘要）'}),
            expect.objectContaining({key: 'customBody.deepseek', after: '文本请求体（9 字符，内容已摘要）'}),
            expect.objectContaining({key: 'customBody.custom', after: '已配置（内容已摘要）'}),
            expect.objectContaining({key: 'system_role.openai', after: '42'}),
        ]));
        expect(group(result, 'translation')?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'mouseHoverTranslationDelay', after: 'fast'}),
            expect.objectContaining({key: 'selectionTtsVoices', after: '5 项：a、b、c、d 等'}),
        ]));
        expect(group(result, 'other')?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'manyValues', after: expect.stringContaining('5 项：')}),
            expect.objectContaining({key: 'emptyPublicMap', after: '无'}),
            expect.objectContaining({key: 'invalidNumber', after: '未设置'}),
            expect.objectContaining({key: '---', label: '---', after: expect.stringContaining('循环引用')}),
        ]));
    });
});
