import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NAVIGATION_SECTION,
  filterNavigationItems,
  navigationGroups,
  navigationItems,
  resolveNavigationItem,
  resolveRequestedSection,
} from '@/src/features/settings/model/navigation'

describe('options navigation view-model', () => {
  it('keeps the twelve sections unique, grouped exactly once and in the product IA order', () => {
    const groupedItems = navigationGroups.flatMap((group) => group.items)
    expect(groupedItems).toEqual(navigationItems)
    expect(new Set(navigationItems.map((item) => item.id)).size).toBe(navigationItems.length)
    expect(navigationGroups.map((group) => ({
      label: group.label,
      items: group.items.map((item) => item.id),
    }))).toEqual([
      {
        label: '基础配置',
        items: ['settings-general', 'settings-services', 'settings-translation'],
      },
      {
        label: '专项翻译',
        items: [
          'settings-image-translation',
          'settings-video',
          'settings-sites',
        ],
      },
      {
        label: '工具与学习',
        items: ['settings-translation-center', 'settings-model-usage', 'settings-vocabulary'],
      },
      {
        label: '系统与数据',
        items: ['settings-advanced', 'settings-data', 'settings-about'],
      },
    ])
    expect(navigationItems.map((item) => item.label)).toEqual([
      '通用设置',
      '翻译服务',
      '翻译设置',
      '图片与圈选翻译',
      '视频字幕翻译',
      '网站规则',
      '翻译中心',
      '模型用量',
      '单词本',
      '高级选项',
      '备份与恢复',
      '关于流畅阅读',
    ])
    expect(resolveNavigationItem('settings-translation')).toMatchObject({
      group: '基础配置',
      kicker: '基础配置',
    })
    expect(DEFAULT_NAVIGATION_SECTION).toBe('settings-general')
  })

  it('resolves valid sections and falls back for malformed hashes', () => {
    expect(resolveNavigationItem('settings-services').title).toBe('翻译服务')
    expect(resolveNavigationItem('settings-translation').title).toBe('翻译设置')
    expect(resolveNavigationItem('settings-model-usage').detail)
      .toBe('查看发起的大模型调用、Token 消耗与使用趋势。')
    expect(resolveNavigationItem('missing').id).toBe(DEFAULT_NAVIGATION_SECTION)
    expect(resolveRequestedSection('#settings-video')).toBe('settings-video')
    expect(resolveRequestedSection('settings-sites')).toBe('settings-sites')
    expect(resolveRequestedSection('#settings-webpage')).toBe('settings-translation')
    expect(resolveRequestedSection('#settings-shortcuts')).toBe('settings-translation')
    expect(resolveRequestedSection('#missing')).toBe(DEFAULT_NAVIGATION_SECTION)
  })

  it('searches all user-facing metadata case-insensitively and trims input', () => {
    expect(filterNavigationItems(' OPENAI ')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'settings-services' }),
      expect.objectContaining({ id: 'settings-model-usage' }),
    ]))
    expect(filterNavigationItems('主域名')).toEqual([
      expect.objectContaining({ id: 'settings-sites' }),
    ])
    expect(filterNavigationItems('AI 智能上下文')).toEqual([
      expect.objectContaining({ id: 'settings-general' }),
    ])
    expect(filterNavigationItems('鼠标悬浮')).toEqual([
      expect.objectContaining({ id: 'settings-translation' }),
    ])
    expect(filterNavigationItems('AI 多段翻译')).toEqual([
      expect.objectContaining({ id: 'settings-translation' }),
    ])
    expect(filterNavigationItems(' KIMI ')).toEqual([
      expect.objectContaining({ id: 'settings-model-usage' }),
    ])
    expect(filterNavigationItems('Token')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'settings-model-usage' }),
    ]))
    expect(filterNavigationItems('备份与恢复')).toEqual([
      expect.objectContaining({ id: 'settings-data' }),
    ])
    expect(filterNavigationItems('')).toEqual([])
    expect(filterNavigationItems('不存在的设置项')).toEqual([])
  })
})
