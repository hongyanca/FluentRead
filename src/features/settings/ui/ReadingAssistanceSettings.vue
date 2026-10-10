<!--
@file src/features/settings/ui/ReadingAssistanceSettings.vue
文件职责：作为翻译设置的首项，提供双语逐句高亮开关和可立即体验的阅读示例。
主要内容：桌面左侧展示可切换网页明暗的实时预览，右侧集中展示开关、完整说明和样式入口；窄屏按预览、设置顺序纵向排列，开启后示范同步高亮，允许指针与键盘逐句体验，仅译文模式提供切回双语的入口。
模块边界：只编辑父级 Config 草稿和发出导航事件；示例不发起翻译，不向宿主网页写入节点或样式。
-->
<template>
  <SettingsGroup class="reading-assistance-settings" :title="t('options.panel.reading')">
    <div class="reading-assistance-workspace">
      <div class="reading-assistance-example">
        <TranslationStylePreview
          style-class=""
          :appearance-style="{}"
          :highlight-enabled="config.bilingualSentenceHighlightEnabled"
          :highlight-style="config.bilingualSentenceHighlightStyle"
          :highlight-appearance="config.bilingualSentenceHighlightAppearance"
          :initial-sentence="0"
          :translation-before-original="config.translationBeforeOriginal"
          :page-theme="pageTheme"
          :caption="t(config.bilingualSentenceHighlightEnabled ? 'sentenceHighlight.tryHint' : 'sentenceHighlight.offHint')"
          :customized="false"
          @update:page-theme="pageTheme = $event"
        />
        <p v-if="config.display !== 1" class="reading-assistance-note" role="status">
          {{ t('settings.translationStyle.bilingualOnly') }}
          <button type="button" @click="config.display = 1">{{ t('settings.translationStyle.switchToBilingual') }}</button>
        </p>
      </div>
      <div class="reading-assistance-controls">
        <SettingsItem id="translation-sentence-highlight" :label="t('settings.general.bilingualSentenceHighlight')">
          <template #copy>
            <strong>{{ t('settings.general.bilingualSentenceHighlight') }}</strong>
            <small>{{ t('settings.general.bilingualSentenceHighlightDescription') }} <span data-testid="sentence-highlight-grouping-hint">{{ t('settings.general.bilingualSentenceHighlightGroupingHint') }}</span></small>
          </template>
          <el-switch v-model="config.bilingualSentenceHighlightEnabled" class="settings-toggle" :aria-label="t('settings.general.bilingualSentenceHighlight')" />
        </SettingsItem>
        <SettingsItem :label="t('sentenceHighlight.title')" :description="t('sentenceHighlight.description')" stacked>
          <button type="button" class="settings-navigation-link" data-testid="open-sentence-highlight-styles" @click="emit('configureStyle')">
            <span>{{ t('sentenceHighlight.openStyles') }}</span>
            <el-icon aria-hidden="true"><ArrowRight /></el-icon>
          </button>
        </SettingsItem>
      </div>
    </div>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import {ArrowRight} from '@element-plus/icons-vue'
import type {Config} from '@/src/core/config/model'
import {useUiI18n} from '@/src/ui/i18n'
import '@/src/ui/styles/translation-display.css'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import TranslationStylePreview from './components/TranslationStylePreview.vue'
defineProps<{config: Config}>()
const emit = defineEmits<{'configureStyle': []}>()
const {t} = useUiI18n()
const pageTheme = ref<'light' | 'dark'>('light')
</script>
<style scoped>
.reading-assistance-workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 24px; padding: 20px; }
.reading-assistance-example { display: grid; min-width: 0; gap: 12px; }
.reading-assistance-controls { min-width: 0; }
.reading-assistance-controls :deep(.settings-item) { grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; min-height: 0; padding: 0 0 18px; }
.reading-assistance-controls :deep(.settings-item.stacked) { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 18px 0 0; border-top: 1px dashed var(--line) !important; }
.reading-assistance-controls :deep(.settings-item-control > .settings-navigation-link) { width: auto; }
.reading-assistance-controls :deep(.settings-toggle) { margin-top: 2px; }
.reading-assistance-note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: 12px; }
.reading-assistance-note button { border: 0; border-radius: 8px; padding: 8px 10px; color: var(--brand-strong); background: var(--brand-soft); cursor: pointer; font: inherit; font-size: 12px; }
.reading-assistance-note button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
@media (max-width: 850px) { .reading-assistance-workspace { grid-template-columns: minmax(0, 1fr); padding: 16px; gap: 20px; } }
@media (max-width: 480px) { .reading-assistance-workspace { padding: 12px; } }
</style>
