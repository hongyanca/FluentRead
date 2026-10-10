import {describe, expect, it} from 'vitest';
import {addBuiltinGlossary, BUILTIN_GLOSSARIES} from '@/src/core/glossary/builtins';
import {buildGlossaryRevision, createGlossaryLibrary, exportGlossary, GLOSSARY_LIMITS,
    normalizeGlossaryLibraries, parseGlossaryImport, resolveGlossary, type GlossaryLibrary} from '@/src/core/glossary';
import {normalizeConfig} from '@/src/core/config/model';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {sanitizeConfigCredentials} from '@/src/core/config/credentials';
import {translate} from '@/src/core/i18n';

function add(id = 'ai-en-zh-hans', libraries: GlossaryLibrary[] = []): GlossaryLibrary {
    const result = addBuiltinGlossary(id, libraries, `My ${id}`);
    expect(result.status).toBe('added');
    if (result.status !== 'added') throw new Error(result.status);
    return result.library;
}

describe('离线内置术语词库', () => {
    it('提供五套真实且唯一的规范词表，全部通过既有配置边界并有中英文说明', () => {
        expect(BUILTIN_GLOSSARIES).toHaveLength(5);
        expect(new Set(BUILTIN_GLOSSARIES.map(preset => preset.id)).size).toBe(5);
        expect(BUILTIN_GLOSSARIES.map(preset => preset.terms.length)).toEqual([60, 60, 50, 40, 30]);
        for (const preset of BUILTIN_GLOSSARIES) {
            const library = add(preset.id);
            expect(normalizeGlossaryLibraries([library])).toEqual([library]);
            expect(library.entries.length).toBeLessThanOrEqual(GLOSSARY_LIMITS.entriesPerLibrary);
            expect(new Set(library.entries.map(term => term.source.toLowerCase())).size).toBe(library.entries.length);
            expect(library.entries.every(term => term.source.trim() && !term.source.includes('?'))).toBe(true);
            for (const key of [preset.nameKey, preset.descriptionKey]) {
                for (const language of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
                    expect(translate(key, language)).not.toBe(key);
                }
            }
        }
    });

    it('仅追加可编辑副本，保留原顺序和独立对象，不修改目录或用户数据', () => {
        const existing = createGlossaryLibrary([]);
        const before = structuredClone(existing);
        const catalog = structuredClone(BUILTIN_GLOSSARIES);
        const result = addBuiltinGlossary('ai-en-zh-hans', [existing], 'AI 阅读');
        expect(result.status).toBe('added');
        if (result.status !== 'added') throw new Error(result.status);
        expect(result.libraries[0]).toEqual(before);
        expect(result.libraries[1]).toBe(result.library);
        expect(result.library.id).not.toBe(existing.id);
        expect(result.library).toMatchObject({name: 'AI 阅读', enabled: true, preset: {id: 'ai-en-zh-hans', version: 1}});
        result.library.entries[0].target = '用户自己的译法';
        result.library.domains.push('example.com');
        expect(BUILTIN_GLOSSARIES).toEqual(catalog);
        expect(existing).toEqual(before);
        expect(add().entries[0].target).toBe('人工智能');
    });

    it('重命名、编辑、停用及其他版本副本不会重复添加或被当前版本覆盖，删除后可重新添加', () => {
        const library = add();
        Object.assign(library, {name: '定制模型译法', enabled: false, entries: [], preset: {id: 'ai-en-zh-hans', version: 2}});
        const before = structuredClone(library);
        expect(addBuiltinGlossary('ai-en-zh-hans', [createGlossaryLibrary([]), library], '新名称')).toEqual({status: 'existing', library});
        expect(library).toEqual(before);
        expect(add().entries).toHaveLength(60);
        expect(addBuiltinGlossary('unknown', [], '未知')).toEqual({status: 'unknown'});
    });

    it('添加前检查词库和总词条容量，不靠截断数据静默成功，已有副本在满额时仍能查看', () => {
        const full = Array.from({length: 20}, (_, index) => ({...createGlossaryLibrary([]), id: `lib-${index}`}));
        expect(addBuiltinGlossary('ai-en-zh-hans', full, 'AI')).toEqual({status: 'capacity'});
        full[19] = add();
        expect(addBuiltinGlossary('ai-en-zh-hans', full, 'AI').status).toBe('existing');
        const dense = normalizeGlossaryLibraries(Array.from({length: 10}, (_, libraryIndex) => ({
            ...createGlossaryLibrary([]), id: `dense-${libraryIndex}`,
            entries: Array.from({length: libraryIndex < 9 ? 500 : 441}, (_, index) => ({
                id: `term-${index}`, source: `s${index}`, target: '', caseSensitive: false,
            })),
        })));
        expect(addBuiltinGlossary('ai-en-zh-hans', dense, 'AI')).toEqual({status: 'capacity'});
        dense[9].entries.pop();
        expect(addBuiltinGlossary('ai-en-zh-hans', dense, 'AI').status).toBe('added');
    });

    it('复用真实匹配器：领域词限定英语到简中，产品词按大小写保留，显式停用不生效', () => {
        const libraries = [add(), add('product-names')];
        const context = {text: 'GitHub uses a large language model; github and GitHubs do not match.', sourceLanguage: 'en', targetLanguage: 'zh-CN'};
        expect(resolveGlossary(libraries, context).terms).toEqual([
            {source: 'large language model', target: '大语言模型'}, {source: 'GitHub', target: 'GitHub'},
        ]);
        for (const language of ['zh-TW', 'ja', 'en']) {
            expect(resolveGlossary(libraries, {...context, targetLanguage: language}).terms).toEqual([{source: 'GitHub', target: 'GitHub'}]);
        }
        expect(resolveGlossary([libraries[0]], {...context, sourceLanguage: 'fr'}).terms).toEqual([]);
        libraries[0].enabled = false;
        expect(resolveGlossary(libraries, context).terms).toEqual([{source: 'GitHub', target: 'GitHub'}]);
        libraries[0].enabled = true; libraries[0].domains = ['example.com'];
        expect(resolveGlossary([libraries[0]], context).terms).toEqual([]);
        expect(resolveGlossary([libraries[0]], {...context, pageUrl: 'https://example.com/article'}).terms).toHaveLength(1);
    });

    it('选中的词条及来源版本通过完整配置、公开配置和词库 JSON 往返，不自动改变默认开关', () => {
        const library = add();
        library.entries[0].target = '自定义人工智能';
        const config = normalizeConfig({glossaryLibraries: [library], documentGlossaryIds: [library.id]});
        expect(config.glossaryEnabled).toBe(false);
        // 完整备份与不含凭据的旧公开配置文件都必须保留术语库。
        for (const exported of [prepareConfigForExport(config), sanitizeConfigCredentials(JSON.parse(JSON.stringify(config)))]) {
            const restored = prepareConfigForImport(JSON.parse(JSON.stringify(exported)), normalizeConfig({}));
            expect(restored.glossaryLibraries).toEqual([library]);
            expect(restored.documentGlossaryIds).toEqual([library.id]);
            expect(restored.glossaryEnabled).toBe(false);
            expect(addBuiltinGlossary('ai-en-zh-hans', restored.glossaryLibraries, '不能覆盖').status).toBe('existing');
        }
        const imported = parseGlossaryImport(exportGlossary(library, 'json'), 'json');
        expect(imported.errors).toEqual([]);
        expect(imported.libraries).toEqual([library]);
        expect(buildGlossaryRevision([library], true)).toBe(buildGlossaryRevision([{...library, preset: undefined}], true));
    });

    it.each([undefined, null, false, [], {}, {id: 3, version: 1}, {id: '', version: 1}, {id: 'bad/id', version: 1},
        {id: 'ai-en-zh-hans', version: '1'}, {id: 'ai-en-zh-hans', version: 1.5}, {id: 'ai-en-zh-hans', version: 0},
        {id: 'ai-en-zh-hans', version: -1}, {id: 'ai-en-zh-hans', version: Infinity}])('非法来源标记只移除元数据，不损坏词条 %#', preset => {
        const library = add();
        const normalized = normalizeGlossaryLibraries([{...library, preset}])[0];
        expect(normalized).not.toHaveProperty('preset');
        expect(normalized.entries).toEqual(library.entries);
    });
});
