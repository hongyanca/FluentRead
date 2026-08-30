/**
 * @file src/features/selection-translation/background/wordLookupHandler.ts
 * 文件职责：处理划词词典查询消息，并在基础词卡可用时仅翻译当前目标语言需要展示的释义字段，失败时保留原始词卡数据。
 * 主要内容：定义 selectionWordLookup 协议和依赖，校验单词与目标语言，深拷贝词卡、收集可见释义槽位、批量翻译后按原位置回填，并由工厂返回类型化 handler。
 * 模块边界：该文件不直接请求任何词典站点或翻译 provider；词典 lookup 和 translateTexts 由后台注入，数据解析/缓存归 services/wordDictionary，组件只消费返回词卡。
 */
import type {WordCardData} from '../services/wordDictionary';

export type {
    WordCardData,
    WordDefinition,
    WordDictionarySource,
    WordMeaning,
    WordPronunciation,
} from '../services/wordDictionary';

export const SELECTION_WORD_LOOKUP_MESSAGE_TYPE = 'selectionWordLookup' as const;

export interface SelectionWordLookupMessage {
    type: typeof SELECTION_WORD_LOOKUP_MESSAGE_TYPE;
    word?: unknown;
    targetLanguage?: unknown;
}

export interface WordCardTranslationRequest {
    origin: string[];
    context: '';
    pageContext: '';
    useCache: true;
    targetLanguage: string;
}

export interface SelectionWordLookupDependencies {
    readonly lookupWord: (word: string) => Promise<WordCardData | null>;
    readonly getDefaultTargetLanguage: () => string;
    readonly translate: (request: WordCardTranslationRequest) => Promise<string | string[]>;
    readonly warn: (message: string, error: unknown) => void;
}

export interface SelectionWordLookupHandler {
    readonly type: typeof SELECTION_WORD_LOOKUP_MESSAGE_TYPE;
    handle(message: SelectionWordLookupMessage): Promise<{success: true; data: WordCardData | null}>;
}

interface WordDefinitionTranslationSlot {
    meaningIndex: number;
    definitionIndex: number;
    field: 'translatedDefinition' | 'translatedExample';
    original: string;
}

function parseWord(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('单词查询 word 必须是字符串');
    return value;
}

function parseTargetLanguage(value: unknown, fallback: string): string {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || !candidate.trim()) {
        throw new TypeError('单词查询 targetLanguage 必须是非空字符串');
    }
    return candidate;
}

function cloneWordCard(card: WordCardData): WordCardData {
    return {
        ...card,
        phonetics: card.phonetics.map((pronunciation) => ({...pronunciation})),
        meanings: card.meanings.map((meaning) => ({
            ...meaning,
            definitions: meaning.definitions.map((definition) => ({...definition})),
        })),
        sources: card.sources.map((source) => ({...source})),
    };
}

/**
 * 只翻译学习卡片中实际展示的前四组释义/例句；失败时保留词典原文。
 */
export async function translateVisibleWordCardFields(
    card: WordCardData,
    targetLanguage: string,
    translate: SelectionWordLookupDependencies['translate'],
    warn: SelectionWordLookupDependencies['warn'],
): Promise<WordCardData> {
    const slots: WordDefinitionTranslationSlot[] = [];
    for (const [meaningIndex, meaning] of card.meanings.slice(0, 4).entries()) {
        for (const [definitionIndex, definition] of meaning.definitions.slice(0, 4).entries()) {
            if (definition.definition) {
                slots.push({meaningIndex, definitionIndex, field: 'translatedDefinition', original: definition.definition});
            }
            if (definition.example) {
                slots.push({meaningIndex, definitionIndex, field: 'translatedExample', original: definition.example});
            }
        }
    }
    if (slots.length === 0) return card;

    const uniqueOrigins = [...new Set(slots.map((slot) => slot.original))];
    try {
        const translated = await translate({
            origin: uniqueOrigins,
            context: '',
            pageContext: '',
            useCache: true,
            targetLanguage,
        });
        if (!Array.isArray(translated) || translated.length !== uniqueOrigins.length) return card;

        // 步骤 1：只有 provider 返回与请求一一对应的批量结果时才克隆并写入卡片。
        const translatedByOrigin = new Map(uniqueOrigins.map((origin, index) => [origin, translated[index]]));
        const result = cloneWordCard(card);
        for (const slot of slots) {
            const value = translatedByOrigin.get(slot.original);
            if (typeof value !== 'string' || !value.trim() || value.trim() === slot.original) continue;
            const definition = result.meanings[slot.meaningIndex].definitions[slot.definitionIndex];
            definition[slot.field] = value.trim();
        }
        return result;
    } catch (error) {
        warn('[FluentRead] word definition translation unavailable; keeping dictionary text', error);
        return card;
    }
}

/** 创建划词词典查询 handler；词典 provider 与翻译 broker 由 app 层注入。 */
export function createSelectionWordLookupHandler(
    dependencies: SelectionWordLookupDependencies,
): SelectionWordLookupHandler {
    return {
        type: SELECTION_WORD_LOOKUP_MESSAGE_TYPE,
        async handle(message) {
            const word = parseWord(message.word);
            const targetLanguage = parseTargetLanguage(
                message.targetLanguage,
                dependencies.getDefaultTargetLanguage(),
            );
            const card = await dependencies.lookupWord(word);
            return {
                success: true,
                data: card
                    ? await translateVisibleWordCardFields(card, targetLanguage, dependencies.translate, dependencies.warn)
                    : null,
            };
        },
    };
}
