/**
 * @file src/features/image-translation/content/mangaBackground.ts
 * 文件职责：读取已适配阅读器公开展示的同源背景图片，复用漫画画布的翻译、压缩缓存与隔离译图。
 * 主要内容：串行探测附近页的尺寸和可读性，探测后立即释放解码图片；按 contain 与背景位置计算真实绘制范围，来源更换或离开正文时取消探测，完整快照遵守现有会话调度与像素预算。
 * 模块边界：只支持单层、无重复、无边框内距的同源 blob 正文；不访问章节接口、不改背景样式，无法读取的页面继续使用圈选入口。
 */
import {createMangaCanvas} from './mangaCanvas';

interface BackgroundPage {url: string; width: number; height: number; ready: boolean; cancel: (() => void) | null}
const validSize = (width: number, height: number) => width >= 80 && height >= 40 && width <= 8192 && height <= 8192 && width * height <= 16_000_000;

export function createMangaBackground(ports: Parameters<typeof createMangaCanvas<HTMLElement>>[0] & {ready: () => void}) {
    let pages = new WeakMap<HTMLElement, BackgroundPage>();
    let disposed = false, probing: HTMLElement | null = null;

    function descriptor(element: HTMLElement): {url: string; x: number; y: number} | null {
        const style = getComputedStyle(element);
        if (style.backgroundSize !== 'contain' || style.backgroundRepeat !== 'no-repeat' || style.backgroundOrigin !== 'padding-box') return null;
        if ([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft,
            style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(value => parseFloat(value) > 0)) return null;
        const url = /^url\(["']?(blob:[^"')]+)["']?\)$/.exec(style.backgroundImage)?.[1];
        if (!url || new URL(url).origin !== window.location.origin) return null;
        const positions = style.backgroundPosition.split(' ');
        if (positions.length !== 2 || positions.some(value => !/^(?:0px|\d+(?:\.\d+)?%)$/.test(value) || parseFloat(value) > 100)) return null;
        return {url, x: parseFloat(positions[0]) / 100, y: parseFloat(positions[1]) / 100};
    }

    function load(url: string, signal: AbortSignal, use: (image: HTMLImageElement) => void): Promise<void> {
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const image = new Image();
            const finish = (error?: unknown) => {
                clearTimeout(timeout);signal.removeEventListener('abort', abort);
                image.onload = image.onerror = null;image.src = '';
                if (error) reject(error);else resolve();
            };
            const abort = () => finish(new DOMException('已取消', 'AbortError'));
            const timeout = setTimeout(() => finish(new Error('背景图片加载超时')), 15_000);
            image.onload = () => {try {use(image);finish();} catch (error) {finish(error);}};
            image.onerror = () => finish(new Error('背景图片无法读取'));
            signal.addEventListener('abort', abort, {once: true});
            image.src = url;
        });
    }

    function probe(element: HTMLElement, url: string): void {
        const page: BackgroundPage = {url, width: 0, height: 0, ready: false, cancel: null};
        const controller = new AbortController();
        pages.set(element, page);probing = element;page.cancel = () => controller.abort();
        void load(url, controller.signal, image => {
            if (!validSize(image.naturalWidth, image.naturalHeight)) throw new Error('背景图片尺寸超出范围');
            const sample = document.createElement('canvas');sample.width = sample.height = 8;
            try {
                const context = sample.getContext('2d', {willReadFrequently: true});
                if (!context) throw new Error('浏览器不支持图片处理');
                context.drawImage(image, 0, 0, 8, 8);context.getImageData(0, 0, 8, 8);
                page.width = image.naturalWidth;page.height = image.naturalHeight;page.ready = true;
            } finally {sample.width = sample.height = 0;}
        }).catch(() => { /* 已失效、受污染或失败的来源不重试循环，保留原文和圈选入口。 */ }).finally(() => {
            page.cancel = null;
            if (probing === element && pages.get(element) === page) probing = null;
            if (!disposed && pages.get(element) === page) ports.ready();
        });
    }

    function forget(element: HTMLElement): void {
        const page = pages.get(element);
        if (!page) return;
        pages.delete(element);page.cancel?.();
        if (probing === element) probing = null;
    }
    function identity(element: HTMLElement): string | null {
        if (disposed || !element.isConnected) return null;
        const value = descriptor(element);
        if (!value) {forget(element);return null;}
        if (pages.get(element)?.url !== value.url) forget(element);
        let page = pages.get(element);
        if (!page && !probing) {
            const rect = element.getBoundingClientRect();
            if (rect.width >= 80 && rect.height >= 40 && rect.right > -window.innerWidth && rect.left < 2 * window.innerWidth
                && rect.bottom > -window.innerHeight && rect.top < 2 * window.innerHeight) {
                probe(element, value.url);page = pages.get(element);
            }
        }
        return page?.ready ? `${page.url}:${page.width}:${page.height}` : null;
    }
    function bounds(element: HTMLElement): DOMRect {
        const rect = element.getBoundingClientRect(), page = pages.get(element)!, position = descriptor(element)!;
        const scale = Math.min(rect.width / page.width, rect.height / page.height);
        const width = page.width * scale, height = page.height * scale;
        return new DOMRect(rect.left + (rect.width - width) * position.x, rect.top + (rect.height - height) * position.y, width, height);
    }
    const surface = createMangaCanvas<HTMLElement>({...ports, source: {
        identity, bounds,
        capture: (element, target, signal) => {
            const page = pages.get(element)!;
            return load(page.url, signal, image => {
                if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw new Error('背景图片来源已更换');
                target.width = page.width;target.height = page.height;
                const context = target.getContext('2d');
                if (!context) throw new Error('浏览器不支持图片处理');
                context.drawImage(image, 0, 0);
            });
        },
    }});
    const clear = () => {if (probing) forget(probing);pages = new WeakMap();surface.resetCache();};
    return {...surface, bounds,
        pixels: (element: HTMLElement) => {const page = pages.get(element)!;return page.width * page.height;},
        prepare(elements: HTMLElement[]) {
            if (probing && !elements.includes(probing)) forget(probing);
        },
        resetCache: clear,
        dispose() {disposed = true;clear();surface.dispose();},
    };
}
