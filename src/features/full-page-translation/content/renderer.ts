/**
 * @file src/features/full-page-translation/content/renderer.ts
 * 文件职责：把翻译返回的受限 HTML 或纯文本安全插入原页面，构造 FluentRead 双语译文节点，同时保护链接属性并触发布局截断修复。
 * 主要内容：包含 URL 协议白名单、可复制属性集合、递归节点净化、DocumentFragment 创建，以及 appendBilingualTranslation 对译文样式、显示模式和原文节点的组装。
 * 模块边界：本文件只负责安全渲染，不发起翻译或管理请求状态；服务调用归 runtime，节点所有权归 state，配置仅用于展示选项，任意脚本、事件属性和危险链接都不得穿过净化边界。
 */
import { options } from "@/src/core/config/catalog";
import { config } from "@/src/services/config/store";
import {ensureTranslationTruncationLayout} from "@/src/features/full-page-translation/content/layout";

/**
 * 译文允许保留的内联元素。
 * 翻译服务返回的结构不是可信 HTML，因此不直接把响应写入 innerHTML。
 */
const allowedTags = new Set([
    "a", "abbr", "b", "bdi", "bdo", "br", "cite", "em", "font",
    "code", "i", "kbd", "mark", "q", "ruby", "samp", "small", "span",
    "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

const blockedTags = new Set([
    "iframe", "object", "script", "style", "template", "xmp",
]);

function isSafeHref(value: string): boolean {
    try {
        const url = new URL(value, document.baseURI);
        return ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function copySafeAttributes(source: Element, target: HTMLElement): void {
    if (source.tagName.toLowerCase() === "a") {
        const href = source.getAttribute("href");
        if (href && isSafeHref(href)) target.setAttribute("href", href);

        const title = source.getAttribute("title");
        if (title) target.setAttribute("title", title);
    }
}

function sanitizeNode(node: Node): Node[] {
    if (node.nodeType === Node.TEXT_NODE) {
        return [document.createTextNode(node.nodeValue ?? "")];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const source = node as Element;
    const tag = source.tagName.toLowerCase();
    if (blockedTags.has(tag)) return [];

    const children = Array.from(source.childNodes).flatMap(sanitizeNode);

    // 不在白名单中的结构只展开其安全文本/内联子节点，避免丢失译文内容。
    if (!allowedTags.has(tag)) return children;

    const target = document.createElement(tag);
    copySafeAttributes(source, target);
    children.forEach((child) => target.appendChild(child));
    return [target];
}

/**
 * 将服务响应解析为安全的 DocumentFragment。
 * DOMParser 使用独立文档解析，随后只迁移白名单节点和安全属性。
 */
function createSafeTranslationFragment(text: string): DocumentFragment {
    const parsed = new DOMParser().parseFromString(text || "", "text/html");
    const fragment = document.createDocumentFragment();
    Array.from(parsed.body.childNodes)
        .flatMap(sanitizeNode)
        .forEach((node) => fragment.appendChild(node));
    return fragment;
}

/**
 * 双语模式：译文仍放在目标段落内部，以保持现有 DOM 断言和页面布局习惯；
 * 但具体节点由状态机保存，恢复时只移除这一份 wrapper。
 */
export interface BilingualTranslationRenderOptions {
    /** 全文会话启动时冻结的目标语言；普通悬浮翻译缺省仍读取当前配置。 */
    targetLanguage?: string;
    /** 全文会话启动时冻结的译文样式。 */
    style?: number;
}

export function appendBilingualTranslation(
    node: HTMLElement,
    text: string,
    renderOptions: BilingualTranslationRenderOptions = {},
): HTMLElement {
    node.classList.add("fluent-read-bilingual");

    const content = document.createElement("span");
    content.classList.add("fluent-read-bilingual-content");
    content.setAttribute("data-fr-translation-owned", "true");
    content.setAttribute("translate", "no");
    content.lang = (renderOptions.targetLanguage ?? config.to) || "";
    content.dir = "auto";

    const styleValue = renderOptions.style ?? config.style;
    const style = options.styles.find((item) => item.value === styleValue && !item.disabled);
    if (style?.class) content.classList.add(style.class);

    // 译文可能来自机器翻译的 HTML 或大模型的富文本响应。统一经过
    // DOMParser + 白名单迁移，既保留链接/强调等行内结构，也不把服务响应
    // 当作可信 HTML 直接写回网页。
    const fragment = createSafeTranslationFragment(text);
    content.appendChild(fragment);
    ensureTranslationTruncationLayout(node);
    node.appendChild(content);
    return content;
}
