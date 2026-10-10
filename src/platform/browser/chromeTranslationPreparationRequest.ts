/**
 * @file src/platform/browser/chromeTranslationPreparationRequest.ts
 * 文件职责：保存 Chrome 本地翻译模型的短期待准备语言对，并为设置页提供读取、匹配清除和跨上下文变更订阅。
 * 主要内容：为每个标准化语言对使用独立会话键，按更新时间选出最近请求，定向清除已准备语言对，并过滤订阅读回的迟到结果。
 * 模块边界：只存语言代码和更新时间到 browser.storage.session；不保存正文、不启动模型、不负责 UI 文案或翻译请求生命周期。
 */
import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';
import browser from 'webextension-polyfill';

/**
 * Chrome 本地翻译模型准备请求的短期跨页面状态。
 * 这里只保存语言代码，不保存触发请求的正文。
 */

export const CHROME_TRANSLATION_PREPARATION_STORAGE_KEY = 'fluentread.chromeTranslationPreparation';
export const CHROME_TRANSLATION_PREPARATION_STORAGE_PREFIX = `${CHROME_TRANSLATION_PREPARATION_STORAGE_KEY}.`;

export interface ChromeTranslationPreparationRequest {
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

export interface ChromeTranslationPreparationStorageArea {
    get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
}

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

function isValidLanguageCode(value: unknown): value is string {
    return typeof value === 'string' && LANGUAGE_CODE_PATTERN.test(value.trim());
}

function canonicalLanguage(value: string): string {
    const normalized = normalizeChineseLanguageCode(value.toLowerCase());
    return normalized === 'zh-Hans' ? 'zh' : normalized;
}

function parseRequest(value: unknown): ChromeTranslationPreparationRequest | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!isValidLanguageCode(record.sourceLanguage) || !isValidLanguageCode(record.targetLanguage)) return null;
    const sourceLanguage = canonicalLanguage(record.sourceLanguage);
    const targetLanguage = canonicalLanguage(record.targetLanguage);
    if (sourceLanguage === 'auto' || targetLanguage === 'auto' || sourceLanguage === targetLanguage) return null;
    return {sourceLanguage, targetLanguage};
}

function requestStorageKey(request: ChromeTranslationPreparationRequest): string {
    return `${CHROME_TRANSLATION_PREPARATION_STORAGE_PREFIX}${request.sourceLanguage}:${request.targetLanguage}`;
}

function isPreparationStorageKey(key: string): boolean {
    return key.startsWith(CHROME_TRANSLATION_PREPARATION_STORAGE_PREFIX);
}

function latestRequest(values: Record<string, unknown>): ChromeTranslationPreparationRequest | null {
    let latest: {request: ChromeTranslationPreparationRequest; updatedAt: number; key: string} | undefined;
    for (const [key, value] of Object.entries(values)) {
        if (!isPreparationStorageKey(key)) continue;
        const request = parseRequest(value);
        if (!request || key !== requestStorageKey(request)) continue;
        const updatedAt = (value as Record<string, unknown>).updatedAt;
        if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) continue;
        // 相同毫秒内的请求具有相同优先级；键排序保证跨上下文读回结果一致。
        if (!latest || updatedAt > latest.updatedAt || (updatedAt === latest.updatedAt && key > latest.key)) {
            latest = {request, updatedAt, key};
        }
    }
    return latest?.request ?? null;
}

function getStorageArea(area?: ChromeTranslationPreparationStorageArea): ChromeTranslationPreparationStorageArea | undefined {
    if (area) return area;
    try {
        return browser.storage?.session as unknown as ChromeTranslationPreparationStorageArea;
    } catch {
        return undefined;
    }
}

export function createChromeTranslationPreparationStore(area?: ChromeTranslationPreparationStorageArea) {
    const storage = getStorageArea(area);
    const get = async (): Promise<ChromeTranslationPreparationRequest | null> => {
        if (!storage?.get) return null;
        try {
            return latestRequest(await storage.get());
        } catch {
            return null;
        }
    };

    return {
        get,
        async set(request: ChromeTranslationPreparationRequest): Promise<void> {
            const parsed = parseRequest(request);
            if (!parsed || !storage?.set) return;
            try {
                await storage.set({[requestStorageKey(parsed)]: {...parsed, updatedAt: Date.now()}});
            } catch {
                // 状态提示失败不能影响翻译主链路。
            }
        },
        async clear(request?: ChromeTranslationPreparationRequest): Promise<void> {
            if (!storage?.remove) return;
            try {
                if (request) {
                    const parsed = parseRequest(request);
                    // 不做 get→remove：另一上下文的新语言对拥有独立键，不能被本次清除覆盖。
                    if (parsed) await storage.remove(requestStorageKey(parsed));
                } else {
                    const keys = Object.keys(await storage.get()).filter(isPreparationStorageKey);
                    if (keys.length) await storage.remove(keys);
                }
            } catch {
                // 状态提示失败不能影响翻译主链路。
            }
        },
        subscribe(listener: (request: ChromeTranslationPreparationRequest | null) => void): () => void {
            try {
                const onChanged = browser.storage?.onChanged;
                if (!onChanged?.addListener) return () => undefined;
                let active = true;
                let revision = 0;
                const handleChange = (changes: Record<string, unknown>, areaName: string) => {
                    if (!active || areaName !== 'session' || !Object.keys(changes).some(isPreparationStorageKey)) return;
                    const requestedRevision = ++revision;
                    void get().then((request) => {
                        if (active && revision === requestedRevision) {
                            try {
                                listener(request);
                            } catch {
                                // 展示侧订阅异常不应产生未处理的异步拒绝。
                            }
                        }
                    });
                };
                onChanged.addListener(handleChange);
                return () => {
                    active = false;
                    try {
                        onChanged.removeListener?.(handleChange);
                    } catch {
                        // 退订后仍由 active 阻止迟到的读回或事件回调。
                    }
                };
            } catch {
                return () => undefined;
            }
        },
    };
}

export const chromeTranslationPreparationStore = createChromeTranslationPreparationStore();

export function isChromeTranslationPreparationRequest(value: unknown): value is ChromeTranslationPreparationRequest {
    return parseRequest(value) !== null;
}
