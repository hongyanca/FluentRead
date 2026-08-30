/**
 * @file src/app/offscreen/translation.ts
 * 文件职责：封装 Chrome 内置 Translation API 在 Offscreen 环境中的检测、语言规范化、翻译执行和错误解释，并兼容新旧实验接口形态。
 * 主要内容：定义最小环境与请求契约，验证 from/to 语言码并映射别名，按脚本回退检测语言，创建/销毁 detector 和 translator，支持流式或普通翻译并输出友好不可用原因。
 * 模块边界：这里不读取扩展配置、不选择第三方 provider，也不监听 runtime 消息；调用协议由 offscreen/messageRouter 管理，宿主能力是否开放由 browser capability 层决定。
 */
/** Chrome Translation API 在 Offscreen Document 中暴露的最小能力。 */
export interface ChromeTranslationEnvironment {
    readonly translation?: {
        createDetector?: () => Promise<ChromeLanguageDetector>;
        createTranslator?: (options: ChromeTranslatorOptions) => Promise<ChromeTranslator>;
    };
    readonly LanguageDetector?: {
        create: () => Promise<ChromeLanguageDetector>;
    };
    readonly Translator?: {
        create: (options: ChromeTranslatorOptions) => Promise<ChromeTranslator>;
    };
}

interface ChromeLanguageDetector {
    detect(text: string): Promise<unknown>;
    destroy?: () => void;
}

interface ChromeTranslatorOptions {
    sourceLanguage: string;
    targetLanguage: string;
}

interface ChromeTranslator {
    translate?: (text: string) => Promise<unknown>;
    translateStreaming?: (text: string) => AsyncIterable<unknown>;
    destroy?: () => void;
}

export interface ChromeTranslationRequest {
    text: string;
    from: string;
    to: string;
}

const LANGUAGE_MAP: Readonly<Record<string, string>> = {
    'zh-Hans': 'zh',
    'zh-Hant': 'zh-TW',
    en: 'en',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
    ru: 'ru',
    it: 'it',
    pt: 'pt',
    ar: 'ar',
    hi: 'hi',
    th: 'th',
    vi: 'vi',
    nl: 'nl',
    pl: 'pl',
    tr: 'tr',
};

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 解析跨进程翻译请求。协议错误在进入浏览器实验 API 前即失败，避免把
 * `null`、对象或 `to=auto` 交给底层后得到难以定位的 DOMException。
 */
export function parseChromeTranslationRequest(value: unknown): ChromeTranslationRequest {
    if (!isRecord(value)) throw new TypeError('Chrome 翻译请求 data 必须是对象');
    const text = value.text;
    if (typeof text !== 'string') throw new TypeError('Chrome 翻译文本必须是字符串');
    const from = parseLanguageCode(value.from, 'from', true);
    const to = parseLanguageCode(value.to, 'to', false);
    return {text, from, to};
}

export function parseLanguageCode(value: unknown, field: string, allowAuto: boolean): string {
    if (typeof value !== 'string') throw new TypeError(`Chrome 翻译 ${field} 必须是语言代码`);
    const language = value.trim();
    if (allowAuto && language === 'auto') return language;
    if (!language || !LANGUAGE_CODE_PATTERN.test(language)) {
        throw new TypeError(`Chrome 翻译 ${field} 语言代码无效`);
    }
    return language;
}

export function mapChromeLanguageCode(language: string): string {
    return LANGUAGE_MAP[language] ?? language;
}

export function isChromeTranslationSupported(environment: ChromeTranslationEnvironment): boolean {
    return typeof environment.translation?.createTranslator === 'function'
        || typeof environment.Translator?.create === 'function';
}

/** 无检测器或检测器失败时使用确定性的轻量脚本检测。 */
export function detectLanguageByScript(text: string): string {
    if (/[一-鿿]/u.test(text)) return 'zh';
    if (/[぀-ゟ゠-ヿ]/u.test(text)) return 'ja';
    if (/[가-힯]/u.test(text)) return 'ko';
    return 'en';
}

function detectedLanguageFrom(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const first = value[0];
    if (!isRecord(first) || typeof first.detectedLanguage !== 'string') return null;
    const detected = first.detectedLanguage.trim();
    return detected && LANGUAGE_CODE_PATTERN.test(detected) ? detected : null;
}

function safelyDestroy(resource: {destroy?: () => void}): void {
    try {
        resource.destroy?.();
    } catch {
        // 实验 API 的清理失败不能覆盖已经完成的检测或翻译结果。
    }
}

function createAbortError(): Error {
    const error = new Error('Chrome 翻译请求已取消');
    error.name = 'AbortError';
    return error;
}

function isAbortError(error: unknown): error is Error {
    return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError();
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createAbortError());
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
            callback();
        };
        const handleAbort = () => finish(() => reject(createAbortError()));
        signal.addEventListener('abort', handleAbort, {once: true});
        void promise.then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
        );
    });
}

async function acquireAbortableResource<T extends {destroy?: () => void}>(
    promise: Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    try {
        return await awaitWithAbort(promise, signal);
    } catch (error) {
        // create() 本身不可取消；若资源迟到，必须在它可用的第一刻释放。
        if (signal?.aborted) void promise.then(safelyDestroy, () => undefined);
        throw error;
    }
}

function closeStream(iterator: AsyncIterator<unknown>): void {
    try {
        if (typeof iterator.return === 'function') void Promise.resolve(iterator.return()).catch(() => undefined);
    } catch {
        // stream.return() 属于尽力清理，translator.destroy() 仍会在 finally 执行。
    }
}

export async function detectChromeLanguage(
    text: string,
    environment: ChromeTranslationEnvironment,
    signal?: AbortSignal,
): Promise<string> {
    let detector: ChromeLanguageDetector | undefined;
    try {
        throwIfAborted(signal);
        if (typeof environment.translation?.createDetector === 'function') {
            detector = await acquireAbortableResource(environment.translation.createDetector(), signal);
        } else if (typeof environment.LanguageDetector?.create === 'function') {
            detector = await acquireAbortableResource(environment.LanguageDetector.create(), signal);
        }
        if (detector) {
            const detected = detectedLanguageFrom(await awaitWithAbort(detector.detect(text), signal));
            if (detected) return detected;
        }
    } catch (error) {
        if (isAbortError(error)) throw error;
        // 浏览器可能正在下载检测模型；此时回退到脚本检测，保持离线可用。
    } finally {
        if (detector) safelyDestroy(detector);
    }
    return detectLanguageByScript(text);
}

async function createChromeTranslator(
    environment: ChromeTranslationEnvironment,
    options: ChromeTranslatorOptions,
): Promise<ChromeTranslator> {
    if (typeof environment.translation?.createTranslator === 'function') {
        return environment.translation.createTranslator(options);
    }
    if (typeof environment.Translator?.create === 'function') {
        return environment.Translator.create(options);
    }
    throw new Error('没有可用的翻译 API');
}

export async function performChromeTranslation(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    environment: ChromeTranslationEnvironment,
    signal?: AbortSignal,
): Promise<string> {
    throwIfAborted(signal);
    const translator = await acquireAbortableResource(
        createChromeTranslator(environment, {sourceLanguage, targetLanguage}),
        signal,
    );
    try {
        if (typeof translator.translateStreaming === 'function') {
            let translated = '';
            const iterator = translator.translateStreaming(text)[Symbol.asyncIterator]();
            let completed = false;
            try {
                while (true) {
                    const next = await awaitWithAbort(Promise.resolve(iterator.next()), signal);
                    if (next.done) {
                        completed = true;
                        break;
                    }
                    const chunk = next.value;
                    if (typeof chunk !== 'string') throw new Error('翻译器返回了无效的流式结果');
                    translated += chunk;
                }
            } finally {
                if (!completed) closeStream(iterator);
            }
            return translated;
        }
        if (typeof translator.translate === 'function') {
            const translated = await awaitWithAbort(translator.translate(text), signal);
            if (typeof translated !== 'string') throw new Error('翻译器返回了无效结果');
            return translated;
        }
        throw new Error('翻译器不支持翻译方法');
    } finally {
        safelyDestroy(translator);
    }
}

export function friendlyChromeTranslationError(
    error: unknown,
    sourceLanguage: string,
    targetLanguage: string,
): Error {
    if (isAbortError(error)) return error;
    const message = error instanceof Error ? error.message : String(error || '未知错误');
    if (message.includes('not available') || message.includes('not ready')) {
        return new Error('Chrome Translation API 暂时不可用。可能需要下载语言模型，请稍后重试。');
    }
    if (message.includes('language') || message.includes('not supported')) {
        return new Error(`不支持的语言组合：${sourceLanguage} -> ${targetLanguage}。请尝试其他语言对或检查浏览器版本。`);
    }
    if (message.includes('model')) {
        return new Error('翻译模型未就绪，请稍后重试或检查网络连接。');
    }
    return new Error(`翻译失败：${message}`);
}

export async function translateWithChromeApi(
    requestValue: unknown,
    environment: ChromeTranslationEnvironment,
    signal?: AbortSignal,
): Promise<string> {
    throwIfAborted(signal);
    const request = parseChromeTranslationRequest(requestValue);
    if (!request.text.trim()) return '';
    if (!isChromeTranslationSupported(environment)) {
        throw new Error('当前浏览器不支持 Chrome Translation API，请确保使用 Google Chrome 浏览器 v138 stable 或更高版本。');
    }

    let sourceLanguage = request.from;
    let targetLanguage = request.to;
    try {
        // 步骤 1：auto 只在源语言有效；检测失败由脚本规则兜底。
        if (sourceLanguage === 'auto') {
            sourceLanguage = await detectChromeLanguage(request.text, environment, signal);
        }
        sourceLanguage = mapChromeLanguageCode(sourceLanguage);
        targetLanguage = mapChromeLanguageCode(targetLanguage);

        // 步骤 2：同语言直接返回原文，不创建昂贵的语言模型。
        if (sourceLanguage === targetLanguage) return request.text;
        return await performChromeTranslation(request.text, sourceLanguage, targetLanguage, environment, signal);
    } catch (error) {
        throw friendlyChromeTranslationError(error, sourceLanguage, targetLanguage);
    }
}
