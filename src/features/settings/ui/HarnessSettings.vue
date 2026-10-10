<!--
 * @file src/features/settings/ui/HarnessSettings.vue
 * 文件职责：作为划词翻译的学习子设置，用示例说明 AI 讲解，并明确原文范围、学习笔记和自定义指令的用途。
 * 主要内容：左侧用真实回答组件预览学习动作，右侧配置服务、模型、动作与回答偏好；多行偏好使用完整单列控件保持左侧对齐，窄屏下默认动作也纵向排列；独立展示上下文和记忆分区，提供学习中心入口；关闭讲解保留偏好，示例不发送请求。
 * 模块边界：只编辑传入 Config 的 harness 字段；记录由学习中心管理，不发起模型请求、不拥有网页选区。
 -->
<template>
  <SettingsGroup data-settings-anchor="learning" data-settings-anchor-label="AI 深入讲解" title="AI 深入讲解" description="切换左侧示例了解学习动作；在网页卡片中主动点击动作后，才向所选 AI 服务发送请求">
    <FeatureEnableCard v-model="config.harness.enabled" title="启用 AI 讲解" description="使用已配置的 AI 服务讲解原文；关闭后仍可翻译和查词，讲解偏好会保留" />
    <SettingsPreviewLayout label="AI 讲解效果预览">
      <template #preview>
        <p class="harness-preview-source" data-i18n-ignore>{{ sentenceSource }}</p>
        <p class="harness-preview-translation" data-i18n-ignore>{{ sentenceTranslation }}</p>
        <div class="harness-preview-tabs" role="group" aria-label="预览学习动作">
          <button v-for="action in visibleActions" :key="action.id" type="button" :aria-pressed="previewAction === action.id" @click="previewAction = action.id">{{ action.label }}</button>
        </div>
        <ReadingAnswer :text="previewAnswer" :source-text="sentenceSource" />
      </template>
      <div class="harness-provider-row">
        <div class="harness-provider-field">
          <label>AI 讲解服务</label>
          <el-select v-model="config.harness.service" class="harness-select" @change="config.harness.model = ''" clearable aria-label="学习讲解服务" :aria-describedby="!effectiveServiceSupportsHarness ? 'harness-service-hint' : undefined" placeholder="跟随当前默认服务" filterable>
            <el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <small v-if="!effectiveServiceSupportsHarness" id="harness-service-hint" class="service-hint" role="status">当前默认服务不能回答学习问题，请在这里选择一个 AI 服务</small>
        </div>
        <div class="harness-provider-field">
          <label>模型</label>
          <el-select v-model="config.harness.model" class="harness-select" clearable filterable allow-create default-first-option aria-label="学习讲解模型" placeholder="跟随服务模型">
            <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
          </el-select>
        </div>
      </div>
      <div class="harness-preferences">
        <SettingsItem label="卡片中的学习动作" description="“读懂”始终显示，其他动作按需显示；左侧示例同步更新" stacked>
          <div class="harness-actions">
            <label v-for="action in HARNESS_ACTIONS" :key="action.id" class="harness-action" :class="{selected: config.harness.actions.includes(action.id)}">
              <input type="checkbox" :checked="config.harness.actions.includes(action.id)" :disabled="action.id === 'meaning'" @change="toggleAction(action.id)" />
              <span><strong>{{ action.label }}<em v-if="action.id === 'meaning'">固定显示</em></strong><small>{{ action.description }}</small></span>
            </label>
          </div>
        </SettingsItem>
        <SettingsItem class="harness-default-action" label="默认学习动作">
          <el-select v-model="config.harness.defaultAction" class="harness-select" aria-label="默认动作"><el-option v-for="action in visibleActions" :key="action.id" :label="action.label" :value="action.id" /></el-select>
        </SettingsItem>
        <SettingsItem label="回答长度" description="先给出重点，需要更多解释时可以继续追问" stacked>
          <SegmentedControl v-model="config.harness.explanationDepth" :options="explanationDepthOptions" label="解释深度" />
        </SettingsItem>
        <SettingsItem label="学习程度" description="让解释和练习贴近你的水平" stacked>
          <SegmentedControl v-model="config.harness.learningLevel" :options="learningLevelOptions" label="学习程度" />
        </SettingsItem>
      </div>
    </SettingsPreviewLayout>
  </SettingsGroup>
  <SettingsGroup title="参考原文" :description="t('settings.sourceContextDescription')" data-settings-anchor="context" data-settings-anchor-label="参考原文">
    <SettingsItem label="结合哪些原文" :description="config.harness.contextMode === 'paragraph' ? '需要理解指代时参考所选文字所在的段落，不读取整页' : '只发送选中的文字，不补充周围段落'">
      <SegmentedControl v-model="config.harness.contextMode" :options="contextModeOptions" label="上下文范围" />
    </SettingsItem>
    <SettingsItem v-if="config.harness.contextMode === 'paragraph'" label="段落长度上限" description="限制补充段落的长度；不会修改你的选区">
      <SettingsNumberInput v-model="config.harness.maxContextChars" unit="字符" :min="500" :max="4000" :step="100" aria-label="上下文上限" />
    </SettingsItem>
  </SettingsGroup>
  <SettingsGroup class="harness-memory-settings" :title="t('learning.memory')" :description="t('learning.memoryDescription')" data-settings-anchor="memory" :data-settings-anchor-label="t('learning.memory')">
    <SettingsItem :label="t('settings.memoryEnabled')" :description="t('settings.memoryDescription')">
      <el-switch v-model="config.harness.memoryEnabled" :aria-label="t('settings.memoryEnabled')" />
    </SettingsItem>
    <div class="harness-memory-footer"><p>只使用你主动保存的内容，可在学习中心查看、编辑或删除</p><button type="button" @click="emit('navigate', 'settings-vocabulary')">打开学习中心 →</button></div>
  </SettingsGroup>
  <HarnessPromptSettings :preferences="config.harness" />
</template>
<script setup lang="ts">
import HarnessPromptSettings from './HarnessPromptSettings.vue';
import SettingsPreviewLayout from './components/SettingsPreviewLayout.vue';
import {ReadingAnswer} from '@/src/features/reading-assistant/public';
import {sentenceSource, sentenceTranslation, sentenceAnalysis, learningPreviewAnswers} from '@/src/core/config/selectionPreview';
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import {computed, ref, toRef, watch} from 'vue'
import {models, options} from '@/src/core/config/catalog'
import {getCustomOpenAIProviderLabel, getCustomOpenAIProviderModels, isCustomOpenAIProviderId} from '@/src/core/config/customOpenAI'
import {HARNESS_ACTIONS, isHarnessService, type HarnessActionId} from '@/src/core/config/harness'
import type {Config} from '@/src/core/config/model'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import SettingsNumberInput from './components/SettingsNumberInput.vue'
import SegmentedControl from './components/SegmentedControl.vue'
import {useUiI18n} from '@/src/ui/i18n'

const props = defineProps<{config: Config}>()
const config = toRef(props, 'config')
const emit = defineEmits<{navigate: [section: string]}>()
const previewAction = ref<HarnessActionId>(props.config.harness.defaultAction)
const previewAnswer = computed(() => previewAction.value === 'grammar' ? sentenceAnalysis : learningPreviewAnswers[previewAction.value][config.value.harness.explanationDepth])
const {t} = useUiI18n()
const serviceOptions = computed(() => [
  ...options.services.filter((item) => !item.disabled && isHarnessService(item.value)),
  ...config.value.customOpenAIProviders.filter((provider) => !options.services.some((item) => item.value === provider.id)).map((provider) => ({value: provider.id, label: getCustomOpenAIProviderLabel(config.value.customOpenAIProviders, provider.id)})),
])
const modelOptions = computed(() => {
  const service = config.value.harness.service || config.value.service
  return (isCustomOpenAIProviderId(service) ? getCustomOpenAIProviderModels(config.value.customOpenAIProviders, service) : models.get(service) || []).filter((model) => model !== '自定义模型')
})
const effectiveServiceSupportsHarness = computed(() => isHarnessService(config.value.harness.service || config.value.service, config.value.customOpenAIProviders))
const visibleActions = computed(() => HARNESS_ACTIONS.filter((action) => config.value.harness.actions.includes(action.id)))
watch(() => config.value.harness.defaultAction, (action) => { previewAction.value = action })
watch(visibleActions, (actions) => { if (!actions.some(action => action.id === previewAction.value)) previewAction.value = config.value.harness.defaultAction })
const contextModeOptions = [{value: 'paragraph', label: '可参考本段'}, {value: 'selection', label: '仅选中文字'}]
const explanationDepthOptions = [{value: 'concise', label: '简洁'}, {value: 'detailed', label: '详细'}]
const learningLevelOptions = [{value: 'beginner', label: '初级'}, {value: 'intermediate', label: '中级'}, {value: 'advanced', label: '高级'}]

function toggleAction(id: HarnessActionId) {
  if (id === 'meaning') return
  const actions = config.value.harness.actions.includes(id) ? config.value.harness.actions.filter((item) => item !== id) : [...config.value.harness.actions, id]
  config.value.harness.actions = actions.includes('meaning') ? actions : ['meaning', ...actions]
  if (!config.value.harness.actions.includes(config.value.harness.defaultAction)) config.value.harness.defaultAction = 'meaning'
}
</script>

<style scoped>
.harness-preview-source { margin:0; font-size:15px; line-height:1.7; overflow-wrap:anywhere; }
.harness-preview-translation { margin:8px 0 16px; color:var(--muted); font-size:12px; line-height:1.7; }
.harness-preview-tabs { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 16px; padding-top:16px; border-top:1px solid var(--line); }
.harness-preview-tabs button { padding:6px 10px; border:1px solid var(--line); border-radius:7px; color:var(--muted); background:var(--surface); font:inherit; font-size:11px; cursor:pointer; }
.harness-preview-tabs button[aria-pressed=true] { color:var(--brand); border-color:var(--brand); }
.harness-provider-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; padding-bottom:18px; }
.harness-provider-field { display:flex; flex-direction:column; gap:8px; min-width:0; }
.harness-provider-field > label { color:var(--ink); font-size:13px; font-weight:600; }
.service-hint { font-size:12px; line-height:1.6; color:var(--warning,#b26a00); }
.harness-select { width:100%; }
.harness-preferences :deep(.settings-item) { gap:10px; padding:16px 0; border-top:1px solid var(--line); }
.harness-preferences :deep(.settings-item-control) { width:100%; }
.harness-preferences :deep(.settings-item.harness-default-action) { grid-template-columns:minmax(0,1fr) minmax(120px,60%); align-items:center; }
.harness-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; width:100%; }
.harness-action { display:flex; gap:8px; align-items:flex-start; padding:12px; border:1px solid var(--line); border-radius:9px; cursor:pointer; }
.harness-action.selected { border-color:color-mix(in srgb,var(--brand) 45%,var(--line)); background:color-mix(in srgb,var(--brand) 4%,var(--surface)); }
.harness-action input { accent-color:var(--brand); margin:3px 0 0; }
.harness-action span { display:flex; flex-direction:column; gap:5px; color:var(--ink); font-size:12px; }
.harness-action strong { display:flex; flex-wrap:wrap; gap:4px 8px; }
.harness-action em { color:var(--muted); font-size:10px; font-style:normal; font-weight:400; }
.harness-action small { color:var(--muted); font-size:11px; line-height:1.6; }
.harness-memory-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:16px 20px; border-top:1px solid var(--line); }
.harness-memory-footer p { flex:1; min-width:180px; margin:0; color:var(--muted); font-size:12px; line-height:1.6; }
.harness-memory-footer button { padding:8px 12px; border:1px solid var(--line); border-radius:8px; color:var(--brand); background:var(--surface); font:inherit; font-size:12px; cursor:pointer; }
button:focus-visible { outline:2px solid var(--brand); outline-offset:3px; }
@media(max-width:480px) { .harness-provider-row, .harness-actions { grid-template-columns:minmax(0,1fr); } .harness-preferences :deep(.settings-item.harness-default-action) { grid-template-columns:minmax(0,1fr); align-items:stretch; } .harness-memory-footer { padding:14px 12px; } }
</style>
