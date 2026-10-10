import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {buildConfigDiff} from '@/src/core/config/diff';
import {createQuickTranslationProfile, normalizeQuickTranslationProfiles} from '@/src/core/config/quickTranslation';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {sanitizeConfigCredentials} from '@/src/core/config/credentials';
import {createGlossaryLibrary} from '@/src/core/glossary';

function library() {
    return {...createGlossaryLibrary([]), id: 'technical', name: '技术词库', entries: [
        {id: 'agent', source: 'agent', target: '智能体', caseSensitive: false},
        {id: 'brand', source: 'FluentRead', target: '', caseSensitive: true},
    ]};
}

describe('术语库配置与迁移', () => {
    it('旧配置保持关闭，文档字幕与缺省快捷方案继承全局，不隐式选择词库', () => {
        for (const config of [new Config(), normalizeConfig({}), normalizeConfig({glossaryEnabled: 'true'})]) {
            expect(config.glossaryEnabled).toBe(false);
            expect(config.glossaryLibraries).toEqual([]);
            expect(config.documentGlossaryIds).toBeNull();
            expect(config.videoGlossaryIds).toBeNull();
        }
        const profile = createQuickTranslationProfile('hover');
        const config = normalizeConfig({quickTranslationProfiles: [profile]});
        expect(config.quickTranslationProfiles[0]).not.toHaveProperty('glossaryIds');
    });

    it('词库先规范化，再清理各入口选择；删库不会将指定选择扩大成全局', () => {
        const source = {
            glossaryEnabled: true,
            glossaryLibraries: [library()],
            documentGlossaryIds: ['technical', 'removed', 'technical'],
            videoGlossaryIds: ['removed'],
            quickTranslationProfiles: [
                {...createQuickTranslationProfile('hover'), glossaryIds: ['removed']},
                {...createQuickTranslationProfile('full-page'), id: 'second', glossaryIds: null},
            ],
        };
        const config = normalizeConfig(source);
        expect(config.glossaryEnabled).toBe(true);
        expect(config.documentGlossaryIds).toEqual(['technical']);
        expect(config.videoGlossaryIds).toEqual([]);
        expect(config.quickTranslationProfiles.map(profile => profile.glossaryIds)).toEqual([[], null]);
        const deleted = normalizeConfig({...config, glossaryLibraries: []});
        expect(deleted.documentGlossaryIds).toEqual([]);
        expect(source.documentGlossaryIds).toEqual(['technical', 'removed', 'technical']);
        config.glossaryLibraries[0].entries[0].target = '修改';
        expect(source.glossaryLibraries[0].entries[0].target).toBe('智能体');
    });

    it('完整和公开配置迁移保留术语、保留原文规则以及三态选择', () => {
        const source = normalizeConfig({...new Config(), glossaryEnabled: true, glossaryLibraries: [library()],
            documentGlossaryIds: ['technical'], videoGlossaryIds: [],
            quickTranslationProfiles: [{...createQuickTranslationProfile('hover'), glossaryIds: ['technical']}],
        });
        // 完整备份与不含凭据的旧公开配置文件都必须保留术语库选择。
        for (const exported of [prepareConfigForExport(source), sanitizeConfigCredentials(JSON.parse(JSON.stringify(source)))]) {
            const restored = prepareConfigForImport(JSON.parse(JSON.stringify(exported)), new Config());
            expect(restored.glossaryEnabled).toBe(true);
            expect(restored.glossaryLibraries).toEqual(source.glossaryLibraries);
            expect(restored.documentGlossaryIds).toEqual(['technical']);
            expect(restored.videoGlossaryIds).toEqual([]);
            expect(restored.quickTranslationProfiles[0].glossaryIds).toEqual(['technical']);
        }
        const legacy = prepareConfigForImport({on: true, service: 'openai', display: 1, from: 'auto', to: 'zh-Hans'}, source);
        expect(legacy.glossaryEnabled).toBe(false);
        expect(legacy.glossaryLibraries).toEqual([]);
    });

    it('独立快捷方案规范化未传词库目录时仍保留明确选择', () => {
        const profiles = normalizeQuickTranslationProfiles([
            {...createQuickTranslationProfile('hover'), glossaryIds: ['technical', 'technical']},
            {...createQuickTranslationProfile('hover'), id: 'second', glossaryIds: false},
        ], {isSupportedService: () => true, serviceUsesModel: () => true});
        expect(profiles.map(profile => profile.glossaryIds)).toEqual([['technical'], null]);
    });
});

describe('术语库配置历史摘要', () => {
    it('以规模提示词库变更，不在差异中展开专业词句', () => {
        const diff = buildConfigDiff({glossaryEnabled: false, glossaryLibraries: []}, {
            glossaryEnabled: true, glossaryLibraries: [library()], documentGlossaryIds: [], videoGlossaryIds: ['technical'],
        });
        const changes = diff.groups.flatMap(group => group.changes);
        expect(changes).toContainEqual({key: 'glossaryEnabled', label: '术语库', before: '关闭', after: '开启'});
        expect(changes).toContainEqual({key: 'glossaryLibraries', label: '术语库内容', before: '0 套词库，0 条术语', after: '1 套词库，2 条术语'});
        expect(changes).toContainEqual({key: 'documentGlossaryIds', label: '文档术语库', before: '跟随全局词库', after: '不使用术语库'});
        expect(changes).toContainEqual({key: 'videoGlossaryIds', label: '字幕术语库', before: '跟随全局词库', after: '指定 1 套词库'});
        expect(JSON.stringify(diff)).not.toContain('智能体');
    });

    it('相同数量的词条修改仍显示更新，损坏快照安全降级', () => {
        const before = library();
        const after = {...before, entries: before.entries.map(entry => ({...entry, target: '新的译名'}))};
        expect(buildConfigDiff({glossaryLibraries: [before]}, {glossaryLibraries: [after]}).groups[0].changes[0].after)
            .toBe('1 套词库，2 条术语（内容已更新）');
        const malformed = buildConfigDiff({glossaryLibraries: true, documentGlossaryIds: false}, {
            glossaryLibraries: [{}, null], documentGlossaryIds: null,
        }).groups.flatMap(group => group.changes);
        expect(malformed).toContainEqual({key: 'glossaryLibraries', label: '术语库内容', before: '开启', after: '1 套词库，0 条术语'});
        expect(malformed).toContainEqual({key: 'documentGlossaryIds', label: '文档术语库', before: '关闭', after: '跟随全局词库'});
    });

    it('快捷方案的术语选择可以从历史中辨认', () => {
        const profile = createQuickTranslationProfile('hover');
        const changes = buildConfigDiff({quickTranslationProfiles: [profile]}, {
            quickTranslationProfiles: [{...profile, glossaryIds: []}],
        }).groups[0].changes;
        expect(changes[0].before).not.toContain('术语库');
        expect(changes[0].after).toContain('术语库：不使用术语库');
    });
});
