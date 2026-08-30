import {describe, expect, it} from 'vitest';
import {buildCredentialPreviewChanges} from '@/src/features/settings/model/credentialPreview';

describe('配置凭据变化预览', () => {
    it('只显示新增、替换和清除状态，不泄露任何凭据明文', () => {
        const changes = buildCredentialPreviewChanges({
            token: {openai: 'sk-old-secret'},
            ak: 'old-access-key',
            extra: {privateHeader: 'old-extra-secret'},
        }, {
            token: {openai: 'sk-new-secret', deepseek: 'sk-added-secret'},
            ak: '',
            extra: {},
        });

        expect(changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'token.openai', before: '已配置（内容已隐藏）', after: '将替换（内容已隐藏）'}),
            expect.objectContaining({key: 'token.deepseek', before: '未设置', after: '将新增（内容已隐藏）'}),
            expect.objectContaining({key: 'ak', after: '将清除'}),
            expect.objectContaining({key: 'extra.privateHeader', after: '将清除'}),
        ]));
        const serialized = JSON.stringify(changes);
        expect(serialized).not.toContain('sk-old-secret');
        expect(serialized).not.toContain('sk-new-secret');
        expect(serialized).not.toContain('sk-added-secret');
        expect(serialized).not.toContain('old-access-key');
        expect(serialized).not.toContain('old-extra-secret');
    });

    it('相同或都未配置的凭据不产生噪音', () => {
        expect(buildCredentialPreviewChanges({token: {}, ak: ''}, {token: {}, ak: ''})).toEqual([]);
    });

    it('覆盖扩展凭据的数组、对象和原始值，并为未知服务使用稳定回退标签', () => {
        const changes = buildCredentialPreviewChanges({
            token: {},
            extra: {
                arrayAdded: [],
                arrayCleared: ['secret'],
                objectAdded: {},
                objectCleared: {secret: true},
                truthyFlag: null,
                undefinedFlag: false,
                falseFlag: undefined,
                whitespace: ' ',
            },
        }, {
            token: {customProvider: 'custom-secret'},
            extra: {
                arrayAdded: ['secret'],
                arrayCleared: [],
                objectAdded: {secret: true},
                objectCleared: {},
                truthyFlag: true,
                undefinedFlag: undefined,
                falseFlag: false,
                whitespace: '',
            },
        });

        expect(changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'token.customProvider', label: 'customProvider API Key'}),
            expect.objectContaining({key: 'extra.arrayAdded', after: '将新增（内容已隐藏）'}),
            expect.objectContaining({key: 'extra.arrayCleared', after: '将清除'}),
            expect.objectContaining({key: 'extra.objectAdded', after: '将新增（内容已隐藏）'}),
            expect.objectContaining({key: 'extra.objectCleared', after: '将清除'}),
            expect.objectContaining({key: 'extra.truthyFlag', after: '将新增（内容已隐藏）'}),
        ]));
        expect(changes.map(({key}) => key)).not.toEqual(expect.arrayContaining([
            'extra.undefinedFlag',
            'extra.falseFlag',
            'extra.whitespace',
        ]));
        expect(JSON.stringify(changes)).not.toContain('custom-secret');
        expect(JSON.stringify(changes)).not.toContain('secret');
    });
});
