/**
 * @file src/features/settings/ui/services/promptTemplateSync.ts
 * 文件职责：为“把当前服务的提示词模板同步到所有 AI 服务”提供纯计算，列出同步目标并生成新的提示词映射。
 * 主要内容：目标为内置 AI 服务和已保存的自定义服务，排除来源服务本身；生成结果只覆盖目标服务的 system/user 模板，保留其他键原样，并返回实际发生变化的服务数量。
 * 模块边界：不读写配置存储、不弹出确认、不发起网络请求；确认交互与写回配置由 ServiceConfiguration 负责。
 */
import {servicesType} from '@/src/core/config/catalog'
import {isCustomOpenAIProviderId} from '@/src/core/config/customOpenAI'

export interface PromptTemplateSource {
  system_role: Readonly<Record<string, string>>
  user_role: Readonly<Record<string, string>>
  customOpenAIProviders?: ReadonlyArray<{readonly id: string}>
}

export interface PromptTemplateSyncResult {
  system_role: Record<string, string>
  user_role: Record<string, string>
  /** 模板内容与来源不同、因此被实际改写的服务。 */
  changed: string[]
}

/** 可接收提示词模板的服务：全部内置 AI 服务加上已保存的自定义服务，不含来源服务。 */
export function listPromptTemplateSyncTargets(source: PromptTemplateSource, service: string): string[] {
  const customIds = (source.customOpenAIProviders || []).map(provider => provider.id).filter(isCustomOpenAIProviderId)
  return [...new Set([...servicesType.AI, ...customIds])].filter(id => id !== service)
}

/** 用来源服务的 system/user 模板覆盖所有目标服务，返回新的映射而不修改入参。 */
export function syncPromptTemplates(source: PromptTemplateSource, service: string): PromptTemplateSyncResult {
  const system = source.system_role[service] ?? ''
  const user = source.user_role[service] ?? ''
  const result: PromptTemplateSyncResult = {system_role: {...source.system_role}, user_role: {...source.user_role}, changed: []}
  for (const target of listPromptTemplateSyncTargets(source, service)) {
    if (result.system_role[target] === system && result.user_role[target] === user) continue
    result.system_role[target] = system
    result.user_role[target] = user
    result.changed.push(target)
  }
  return result
}
