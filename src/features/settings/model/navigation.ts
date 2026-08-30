/**
 * @file src/features/settings/model/navigation.ts
 * 文件职责：定义设置中心侧边栏的导航信息模型，并提供默认分区、哈希解析与搜索过滤等不依赖 Vue 或浏览器 API 的纯规则。
 * 主要内容：包含按功能分组的标题、副标题、图标、关键词和 section ID，派生扁平 navigationItems，导出 resolveNavigationItem、resolveRequestedSection 与 filterNavigationItems。
 * 模块边界：该模块只描述导航元数据，不切换 DOM、不写 location.hash 也不保存配置；Options 页面负责路由同步，SettingsSections.vue 负责各分区实际内容。
 */
export type NavigationItem = {
  id: string
  icon: string
  label: string
  description: string
  group: string
  heading: string
  summary: string
  kicker: string
  title: string
  detail: string
  searchDescription: string
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: '基础配置',
    items: [
      {
        id: 'settings-general', icon: '⌂', label: '通用设置', description: '服务、显示与网页辅助', group: '基础配置',
        heading: '通用设置', summary: '选择默认翻译服务，并管理译文显示、网页辅助和基础偏好。',
        kicker: '基础配置', title: '通用设置', detail: '选择翻译服务，设置译文显示、网页辅助与界面偏好。',
        searchDescription: '选择翻译服务、默认服务、译文显示、网页辅助、AI 智能上下文、默认目标语言、主题',
      },
      {
        id: 'settings-services', icon: '译', label: '翻译服务', description: '服务与模型', group: '基础配置',
        heading: '配置翻译服务与模型', summary: '按机器翻译和 AI 翻译分类，配置各服务的模型、连接参数与凭据。',
        kicker: '基础配置', title: '翻译服务', detail: '配置可用的翻译服务、模型、连接和凭据。',
        searchDescription: '微软翻译、OpenAI、DeepSeek、Gemini、模型与令牌',
      },
      {
        id: 'settings-translation', icon: '译', label: '翻译设置', description: '悬浮、划词、输入框与全文', group: '基础配置',
        heading: '翻译设置', summary: '按使用顺序管理鼠标悬浮、划词、输入框和全文翻译。',
        kicker: '基础配置', title: '翻译设置', detail: '设置鼠标悬浮、划词、输入框与全文翻译的触发方式。',
        searchDescription: '鼠标悬浮翻译、划词翻译、输入框翻译、全文翻译、AI 多段翻译、自定义快捷键、右键菜单、悬浮球、翻译进度',
      },
    ],
  },
  {
    label: '专项翻译',
    items: [
      {
        id: 'settings-image-translation', icon: '图', label: '图片与圈选翻译', description: '图片、圈选与 OCR', group: '专项翻译',
        heading: '图片与圈选翻译', summary: '管理网页图片、圈选区域和本地 OCR 语言包。',
        kicker: '专项翻译', title: '图片与圈选翻译', detail: '控制图片与圈选翻译，并按需准备本地 OCR 语言包。',
        searchDescription: '图片翻译、圈选翻译、区域翻译、OCR、语言包、中文、英文、日文、下载',
      },
      {
        id: 'settings-video', icon: 'CC', label: '视频字幕翻译', description: 'YouTube 边看边译', group: '专项翻译',
        heading: '视频字幕翻译', summary: '在 YouTube 原生字幕下方显示译文，并独立选择视频翻译服务。',
        kicker: '专项翻译 Beta', title: '视频字幕翻译', detail: '设置 YouTube 字幕翻译服务、显示方式和字号。',
        searchDescription: 'YouTube、视频字幕、视频翻译服务、显示模式、字幕字号、DeepLX、微软翻译',
      },
      {
        id: 'settings-sites', icon: '站', label: '网站规则', description: '自动翻译与禁用名单', group: '专项翻译',
        heading: '网站规则', summary: '按网站主域名设置自动翻译或禁用扩展。',
        kicker: '专项翻译', title: '网站规则', detail: '规则按主域名保存，并自动应用到同一网站的所有子域。',
        searchDescription: '网站、域名、网址、主域名、自动翻译、始终翻译、禁用扩展与子域',
      },
    ],
  },
  {
    label: '工具与学习',
    items: [
      {
        id: 'settings-translation-center', icon: '译', label: '翻译中心', description: '多服务对比', group: '工具与学习',
        heading: '比较不同翻译服务', summary: '输入一句话，同时查看多个翻译服务的结果，并支持重复翻译。',
        kicker: '翻译工具', title: '翻译中心', detail: '用同一句话比较不同服务的译文表现。',
        searchDescription: '多服务翻译、翻译对比、重复翻译、句子翻译',
      },
      {
        id: 'settings-model-usage', icon: '▥', label: '模型用量', description: 'Token、缓存与请求记录', group: '工具与学习',
        heading: '查看大模型调用用量', summary: '按服务、模型和时间范围查看本机 FluentRead 的请求与 Token。',
        kicker: '本地工具', title: '模型用量', detail: '查看发起的大模型调用、Token 消耗与使用趋势。',
        searchDescription: '模型用量、调用统计、Token、请求记录、耗时、输入 Token、输出 Token、缓存输入、缓存写入、缓存命中率、导入、导出、Kimi、月之暗面、OpenAI、DeepSeek',
      },
      {
        id: 'settings-vocabulary', icon: '★', label: '单词本', description: '收藏与复习', group: '工具与学习',
        heading: '把阅读中遇到的词真正学会', summary: '收藏划词卡中的英文单词，用轻量复习跟踪从新词到掌握的过程。',
        kicker: '本地学习 Beta', title: '单词本', detail: '词条、上下文与复习记录只保存在当前浏览器；可在这里复习或导出到 Anki。',
        searchDescription: '单词本、收藏、复习、掌握程度、学习记录、Anki、导入导出',
      },
    ],
  },
  {
    label: '系统与数据',
    items: [
      {
        id: 'settings-advanced', icon: '◇', label: '高级选项', description: '性能与模板', group: '系统与数据',
        heading: '高级选项', summary: '管理缓存、并发和动画等低频运行策略。',
        kicker: '系统与数据', title: '高级选项', detail: '调整缓存、并发和动画；不确定时建议保留默认值。',
        searchDescription: '缓存、动画、并发、性能、资源占用',
      },
      {
        id: 'settings-data', icon: '⇅', label: '备份与恢复', description: '导出备份、恢复数据', group: '系统与数据',
        heading: '备份与恢复 FluentRead', summary: '一次备份设置、单词本和模型用量，也可找回之前的设置。',
        kicker: '系统与数据', title: '备份与恢复', detail: '导出或恢复设置、单词本和模型用量，并查看自动保存的设置历史。',
        searchDescription: '备份、恢复、最近修改、自动设置快照、六小时、差异、迁移、单词本、模型用量、导出与导入',
      },
      {
        id: 'settings-about', icon: 'i', label: '关于流畅阅读', description: '版本与项目', group: '系统与数据',
        heading: '关于流畅阅读', summary: '了解插件版本、核心体验与项目入口。',
        kicker: '关于项目', title: '关于流畅阅读', detail: '一个让双语阅读更自然的开源浏览器翻译插件。',
        searchDescription: '版本、开源项目、使用文档与问题反馈',
      },
    ],
  },
]

export const navigationItems = navigationGroups.flatMap((group) => group.items)

/** 旧链接仍定位到合并后的“翻译设置”，但不再作为独立导航项展示。 */
export const NAVIGATION_SECTION_ALIASES: ReadonlyMap<string, string> = new Map([
  ['settings-webpage', 'settings-translation'],
  ['settings-shortcuts', 'settings-translation'],
])

export const DEFAULT_NAVIGATION_SECTION = navigationItems[0].id

/** 根据 section id 返回有效导航项，无效值稳定回落到通用设置。 */
export function resolveNavigationItem(sectionId: string): NavigationItem {
  const resolvedSection = NAVIGATION_SECTION_ALIASES.get(sectionId) ?? sectionId
  return navigationItems.find((item) => item.id === resolvedSection) ?? navigationItems[0]
}

/** 统一解析 URL hash，避免入口组件重复维护导航校验。 */
export function resolveRequestedSection(hash: string): string {
  const requestedSection = hash.startsWith('#') ? hash.slice(1) : hash
  const resolvedSection = NAVIGATION_SECTION_ALIASES.get(requestedSection) ?? requestedSection
  return navigationItems.some((item) => item.id === resolvedSection)
    ? resolvedSection
    : DEFAULT_NAVIGATION_SECTION
}

/** 搜索设置标题、分组说明和帮助文案；空查询不展示结果面板。 */
export function filterNavigationItems(query: string): NavigationItem[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return []

  return navigationItems.filter((item) =>
    `${item.label}${item.description}${item.heading}${item.summary}${item.searchDescription}`
      .toLocaleLowerCase()
      .includes(keyword),
  )
}
