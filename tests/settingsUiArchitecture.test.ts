import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function sourceBody(path: string): string {
  const content = source(path)
  const header = content.match(/^\/\*\*[\s\S]*?\*\/\s*/u)?.[0]
  return header?.includes('@file ' + path) ? content.slice(header.length) : content
}

function sectionAt(content: string, sectionStart: number): string {
  const sectionTags = /<\/?section\b[^>]*>/gu
  sectionTags.lastIndex = sectionStart
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = sectionTags.exec(content))) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return content.slice(sectionStart, sectionTags.lastIndex)
  }
  throw new Error(`Missing closing section at offset ${sectionStart}`)
}

function activeSectionSource(content: string, id: string): string {
  const openingSections = /<section\b[^>]*>/gu
  const sections: string[] = []
  let match: RegExpExecArray | null
  while ((match = openingSections.exec(content))) {
    if (match[0].includes(`props.activeSection === '${id}'`)) {
      sections.push(sectionAt(content, match.index))
    }
  }
  if (!sections.length) throw new Error(`Missing active section ${id}`)
  return sections.join('\n')
}

function settingsGroupTitles(content: string): string[] {
  return [...content.matchAll(/<SettingsGroup\b[^>]*\btitle="([^"]+)"/gu)]
    .map((match) => match[1])
}

describe('options UI composition architecture', () => {
  it('keeps the WXT options entrypoint as a thin app composition shell', () => {
    const entrypoint = sourceBody('entrypoints/options/main.ts')
    expect(entrypoint).toBe("import { mountOptionsApp } from '@/src/app/options'\n\nmountOptionsApp('#app')\n")
  })

  it('keeps the WXT popup entrypoint as a thin app composition shell', () => {
    const entrypoint = sourceBody('entrypoints/popup/main.ts')
    expect(entrypoint).toBe("import {mountPopupApp} from '@/src/app/popup';\n\nmountPopupApp('#app');\n")
  })

  it('owns settings, feature UI and shared components in their target layers', () => {
    const optionsApp = source('src/app/options/OptionsApp.vue')
    const settingsSections = source('src/features/settings/ui/SettingsSections.vue')
    const configManagement = source('src/features/settings/ui/ConfigManagement.vue')
    const localDataManagement = source('src/features/settings/ui/LocalDataManagement.vue')
    const serviceConfiguration = source('src/features/settings/ui/services/ServiceConfiguration.vue')
    const popup = source('src/app/popup/PopupApp.vue')
    const imageSettings = source('src/features/image-translation/ui/ImageOcrSettings.vue')
    const imagePublic = source('src/features/image-translation/public.ts')
    const modelUsageDashboard = source('src/features/model-usage/ui/ModelUsageDashboard.vue')
    const modelUsagePublic = source('src/features/model-usage/public.ts')

    expect(optionsApp).toContain("@/src/features/settings/ui/SettingsSections.vue")
    expect(optionsApp).toContain("@/src/features/vocabulary/ui/VocabularyBook.vue")
    expect(settingsSections).not.toContain('@/entrypoints/')
    expect(settingsSections).toContain('<style scoped src="./settings-sections.css"></style>')
    expect(settingsSections).toContain('<ImageOcrSettings />')
    expect(settingsSections).toContain("import {ModelUsageDashboard} from '@/src/features/model-usage/public'")
    expect(settingsSections).toContain("v-show=\"props.activeSection === 'settings-model-usage'\"")
    expect(settingsSections).toContain(":active=\"props.activeSection === 'settings-model-usage'\"")
    expect(modelUsagePublic).toContain("from './ui/ModelUsageDashboard.vue'")
    expect(modelUsageDashboard).toContain('id="settings-model-usage"')
    expect(modelUsageDashboard).toContain("type: 'modelUsage'")
    expect(modelUsageDashboard).toContain("action: 'query'")
    expect(modelUsageDashboard).toContain("action: 'list'")
    expect(modelUsageDashboard).not.toContain("action: 'export'")
    expect(modelUsageDashboard).not.toContain("action: 'import'")
    expect(modelUsageDashboard).toContain("action: 'reset'")
    expect(modelUsageDashboard).toContain('完整备份与恢复统一在“备份与恢复”中管理')
    expect(modelUsageDashboard).not.toContain('导出全部数据')
    expect(modelUsageDashboard).not.toContain('导入模型用量数据')
    expect(modelUsageDashboard).not.toContain('type="file"')
    expect(modelUsageDashboard).toContain('<style scoped src="./model-usage-dashboard.css"></style>')
    expect(modelUsageDashboard).toContain('snapshot.value?.selected.filter')
    expect(modelUsageDashboard).toContain('{{ appliedRangeLabel }} · {{ appliedScopeLabel }}')
    expect(modelUsageDashboard).toContain('<em v-if="loading">正在更新…</em>')
    expect(modelUsageDashboard).toContain('<el-select v-model="selectedService"')
    expect(modelUsageDashboard).toContain('averageUncachedInputTokensPerCacheReportedRequest')
    expect(modelUsageDashboard).toContain('averageCachedInputTokensPerCacheReportedRequest')
    expect(modelUsageDashboard).toContain('averageOutputTokensPerCacheReportedRequest')
    expect(modelUsageDashboard).toContain('输入（无缓存）')
    expect(modelUsageDashboard).toContain('占比 {{ formatUsageRate(selectedTotals.cachedInputTokenShare) }}')
    expect(modelUsageDashboard).toContain('usage-average-grid')
    expect(modelUsageDashboard).toContain('按${option.label}排序')
    expect(modelUsageDashboard).toContain("{key: 'requests', label: '次数'}")
    expect(modelUsageDashboard).toContain("{key: 'cache', label: '缓存'}")
    expect(modelUsageDashboard).toContain('usage-breakdown-requests')
    expect(modelUsageDashboard).toContain('usage-breakdown-total')
    expect(modelUsageDashboard).toContain(':class="{ active: appliedFilter.serviceId === row.serviceId && appliedFilter.model === row.model }"')
    expect(modelUsageDashboard).toContain('if (totalTokens <= 0) return 0')
    expect(modelUsageDashboard).not.toContain('<span>模型缓存</span>')
    expect(modelUsageDashboard).not.toContain('缓存明细覆盖')
    expect(modelUsageDashboard).toContain('次{{ selectedTotals.cacheReportedRequests < selectedTotals.reportedTokenRequests ? \'可计算\' : \'\' }}请求命中')
    expect(modelUsageDashboard).toContain('逐请求可观测记录')
    expect(modelUsageDashboard).toContain('输入命中率 ${formatUsageRate(requestCacheRate(item))}')
    expect(modelUsageDashboard).toContain('缓存创建（服务商上报）')
    expect(modelUsageDashboard).toContain('requestPageSizeOptions')
    expect(modelUsageDashboard).toContain('第 {{ requestPageIndex + 1 }} / {{ requestPageCount }} 页')
    expect(modelUsageDashboard).toContain('loadNextRequestPage')
    expect(modelUsageDashboard).toContain('@click="loadRequestPage(requestLogRetryPageIndex)"')
    expect(modelUsageDashboard).toContain('requestLogRetryPageIndex.value = pageIndex')
    expect(modelUsageDashboard).toContain('if (pageIndex === 0) requestLogTotalCount.value = response.data.totalCount')
    expect(modelUsageDashboard).toContain('不保存原文、译文、提示词、网页地址、API Key、请求体或响应正文')
    expect(modelUsageDashboard).not.toContain('MODEL_USAGE_TRANSFER_FORMAT')
    expect(modelUsageDashboard).toContain('handleRangeKeydown')
    expect(modelUsageDashboard).toContain(':tabindex="range === option.value ? 0 : -1"')
    expect(modelUsageDashboard).toContain("if (event.key === 'Home') nextIndex = 0")
    expect(modelUsageDashboard).toContain('<Teleport to="body">')
    expect(modelUsageDashboard).toContain('ref="resetCancelButton"')
    expect(modelUsageDashboard).toContain("settingsApp?.setAttribute('inert', '')")
    expect(modelUsageDashboard).toContain("querySelectorAll<HTMLButtonElement>('button:not(:disabled)')")
    expect(modelUsageDashboard).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)")
    expect(modelUsageDashboard).toContain("watch(() => props.active")
    expect(settingsSections).toContain('id="settings-translation"')
    expect(settingsSections).not.toContain('id="settings-webpage"')
    expect(settingsSections).not.toContain('id="settings-shortcuts"')
    expect(settingsSections).toContain('<ConfigManagement')
    expect(settingsSections).toContain('<SettingsGroup')
    expect(configManagement).toContain('<LocalDataManagement :config="config" />')
    expect(configManagement.indexOf('<LocalDataManagement :config="config" />'))
      .toBeLessThan(configManagement.indexOf('<header class="history-heading">'))
    expect(configManagement).toContain('<h2>设置历史</h2>')
    expect(configManagement).toContain('<h2 id="automatic-backup-title">自动设置快照</h2>')
    expect(configManagement).not.toContain('仅迁移配置')
    expect(configManagement).not.toContain('config-transfer-dialog')
    expect(configManagement).not.toContain('openExportDialog')
    const transferActions = localDataManagement.match(/<div class="transfer-actions">([\s\S]*?)<\/div>/u)?.[1]
    expect(transferActions).toBeDefined()
    expect(transferActions?.match(/<el-button\b/gu)).toHaveLength(2)
    expect(transferActions).toContain('>导出备份</el-button>')
    expect(transferActions).toContain('>从备份恢复</el-button>')
    expect(configManagement).not.toContain('prepareConfigForExport(props.config)')
    expect(configManagement).not.toContain('persist-credentials-switch')
    expect(configManagement).not.toContain('跨浏览器重启保存 API 凭据')
    expect(configManagement).not.toContain('<SettingsGroup title="凭据安全"')
    expect(configManagement).not.toContain('type="file"')
    expect(configManagement).not.toContain('downloadConfig')
    expect(localDataManagement).toContain('title="完整备份"')
    expect(localDataManagement).not.toContain('分别管理')
    expect(localDataManagement).toContain('createFluentReadDataBackup')
    expect(localDataManagement).toContain('openRestoreSource($event)')
    expect(localDataManagement).toContain('data-testid="restore-source-dialog"')
    expect(localDataManagement).toContain('粘贴旧版配置 JSON')
    expect(localDataManagement).toContain('previewPastedImport')
    expect(localDataManagement).toContain('@click="exportCompleteBackup($event)"')
    expect(localDataManagement).toContain('@click="chooseImport($event)"')
    expect(localDataManagement).toContain('@click="previewPastedImport($event)"')
    expect(localDataManagement).toContain('await focusTriggerAfterBusy(trigger)')
    expect(localDataManagement).toContain('restoreSourceVisible.value && !importPreviewVisible.value')
    expect(localDataManagement).toContain('activeElement === document.body || activeElement === document.documentElement')
    expect(localDataManagement).toContain('chooseBackupContext')
    expect(localDataManagement).toContain("confirmButtonText: '不包含并导出'")
    expect(localDataManagement).toContain("target?.kind === 'config'")
    expect(localDataManagement).not.toContain('dataset-row')
    expect(localDataManagement).not.toContain('按事件 ID')
    expect(localDataManagement).not.toContain('三个独立数据库')
    expect(serviceConfiguration).toContain('修改会自动加密保存到当前设备')
    expect(serviceConfiguration).not.toContain('默认仅保留在当前浏览器会话')
    expect(settingsSections).not.toContain('fluentReadImageOcrDownload')
    expect(imagePublic).toContain("from './ui/ImageOcrSettings.vue'")
    expect(imageSettings).toContain('当前浏览器暂不支持图片翻译与 OCR')
    expect(imageSettings).toContain("type: 'fluentReadImageOcrDownload'")
    expect(imageSettings).toContain('<style scoped src="./image-ocr-settings.css"></style>')
    expect(popup).toContain('@/src/ui/components/CustomHotkeyInput.vue')
    expect(popup).toContain('@/src/ui/components/ServiceIcon.vue')
    expect(popup).toContain('@/src/platform/browser/ids')
    expect(popup).toContain('requestConfigPatch')
    expect(popup).toContain('requestConfigSave')
    expect(popup).not.toMatch(/\bsaveConfig\b/u)
    expect(popup).not.toMatch(/(?:!tab\?\.id|filter\(tab\s*=>\s*tab\.id\))/u)
    expect(settingsSections).toContain('@/src/platform/browser/ids')
    expect(settingsSections).not.toMatch(/if\s*\(\s*!?tab\.id\s*\)/u)
  })

  it('filters Chrome-only providers in every options selector without overwriting old values', () => {
    const settings = source('src/features/settings/ui/SettingsSections.vue')
    const document = source('src/app/document-translation/DocumentApp.vue')
    const translationCenter = source('src/features/translation-center/ui/TranslationCenter.vue')

    expect(settings).toContain('filterSelectableTranslationServices(options.services)')
    expect(settings).toContain('selectedTextServiceUnavailableMessage')
    expect(settings).toContain('selectedVideoServiceUnavailableMessage')
    expect(settings).toContain('Chrome内置AI翻译（当前浏览器不可用）')
    expect(document).toContain('filterSelectableTranslationServices(options.services)')
    expect(document).toContain('requestConfigPatch')
    expect(document).toContain('subscribeConfig')
    expect(document).not.toMatch(/\bsaveConfig\b/u)
    expect(document).toContain('documentServiceUnavailableMessage')
    expect(translationCenter).toContain('filterSelectableTranslationServices(options.services)')
    expect(translationCenter).toContain('原配置会保留')
    expect(translationCenter).toContain('if (!isTranslationServiceAvailable(service)) return [service]')
  })

  it('persists document and translation-center edits as precise field patches', () => {
    const document = source('src/app/document-translation/DocumentApp.vue')
    const translationCenter = source('src/features/translation-center/ui/TranslationCenter.vue')

    expect(document).toContain('const patch: DocumentConfigPatch = {}')
    expect(document).toContain('if (value.from !== previous.from) patch.from = value.from')
    expect(document).toContain('if (value.documentService !== previous.documentService)')
    expect(document).toContain('mergeChangedDocumentModelMapping(')
    expect(document).toContain('runtimeConfig.documentModel')
    expect(document).toContain('runtimeConfig.documentCustomModel')
    expect(document).not.toContain('documentModel: value.documentModel')
    expect(document).not.toContain('documentCustomModel: value.documentCustomModel')

    expect(translationCenter).toContain("persistTranslationCenterConfig('source')")
    expect(translationCenter).toContain("persistTranslationCenterConfig('target')")
    expect(translationCenter).toContain("persistTranslationCenterConfig('services')")
    expect(translationCenter).toContain("persistTranslationCenterConfig('source', 'target')")
    expect(translationCenter).toContain('const requestedFields = new Set(fields)')
    expect(translationCenter).toContain('if (Object.keys(patch).length === 0) return')
  })

  it('uses patches for ordinary autosaves while retaining a best-effort page-exit snapshot', () => {
    const popup = source('src/app/popup/PopupApp.vue')
    const settings = source('src/features/settings/ui/SettingsSections.vue')

    for (const content of [popup, settings]) {
      expect(content).toContain('requestConfigPatch')
      expect(content).toContain('requestConfigSave')
      expect(content).toContain('persistConfigPatch(snapshot)')
      expect(content).toContain('persistConfigReplace(config.value)')
      expect(content).toContain('best-effort')
      expect(content).toContain('revision 边界会拒绝过期 replace')
      expect(content).not.toContain('replace 作为队列 flush/barrier')
    }
  })

  it('persists the latest service configuration before testing its connection', () => {
    const serviceConfiguration = source('src/features/settings/ui/services/ServiceConfiguration.vue')
    const testConnectionStart = serviceConfiguration.indexOf('async function testConnection(): Promise<void>')
    const testConnectionEnd = serviceConfiguration.indexOf('function resetCustomTemplate(): void', testConnectionStart)
    const testConnection = serviceConfiguration.slice(testConnectionStart, testConnectionEnd)
    const waitIndex = testConnection.indexOf('await waitForConfigPersistenceQueue()')
    const saveIndex = testConnection.indexOf('await requestConfigSave(config.value')
    const connectionTestIndex = testConnection.indexOf('type: CONNECTION_TEST_MESSAGE')

    expect(testConnectionStart).toBeGreaterThanOrEqual(0)
    expect(testConnectionEnd).toBeGreaterThan(testConnectionStart)
    expect(waitIndex).toBeGreaterThanOrEqual(0)
    expect(saveIndex).toBeGreaterThan(waitIndex)
    expect(connectionTestIndex).toBeGreaterThan(saveIndex)
  })

  it('exposes a configurable Local Llama Base URL', () => {
    const serviceConfiguration = source('src/features/settings/ui/services/ServiceConfiguration.vue')

    expect(serviceConfiguration).toContain('v-show="service === services.localLlama"')
    expect(serviceConfiguration).toContain('data-local-llama-base-url')
    expect(serviceConfiguration).toContain('aria-label="Local Llama Base URL"')
    expect(serviceConfiguration).toContain('v-model="config.proxy[service]"')
    expect(serviceConfiguration).toContain('http://192.168.1.50:11434/v1/chat/completions')
  })

  it('puts service selection, webpage assistance and translated-text display in General', () => {
    const settings = source('src/features/settings/ui/SettingsSections.vue')
    const general = activeSectionSource(settings, 'settings-general')
    const services = activeSectionSource(settings, 'settings-services')
    const styles = sourceBody('src/features/settings/ui/settings-sections.css')

    expect(settingsGroupTitles(general)).toEqual(['选择翻译服务', '译文显示', '网页辅助'])
    expect(general).toContain('data-testid="default-translation-service-card"')
    expect(general).toContain(':data-default-service="config.service"')
    expect(general).toContain('<SettingsItem label="默认网页翻译服务"')
    expect(general).toContain('description="全文、悬浮和划词翻译默认使用此服务。"')
    expect(general).not.toContain('全文、悬浮、划词和输入框翻译默认使用此服务')
    expect(general).toContain('<ServiceIcon :service="config.service" :label="defaultTextServiceLabel" size="medium"')
    expect(general).toContain('aria-label="默认网页翻译服务"')
    expect(general).toContain('defaultTextServiceLabel')
    expect(general).toContain('aria-label="AI 智能上下文"')
    const aiContextSwitch = general.match(/<el-switch\b[^>]*aria-label="AI 智能上下文"[^>]*\/>/u)?.[0]
    expect(aiContextSwitch).toBeDefined()
    expect(aiContextSwitch).not.toContain(':disabled')
    expect(general).toContain('label="翻译模式"')
    expect(general).toContain('aria-label="译文样式"')

    expect(services).toContain('<ServiceCatalog')
    expect(services).not.toContain('data-testid="default-translation-service-card"')
    expect(services).not.toContain('aria-label="默认网页翻译服务"')
    expect(services).not.toContain('<SettingsGroup')
    expect(styles).toContain('.service-default-control')
    expect(styles).not.toContain('.service-default-status')
    expect(styles).not.toContain('.service-default-picker')
    expect(styles).not.toContain('box-shadow: inset 4px 0 0 var(--brand);')
  })

  it('keeps translation interactions together in the requested order', () => {
    const settings = source('src/features/settings/ui/SettingsSections.vue')
    const translation = activeSectionSource(settings, 'settings-translation')

    expect(settingsGroupTitles(translation)).toEqual([
      '鼠标悬浮翻译',
      '划词翻译',
      '输入框翻译',
      '全文翻译',
    ])
    expect(translation).toContain('aria-label="鼠标悬浮快捷键"')
    expect(translation).toContain('label="划词翻译模式"')
    expect(translation).toContain('aria-label="输入框翻译触发方式"')
    expect(translation).toContain('label="全文翻译范围"')
    expect(translation).toContain('aria-label="AI 多段翻译"')
    expect(translation).toContain('v-model="config.enableAIMultiSegment"')
  })

  it('loads shared tokens before the unchanged settings page rules', () => {
    const pageStyles = sourceBody('src/features/settings/ui/settings-page.css')
    const tokens = source('src/ui/styles/tokens.css')

    expect(pageStyles.startsWith('@import "../../../ui/styles/tokens.css";')).toBe(true)
    expect(tokens).toContain('--fr-color-brand: #ef4776;')
    expect(tokens).toContain('--surface-soft: var(--fr-color-surface-soft);')
  })
})
