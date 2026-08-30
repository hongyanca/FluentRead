/**
 * @file src/app/background/retiredContentScripts.ts
 * 文件职责：清理升级前由已退役功能留下的持久动态内容脚本注册，避免删除源码后浏览器仍保留旧注入任务。
 * 主要内容：保存精确的历史注册 ID，先读取当前注册，再仅注销仍存在的退役项，并保持重复启动幂等。
 * 模块边界：本模块不注册新脚本、不读取配置或标签页；真实 browser.scripting 端口由后台维护组合层注入。
 */

export const RETIRED_DYNAMIC_CONTENT_SCRIPT_IDS = [
    'fluentread-x-grok-page-bridge-activator',
] as const;

export interface RetiredContentScriptRegistration {
    readonly id: string;
}

export interface RetiredContentScriptsPort {
    getRegisteredContentScripts(filter: {ids: string[]}): Promise<readonly RetiredContentScriptRegistration[]>;
    unregisterContentScripts(filter: {ids: string[]}): Promise<void>;
}

/** 只注销浏览器当前仍持有的已知退役注册，不影响其他动态内容脚本。 */
export async function unregisterRetiredContentScripts(port: RetiredContentScriptsPort): Promise<void> {
    const retiredIds = [...RETIRED_DYNAMIC_CONTENT_SCRIPT_IDS];
    const registrations = await port.getRegisteredContentScripts({ids: retiredIds});
    const registeredRetiredIds = [...new Set(
        registrations
            .map(({id}) => id)
            .filter((id) => retiredIds.includes(id as typeof retiredIds[number])),
    )];
    if (registeredRetiredIds.length === 0) return;
    await port.unregisterContentScripts({ids: registeredRetiredIds});
}
