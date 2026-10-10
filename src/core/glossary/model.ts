/**
 * @file src/core/glossary/model.ts
 * 文件职责：定义个人术语库的纯数据契约、配置边界和稳定版本，供配置存储、设置界面及翻译请求共同使用。
 * 主要内容：约束术语库与条目数量，规范 Unicode、语言及域名，将常见中文旧语言标签统一到简繁脚本；生成无冲突标识并保留显式停用选择，非法网站范围不会扩大成全局范围。
 * 模块边界：只处理传入数据并计算同步 SHA-256，不读取浏览器状态、不发网络请求，也不承担提示词或界面渲染。
 */
import {sha256Hex} from '@/src/shared/function/sha256';
import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';

export interface GlossaryEntry {
    id: string;
    source: string;
    target: string;
    caseSensitive: boolean;
}

export interface GlossaryLibrary {
    id: string;
    name: string;
    enabled: boolean;
    sourceLanguage: string;
    targetLanguage: string;
    domains: string[];
    entries: GlossaryEntry[];
    /** 仅记录初始模板来源；词条始终是用户可编辑的独立副本，不用于翻译或自动覆盖。 */
    preset?: {id: string; version: number};
}

export const GLOSSARY_LIMITS = {
    libraries: 20,
    entriesPerLibrary: 500,
    totalEntries: 5000,
    termLength: 200,
    nameLength: 80,
    domainsPerLibrary: 50,
    importBytes: 2_000_000,
} as const;

const INVALID_DOMAIN = '!invalid-domain';
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u;

export function glossaryRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

/** 清理不可见控制字符和孤立代理项，保留换行、标点与 $、<、> 的字面含义。 */
export function cleanGlossaryText(value: unknown): string {
    return typeof value === 'string'
        ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '\uFFFD')
            .normalize('NFC').trim()
        : '';
}

function boundedText(value: unknown, length: number): string {
    // 必须先做 NFC：一个显示字符可由四个分解码点组成，提前按原始长度截断会悄悄丢掉有效术语。
    return Array.from(cleanGlossaryText(value).slice(0, length * 2)).slice(0, length).join('');
}

export function normalizeGlossaryLanguage(value: unknown): string {
    const language = cleanGlossaryText(value).toLowerCase().replaceAll('_', '-');
    if (language.length > 40 || language === 'auto' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(language)) return '';
    // 术语语言沿用请求的简繁身份，旧 zh 归入简体，不能让简体译名命中繁体请求。
    return normalizeChineseLanguageCode(language).toLowerCase();
}

/** 裸域名包含本域与子域；以 *. 开头时仅包含子域。URL、路径、端口和任意通配符不是规则。 */
export function normalizeGlossaryDomain(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const candidate = value.trim().toLowerCase().replace(/\.$/u, '');
    const wildcard = candidate.startsWith('*.');
    const host = wildcard ? candidate.slice(2) : candidate;
    if (!host || host.length > 253 || /[\s/:@?#*\\]/u.test(host)) return null;
    try {
        const ascii = new URL(`https://${host}`).hostname;
        if (ascii.length > 253) return null;
        if (!ascii.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return null;
        return `${wildcard ? '*.' : ''}${ascii}`;
    } catch {
        return null;
    }
}

function uniqueId(candidate: unknown, used: Set<string>, prefix: string, reserved?: ReadonlySet<string>): string {
    if (typeof candidate === 'string' && ID_PATTERN.test(candidate) && !used.has(candidate)) {
        used.add(candidate);
        return candidate;
    }
    let index = 1;
    while (used.has(`${prefix}-${index}`) || reserved?.has(`${prefix}-${index}`)) index += 1;
    const id = `${prefix}-${index}`;
    used.add(id);
    return id;
}

/** 修复缺失 ID 时先预留后续已有 ID，避免快捷方案原来指向的有效库被一个新生成的库冒占。 */
function reservedIds(values: unknown[]): ReadonlySet<string> {
    return new Set(values.map((value) => glossaryRecord(value)?.id)
        .filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id)));
}

export function createGlossaryEntry(entries: readonly Pick<GlossaryEntry, 'id'>[]): GlossaryEntry {
    return {id: uniqueId(null, new Set(entries.map((entry) => entry.id)), 'term'), source: '', target: '', caseSensitive: false};
}

export function createGlossaryLibrary(libraries: readonly Pick<GlossaryLibrary, 'id'>[]): GlossaryLibrary {
    return {
        id: uniqueId(null, new Set(libraries.map((library) => library.id)), 'glossary'),
        name: '新术语库', enabled: true, sourceLanguage: '', targetLanguage: '', domains: [], entries: [],
    };
}

export function normalizeGlossaryLibraries(value: unknown): GlossaryLibrary[] {
    if (!Array.isArray(value)) return [];
    const candidates = value.slice(0, GLOSSARY_LIMITS.libraries);
    const reservedLibraryIds = reservedIds(candidates);
    const libraryIds = new Set<string>();
    let remaining = GLOSSARY_LIMITS.totalEntries as number;
    return candidates.flatMap((raw) => {
        const library = glossaryRecord(raw);
        if (!library) return [];
        const preset = glossaryRecord(library.preset);
        const origin = preset && typeof preset.id === 'string' && ID_PATTERN.test(preset.id)
            && typeof preset.version === 'number' && Number.isSafeInteger(preset.version) && preset.version > 0
            ? {id: preset.id, version: preset.version} : null;
        const entryIds = new Set<string>();
        const rawEntries = (Array.isArray(library.entries) ? library.entries : [])
            .slice(0, Math.min(GLOSSARY_LIMITS.entriesPerLibrary, remaining));
        const reservedEntryIds = reservedIds(rawEntries);
        const entries = rawEntries.flatMap((rawEntry) => {
                const entry = glossaryRecord(rawEntry);
                if (!entry) return [];
                const source = boundedText(entry.source, GLOSSARY_LIMITS.termLength);
                if (!source) return [];
                return [{id: uniqueId(entry.id, entryIds, 'term', reservedEntryIds), source,
                    target: boundedText(entry.target, GLOSSARY_LIMITS.termLength), caseSensitive: entry.caseSensitive === true}];
            });
        remaining -= entries.length;
        const rawDomains = library.domains == null ? [] : Array.isArray(library.domains) ? library.domains : [null];
        const domains = [...new Set(Array.from(rawDomains.slice(0, GLOSSARY_LIMITS.domainsPerLibrary),
            (domain) => normalizeGlossaryDomain(domain) ?? INVALID_DOMAIN))];
        return [{
            id: uniqueId(library.id, libraryIds, 'glossary', reservedLibraryIds),
            name: boundedText(library.name, GLOSSARY_LIMITS.nameLength) || '未命名术语库',
            enabled: library.enabled !== false,
            sourceLanguage: normalizeGlossaryLanguage(library.sourceLanguage),
            targetLanguage: normalizeGlossaryLanguage(library.targetLanguage),
            domains, entries,
            ...(origin ? {preset: origin} : {}),
        }];
    });
}

/** null 表示继承，空数组表示明确停用；移除失效 ID 不得把停用误变为继承。 */
export function normalizeGlossaryIds(
    value: unknown,
    libraries?: readonly Pick<GlossaryLibrary, 'id'>[],
): string[] | null {
    if (!Array.isArray(value)) return null;
    const known = libraries ? new Set(libraries.map((library) => library.id)) : null;
    return [...new Set(value.filter((id): id is string => typeof id === 'string'
        && ID_PATTERN.test(id) && (!known || known.has(id))))].slice(0, GLOSSARY_LIMITS.libraries);
}

/** 忽略库名称和条目标识等展示信息，但保留顺序及全部作用域；保证长任务不会混用变更前后的词表。 */
export function buildGlossaryRevision(
    libraries: readonly GlossaryLibrary[] | undefined,
    enabled: boolean | undefined,
): string {
    if (!enabled) return 'glossary-v1:disabled';
    const semantic = normalizeGlossaryLibraries(libraries).map((library) => ({
        id: library.id, enabled: library.enabled, sourceLanguage: library.sourceLanguage,
        targetLanguage: library.targetLanguage, domains: library.domains,
        entries: library.entries.map(({source, target, caseSensitive}) => ({source, target, caseSensitive})),
    }));
    return `glossary-v1:${sha256Hex(JSON.stringify(semantic))}`;
}
