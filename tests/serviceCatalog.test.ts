import { describe, expect, it } from 'vitest'
import {
  buildServiceGroups,
  cleanServiceLabel,
  filterModels,
  filterServiceGroups,
  getSelectedModelLabel,
  searchServiceOptions,
  splitModelOptions,
} from '@/src/ui/view-model/serviceCatalog'
import { customModelString, defaultModels, models, servicesType } from '@/src/core/config/catalog'
import { Config, normalizeConfig } from '@/src/core/config/model'

const options = [
  { value: 'machine', label: '机器翻译', disabled: true },
  { value: 'microsoft', label: '微软翻译' },
  { value: 'chromeTranslator', label: 'Chrome内置AI翻译⭐' },
  { value: 'ai', label: 'AI翻译', disabled: true },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek️' },
]

describe('service catalog helpers', () => {
  it('preserves divider-based service grouping', () => {
    expect(buildServiceGroups(options)).toEqual([
      {
        id: 'machine',
        label: '机器翻译',
        items: [
          { value: 'microsoft', label: '微软翻译' },
          { value: 'chromeTranslator', label: 'Chrome内置AI翻译' },
        ],
      },
      {
        id: 'ai',
        label: 'AI翻译',
        items: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'deepseek', label: 'DeepSeek' },
        ],
      },
    ])
  })

  it('filters services without losing their category', () => {
    const groups = buildServiceGroups(options)
    expect(filterServiceGroups(groups, '   ')).toBe(groups)
    expect(filterServiceGroups(groups, 'open')).toEqual([
      { id: 'ai', label: 'AI翻译', items: [{ value: 'openai', label: 'OpenAI' }] },
    ])
    expect(filterServiceGroups([
      { id: 'ai', label: 'AI翻译', items: [{ value: 'openai', label: 'OpenAI', description: '通用服务' }] },
    ], '通用')).toHaveLength(1)
  })

  it('filters model identifiers case-insensitively', () => {
    const modelOptions = ['gpt-5-mini', 'GPT-4o', '自定义模型']
    expect(filterModels(modelOptions, ' ')).toBe(modelOptions)
    expect(filterModels(modelOptions, 'gpt')).toEqual([
      'gpt-5-mini',
      'GPT-4o',
    ])
  })

  it('searches popup services by service name and model keyword', () => {
    const popupOptions = [
      { value: 'openai', label: 'OpenAI' },
      { value: 'tongyi', label: '千问/Qwen' },
      { value: 'microsoft', label: '微软翻译' },
    ]
    const popupModels = new Map([
      ['openai', ['gpt-5.6-luna', 'gpt-4.1-mini']],
      ['tongyi', ['qwen3.7-max', 'qwen-mt-flash']],
    ])

    expect(searchServiceOptions(popupOptions, ' open ', popupModels)).toEqual([
      { value: 'openai', label: 'OpenAI', matchingModels: [] },
    ])
    expect(searchServiceOptions(popupOptions, 'GPT 5.6', popupModels)).toEqual([
      { value: 'openai', label: 'OpenAI', matchingModels: ['gpt-5.6-luna'] },
    ])
    expect(searchServiceOptions(popupOptions, 'qwen-mt', popupModels)).toEqual([
      { value: 'tongyi', label: '千问/Qwen', matchingModels: ['qwen-mt-flash'] },
    ])
    expect(searchServiceOptions(popupOptions, '不存在', popupModels)).toEqual([])
  })

  it('searches the configured custom model and preserves the unfiltered order', () => {
    const popupOptions = [
      { value: 'custom', label: '自定义接口', description: 'OpenAI 兼容服务' },
      { value: 'microsoft', label: '微软翻译' },
    ]
    const popupModels = new Map([['custom', ['gpt-5-mini', customModelString]]])

    expect(searchServiceOptions(
      popupOptions,
      'local translation',
      popupModels,
      { custom: customModelString },
      { custom: 'local/translation-model' },
    )).toEqual([
      { value: 'custom', label: '自定义接口', description: 'OpenAI 兼容服务', matchingModels: ['local/translation-model'] },
    ])
    expect(searchServiceOptions(popupOptions, ' ( ) ', popupModels)).toEqual([])
    expect(searchServiceOptions(popupOptions, '  ', popupModels)).toEqual([
      { value: 'custom', label: '自定义接口', description: 'OpenAI 兼容服务', matchingModels: [] },
      { value: 'microsoft', label: '微软翻译', matchingModels: [] },
    ])
  })

  it('removes decorative recommendation stars from labels', () => {
    expect(cleanServiceLabel('硅基流动⭐️')).toBe('硅基流动')
  })

  it('keeps common models short and promotes the current selection', () => {
    const models = ['one', 'two', 'three', 'four', 'five', 'six']

    expect(splitModelOptions(models, 'six')).toEqual({
      common: ['one', 'two', 'three', 'six'],
      more: ['four', 'five'],
    })
  })

  it('keeps the custom model as the last option when it is selected', () => {
    expect(splitModelOptions(['one', 'two', 'three', customModelString, 'four'], customModelString)).toEqual({
      common: ['one', 'two', 'three', 'four'],
      more: [customModelString],
    })
  })

  it('does not create a more group for a short model list', () => {
    expect(splitModelOptions(['one', 'two'], 'two')).toEqual({
      common: ['one', 'two'],
      more: [],
    })
  })

  it('shows the effective model only for services that use model selection', () => {
    expect(getSelectedModelLabel('microsoft', { microsoft: 'ignored' }, {})).toBe('')
    expect(getSelectedModelLabel('openai', { openai: 'gpt-5-mini' }, {})).toBe('gpt-5-mini')
    expect(getSelectedModelLabel('openai', { openai: customModelString }, { openai: 'local-model' })).toBe('local-model')
    expect(getSelectedModelLabel('openai', { openai: customModelString }, {})).toBe(customModelString)
    expect(getSelectedModelLabel('openai', {}, {})).toBe('未选择模型')
  })

  it('为所有需要模型的 AI 服务提供自定义模型入口', () => {
    for (const service of servicesType.useModel) {
      expect(models.get(service), `${service} 缺少模型列表`).toBeDefined()
      expect(models.get(service), `${service} 缺少自定义模型`).toContain(customModelString)
    }
  })

  it('为每个需要模型的 AI 服务补齐并默认选中列表第一项', () => {
    const normalized = normalizeConfig({})

    for (const service of servicesType.useModel) {
      const defaultModel = defaultModels.get(service)
      expect(defaultModel, `${service} 缺少默认模型`).toBeTruthy()
      expect(normalized.model[service], `${service} 未选中默认模型`).toBe(defaultModel)
      expect(new Config().model[service], `${service} 的初始配置未选中默认模型`).toBe(defaultModel)
    }
  })
})
