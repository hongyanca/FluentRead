/**
 * @file src/ui/view-model/serviceCatalog.ts
 * 文件职责：为服务与模型选择界面提供无框架的视图模型转换，把扁平配置选项整理成可搜索、可分组和可稳定展示的数据。
 * 主要内容：定义 ServiceOption/ServiceGroup，清理标签星标，按 disabled 分隔项构建服务组，按服务或模型关键词筛选并返回命中模型，解析当前模型标签，并把常用、选中和自定义模型稳定拆分。
 * 模块边界：这些函数不读取 Vue 状态、不修改 Config，也不判断平台能力或发起连接测试；原始目录由 core/config 提供，Popup/Options 等调用方负责交互与渲染。
 */
import { customModelString, resolveConfiguredModel, servicesType } from '@/src/core/config/catalog'

export interface ServiceOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export interface ServiceGroup {
  id: string
  label: string
  items: ServiceOption[]
}

export interface ServiceSearchOption extends ServiceOption {
  matchingModels: string[]
}

export function cleanServiceLabel(label: string) {
  return label.replace(/[⭐️★]+/gu, '').trim()
}

export function buildServiceGroups(options: ServiceOption[]): ServiceGroup[] {
  const groups: ServiceGroup[] = []
  let current: ServiceGroup = { id: 'other', label: '其他服务', items: [] }

  for (const option of options) {
    if (option.disabled) {
      if (current.items.length) groups.push(current)
      current = {
        id: option.value,
        label: cleanServiceLabel(option.label),
        items: [],
      }
      continue
    }
    current.items.push({ ...option, label: cleanServiceLabel(option.label) })
  }

  if (current.items.length) groups.push(current)
  return groups
}

export function filterServiceGroups(groups: ServiceGroup[], query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return groups

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.label}${item.value}${item.description || ''}`.toLocaleLowerCase().includes(keyword),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

export function filterModels(modelOptions: string[], query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return modelOptions
  return modelOptions.filter((model) => model.toLocaleLowerCase().includes(keyword))
}

function searchTextMatches(value: string, rawKeyword: string, compactKeyword: string) {
  const normalizedValue = value.normalize('NFKC').toLocaleLowerCase()
  if (normalizedValue.includes(rawKeyword)) return true
  if (!compactKeyword) return false
  return normalizedValue.replace(/[\s._/()-]+/gu, '').includes(compactKeyword)
}

export function searchServiceOptions(
  serviceOptions: ServiceOption[],
  query: string,
  modelOptions: ReadonlyMap<string, readonly string[]>,
  selectedModels: Record<string, string> = {},
  customModels: Record<string, string> = {},
): ServiceSearchOption[] {
  const rawKeyword = query.trim().normalize('NFKC').toLocaleLowerCase()
  if (!rawKeyword) return serviceOptions.map((item) => ({ ...item, matchingModels: [] }))

  const compactKeyword = rawKeyword.replace(/[\s._/()-]+/gu, '')
  return serviceOptions.flatMap((item) => {
    const selectedModel = selectedModels[item.value]
    const configuredModel = resolveConfiguredModel(selectedModel, customModels[item.value])
    const searchableModels = Array.from(new Set([
      ...(modelOptions.get(item.value) || []),
      selectedModel,
      configuredModel,
    ].filter((model): model is string => Boolean(model))))
    const matchingModels = searchableModels.filter((model) => searchTextMatches(model, rawKeyword, compactKeyword))
    const serviceMatches = searchTextMatches(
      `${item.label} ${item.value} ${item.description || ''}`,
      rawKeyword,
      compactKeyword,
    )

    return serviceMatches || matchingModels.length > 0
      ? [{ ...item, matchingModels }]
      : []
  })
}

export function getSelectedModelLabel(
  service: string,
  selectedModels: Record<string, string>,
  customModels: Record<string, string>,
) {
  if (!servicesType.isUseModel(service)) return ''

  const selectedModel = selectedModels[service]
  const configuredModel = resolveConfiguredModel(selectedModel, customModels[service])
  return configuredModel || (selectedModel === customModelString ? customModelString : '未选择模型')
}

export function splitModelOptions(modelOptions: string[], selectedModel = '', visibleCount = 4) {
  // 自定义模型是一个输入入口，不应因为当前选中而被提到常用模型区。
  // 即使调用方传入的列表顺序不稳定，也要保证它在完整列表的最后。
  const regularModels = modelOptions.filter((model) => model !== customModelString)
  const customModels = modelOptions.filter((model) => model === customModelString)
  const orderedModels = [...regularModels, ...customModels]
  const common = orderedModels.slice(0, visibleCount)

  if (
    selectedModel
    && selectedModel !== customModelString
    && orderedModels.includes(selectedModel)
    && !common.includes(selectedModel)
  ) {
    common.splice(Math.max(visibleCount - 1, 0), 1, selectedModel)
  }

  return {
    common,
    more: orderedModels.filter((model) => !common.includes(model)),
  }
}
