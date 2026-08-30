/**
 * @file src/core/translation/types.ts
 *
 * 文件职责：定义翻译候选核心的基础类型契约，使引擎、布局、序列化和站点适配器能够以一致结构协作。
 * 主要内容：包含候选 kind、AdapterDecision、AdapterContext、TranslationSiteAdapter、TranslationCandidate 与 TranslationCoreOptions，明确适配器输入、候选来源和可注入依赖。 可核对的公开符号包括 TranslationCandidateKind、AdapterDecision、AdapterContext、TranslationSiteAdapter、TranslationCandidate、TranslationCoreOptions。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

export type TranslationCandidateKind = 'content' | 'control';

export type AdapterDecision =
    | {kind: 'pass'}
    | {kind: 'skip-self'; reason: string}
    | {kind: 'prune-subtree'; reason: string}
    | {
        kind: 'force-target';
        reason: string;
        target?: Element;
        candidateKind?: TranslationCandidateKind;
        atomic?: boolean;
    };

export interface AdapterContext {
    url: URL;
}

export interface TranslationSiteAdapter {
    id: string;
    priority?: number;
    matches(url: URL): boolean;
    decide(element: Element, context: AdapterContext): AdapterDecision;
    shouldStayOriginal?(element: Element, context: AdapterContext): boolean;
    shouldIgnoreMutation?(element: Element, context: AdapterContext): boolean;
}

export interface TranslationCandidate {
    /** 用于观察和渲染的宿主；内联 run 候选只物化 `nodes`。 */
    element: HTMLElement;
    /** 块内同时包含内联文本与块级子节点时使用的连续直接子节点。 */
    nodes?: readonly ChildNode[];
    kind: TranslationCandidateKind;
    reason: string;
    adapterId?: string;
}

export interface TranslationCoreOptions {
    url?: URL;
    adapters?: readonly TranslationSiteAdapter[];
}
