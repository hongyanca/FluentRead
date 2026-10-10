/**
 * @file src/features/reading-assistant/sentenceAnalysis.ts
 * 文件职责：将模型的词性表格严格对应到用户选中的原文，生成可交互的句法片段。
 * 主要内容：校验固定列、片段边界、顺序、长度和数量，区分词性与句中作用；从已有作用说明取首个短分句，只规范化已明确的常见作用名称；保留未标注原文，歧义或不匹配时回退普通回答。
 * 模块边界：不推断语法、不执行模型文本、不生成 HTML；渲染与选择状态由 SentenceAnalysis.vue 管理。
 */
import {describePartOfSpeech} from '@/src/core/language/partOfSpeech';
import type {ReadingAnswerBlock} from './answerFormat';

export interface SentenceAnnotation {
    text: string;
    start: number;
    end: number;
    part: ReturnType<typeof describePartOfSpeech>;
    role: string;
    meaning: string;
}

const plain = (value: string) => value.trim().replace(/^(?:\*\*|`)|(?:\*\*|`)$/gu, '');
const word = (value: string) => /[\p{L}\p{N}_]/u.test(value);

export function anchorSentenceAnalysis(block: ReadingAnswerBlock, source: string): SentenceAnnotation[] | null {
    if (block.kind !== 'table' || !source || source.length > 4096 || block.rows.length === 0 || block.rows.length > 80) return null;
    const columns = block.headers.map(cell => plain(cell).toLowerCase());
    const expected = [['text', '原文片段'], ['pos', '词性'], ['role', '句中作用'], ['meaning', '含义']];
    if (columns.length !== 4 || columns.some((cell, index) => !expected[index].includes(cell))) return null;
    const result: SentenceAnnotation[] = [];
    let cursor = 0;
    for (const row of block.rows) {
        if (row.length !== 4) return null;
        const [text, pos, role, meaning] = row.map(plain);
        if (!text || !pos || !role || !meaning || text.length > 300 || role.length > 400 || meaning.length > 400) return null;
        // 原文顺序锚定，重复词依次消耗；不把 he 对应到 the 内部。
        const start = source.indexOf(text, cursor);
        const end = start + text.length;
        if (start < 0 || (word(text[0]) && start > 0 && word(source[start - 1]))
            || (word(text[text.length - 1]) && end < source.length && word(source[end]))) return null;
        result.push({text, start, end, part: describePartOfSpeech(pos), role, meaning});
        cursor = end;
    }
    return result;
}

/** 总览只取已有作用说明的首个分句；完整说明保留在详情中。 */
export function summarizeSentenceRole(role: string): string {
    const text = role.trim();
    const summary = text.split(/[，,；;。\n]/u)[0].trim();
    return summary || text;
}

const ROLES = [
    ['subject', '主语', ['subject', '主语', '主語', 'sujet', 'sujeto', 'подлежащее', '주어']],
    ['predicate', '谓语', ['predicate', '谓语', '謂語', '述語', 'prédicat', 'predicado', 'сказуемое', '서술어']],
    ['object', '宾语', ['object', 'direct object', '宾语', '賓語', '目的語', 'objet', 'objeto', 'дополнение', '목적어']],
    ['indirect-object', '间接宾语', ['indirect object', '间接宾语', '間接賓語', '間接目的語', 'objet indirect', 'objeto indirecto', 'косвенное дополнение', '간접 목적어']],
    ['postmodifier', '后置定语', ['postmodifier', 'post modifier', 'postposed modifier', 'postpositive modifier', 'postposed attribute', '后置定语', '後置定語', '後置修飾語', 'modificateur postposé', 'modificador pospuesto', 'постпозитивное определение', '후치 수식어']],
    ['attribute', '定语', ['attribute', 'attributive', '定语', '定語', '連体修飾語', 'épithète', 'atributo', 'определение', '관형어']],
    ['adverbial', '状语', ['adverbial', '状语', '狀語', '副詞的修飾語', 'complément circonstanciel', 'complemento circunstancial', 'обстоятельство', '부사어']],
    ['complement', '补语', ['complement', '补语', '補語', 'complément', 'complemento', 'комплемент', '보어']],
    ['modifier', '修饰语', ['modifier', '修饰语', '修飾語', 'modificateur', 'modificador', 'модификатор', '수식어']],
    ['determiner', '限定语', ['determiner', '限定语', '限定語', 'déterminant', 'determinante', 'детерминатив', '한정어']],
] as const;

/** 只映射明确名称，不从解释中的单词猜测作用；未知或否定说明仍可在详情中阅读。 */
export function describeSentenceRole(role: string): {id: string; label: string} {
    const key = summarizeSentenceRole(role).toLowerCase().replace(/[-_]/gu, ' ').replace(/\s+/gu, ' ');
    const entry = ROLES.find(item => (item[2] as readonly string[]).includes(key));
    return entry ? {id: entry[0], label: entry[1]} : {id: 'other', label: '其他'};
}
