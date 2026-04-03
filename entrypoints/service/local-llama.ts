import { method, urls } from "../utils/constant";
import { commonMsgTemplate } from "../utils/template";
import { config } from "@/entrypoints/utils/config";
import { contentPostHandler } from "@/entrypoints/utils/check";

function normalizeEndpoint(inputUrl: string): string {
    let url = inputUrl.trim();

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    if (url.endsWith('/chat/completions')) {
        return url;
    }

    if (url.endsWith('/v1')) {
        return `${url}/chat/completions`;
    }

    return `${url}/v1/chat/completions`;
}

async function localLlama(message: any) {
    try {
        const headers = new Headers({
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.token[config.service]}`
        });

        const baseUrl = config.proxy[config.service] || urls[config.service];
        const url = normalizeEndpoint(baseUrl);

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.translationContext)
        });

        if (!resp.ok) {
            throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
        }

        const result = await resp.json();
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        console.error("API调用失败:", error);
        throw error;
    }
}

export default localLlama;
