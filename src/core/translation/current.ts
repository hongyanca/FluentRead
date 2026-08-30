/**
 * @file src/core/translation/current.ts
 *
 * 文件职责：提供当前文档默认 TranslationCandidateCore 的便捷访问与候选解析入口，统一悬浮和按坐标发现行为。
 * 主要内容：懒加载共享核心实例，并导出 getCurrentTranslationCore、resolveTranslationCandidate 与 resolveTranslationCandidateAtPoint，把节点或视口坐标交给同一套候选政策。 可核对的公开符号包括 getCurrentTranslationCore、resolveTranslationCandidate、resolveTranslationCandidateAtPoint。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

import {TranslationCandidateCore} from './engine';
import {defaultTranslationAdapters} from './registry';
import type {TranslationCandidate} from './types';

let cachedHref = '';
let cachedCore: TranslationCandidateCore | null = null;

function currentHref(): string {
    const href = globalThis.location?.href ?? 'https://invalid.local/';
    try {
        return new URL(href).href;
    } catch {
        return 'https://invalid.local/';
    }
}

/** 返回所有内容脚本入口共享、按 URL 隔离的候选核心。 */
export function getCurrentTranslationCore(): TranslationCandidateCore {
    const href = currentHref();
    if (!cachedCore || cachedHref !== href) {
        cachedHref = href;
        cachedCore = new TranslationCandidateCore({url: new URL(href), adapters: defaultTranslationAdapters});
    }
    return cachedCore;
}

export function resolveTranslationCandidate(node: Node | null | undefined): TranslationCandidate | null {
    return getCurrentTranslationCore().resolve(node);
}

export function resolveTranslationCandidateAtPoint(x: number, y: number): TranslationCandidate | null {
    if (typeof document === 'undefined') return null;
    return getCurrentTranslationCore().resolveAtPoint(document, x, y);
}
