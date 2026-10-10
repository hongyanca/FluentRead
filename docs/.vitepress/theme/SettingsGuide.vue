<!-- 操作位置由 capture-docs-ui.cjs 从真实生产扩展的 DOM 提取；图片为同一版本的无损截图。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import DemoSteps from './DemoSteps.vue'
import captures from './guide-ui.json'
import { useDemoPlayback } from './useDemoPlayback'
const props = defineProps<{ kind: string; en?: boolean }>()
const t = (zh: string, en: string) => (props.en ? en : zh)
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, select, replay } = useDemoPlayback(root, 3, true, 3000)
const plans = computed<
  Record<string, { image: string; title: string; steps: string[]; descriptions: string[] }>
>(() => ({
  settings: {
    image: 'settings-general',
    title: t('设置翻译语言和默认服务', 'Choose your language and default provider'),
    steps: [
      t('打开通用设置', 'Open General'),
      t('设置目标语言', 'Choose a language'),
      t('选择默认服务', 'Choose a provider'),
    ],
    descriptions: [
      t('点击通用设置', 'Open General settings'),
      t('在翻译语言中选择目标语言', 'Choose your target language'),
      t('选择默认网页翻译服务', 'Choose the default webpage provider'),
    ],
  },
  provider: {
    image: 'settings-provider',
    title: t('配置翻译服务', 'Configure a translation provider'),
    steps: [
      t('选择服务', 'Choose a provider'),
      t('填写连接信息', 'Configure connection'),
      t('设为默认服务', 'Set the default'),
    ],
    descriptions: [
      t('选择要配置的服务', 'Choose a provider to configure'),
      t('填写此服务的 API Key', 'Enter the provider’s API key'),
      t('返回通用设置选择默认服务', 'Return to General to choose your default'),
    ],
  },
  appearance: {
    image: 'settings-interface',
    title: t('调整译文样式', 'Change translation appearance'),
    steps: [
      t('打开界面风格', 'Open Appearance'),
      t('选择样式', 'Choose a style'),
      t('查看预览', 'Preview'),
    ],
    descriptions: [
      t('点击界面风格', 'Open Appearance'),
      t('选择一种译文样式', 'Choose a translation style'),
      t('在左侧查看原文和译文预览', 'Preview the original and translation'),
    ],
  },
  compare: {
    image: 'settings-translation-center',
    title: t('在翻译中心对比译文', 'Compare providers in Translation Center'),
    steps: [
      t('输入原文', 'Enter text'),
      t('管理服务', 'Manage providers'),
      t('开始翻译', 'Translate'),
    ],
    descriptions: [
      t('输入或粘贴需要翻译的文字', 'Enter or paste the text to translate'),
      t('选择需要参与对比的服务', 'Choose providers for this comparison'),
      t('点击开始翻译后查看右侧结果', 'Start translating to see results on the right'),
    ],
  },
  backup: {
    image: 'settings-data',
    title: t('导出备份和恢复数据', 'Export a backup and restore data'),
    steps: [
      t('打开备份与恢复', 'Open Backup & restore'),
      t('导出备份', 'Export backup'),
      t('从备份恢复', 'Restore from backup'),
    ],
    descriptions: [
      t('点击备份与恢复', 'Open Backup & restore'),
      t('导出后妥善保存备份文件', 'Export and store your backup securely'),
      t('选择备份文件并核对恢复内容', 'Choose a backup and review what will be restored'),
    ],
  },
  glossary: {
    image: 'settings-glossary',
    title: t('设置术语的固定译法', 'Set consistent translations for terms'),
    steps: [
      t('打开术语库', 'Open Glossary'),
      t('添加词条', 'Add a term'),
      t('使用内置词库', 'Use a built-in glossary'),
    ],
    descriptions: [
      t('点击术语库', 'Open Glossary'),
      t('添加原词和希望使用的译法', 'Add a term and its preferred translation'),
      t('也可以预览并添加内置词库', 'Preview and add a built-in glossary'),
    ],
  },
  rules: {
    image: 'settings-sites',
    title: t('设置网站偏好', 'Set preferences for a website'),
    steps: [
      t('打开网站规则', 'Open Site rules'),
      t('添加网站', 'Add a website'),
      t('查看生效预览', 'Preview applied rules'),
    ],
    descriptions: [
      t('点击网站规则', 'Open Site rules'),
      t('填写域名并选择初始偏好', 'Enter a domain and choose its preferences'),
      t('输入完整网址检查生效规则', 'Enter a full URL to preview the applied rules'),
    ],
  },
  stats: {
    image: 'settings-translation-stats',
    title: t('查看翻译统计', 'Review translation statistics'),
    steps: [
      t('打开翻译统计', 'Open Statistics'),
      t('选择时间范围', 'Choose a period'),
      t('查看请求与耗时', 'Review activity'),
    ],
    descriptions: [
      t('点击翻译统计', 'Open Translation statistics'),
      t('切换今日、7 天或 30 天', 'Choose Today, 7 days or 30 days'),
      t('查看请求量、文本量和耗时', 'Review requests, text volume and timing'),
    ],
  },
  learning: {
    image: 'settings-vocabulary',
    title: t('在学习中心查看收藏', 'Review saved items in Learning Center'),
    steps: [
      t('打开学习中心', 'Open Learning Center'),
      t('选择收藏类型', 'Filter saved items'),
      t('查看收藏内容', 'Review your collection'),
    ],
    descriptions: [
      t('点击学习中心', 'Open Learning Center'),
      t('按单词或句子筛选收藏', 'Filter your saved words and sentences'),
      t('在这里查看收藏和复习内容', 'Review saved items here'),
    ],
  },
}))
const plan = computed(() => plans.value[props.kind])
const capture = computed(
  () => captures[props.en ? 'en-US' : 'zh-CN'][plan.value.image as keyof (typeof captures)['zh-CN']]
)
const point = computed(() => capture.value.points[step.value])
const numbers = ['①', '②', '③']
</script>
<template>
  <div
    ref="root"
    class="sg"
    :data-visual="kind"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
  >
    <div class="sg-heading">
      <strong>{{ plan.title }}</strong
      ><small>{{ t('操作演示', 'Walkthrough') }}</small>
    </div>
    <DemoSteps
      :labels="plan.steps"
      :active="step"
      :label="t('操作流程', 'Workflow')"
      :playing="playing"
      :reduced="reduced"
      :en="en"
      @select="select"
    />
    <div class="sg-frame">
      <a
        :href="withBase(capture.src)"
        target="_blank"
        rel="noopener"
        :aria-label="t('查看真实界面大图', 'Open the full-size interface')"
        ><img
          :src="withBase(capture.src)"
          :width="capture.width"
          :height="capture.height"
          :alt="plan.title"
          loading="lazy"
      /></a>
      <svg class="sg-overlay" viewBox="0 0 1000 625" aria-hidden="true">
        <defs>
          <marker
            :id="`sg-arrow-${kind}`"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 10 5 0 10Z" />
          </marker>
        </defs>
        <circle :cx="point.x * 10" :cy="point.y * 6.25" r="15" />
        <path
          :d="`M500 650 L${point.x * 10} ${point.y * 6.25}`"
          :marker-end="`url(#sg-arrow-${kind})`"
        />
      </svg>
    </div>
    <div
      class="sg-description"
      :data-callout-step="step + 1"
      :aria-live="playing ? 'off' : 'polite'"
    >
      <b>{{ numbers[step] }}</b
      ><span>{{ plan.descriptions[step] }}</span>
    </div>
    <div class="sg-controls">
      <small>{{
        t('真实扩展界面 · 点击图片查看大图', 'Real extension interface · click to enlarge')
      }}</small>
      <div>
        <button v-if="!reduced" type="button" @click="playing = !playing">
          {{ playing ? t('Ⅱ 暂停', 'Ⅱ Pause') : t('▷ 播放', '▷ Play') }}</button
        ><button type="button" @click="replay">{{ t('↻ 重播', '↻ Replay') }}</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.sg {
  container-type: inline-size;
  margin: 24px 0;
  overflow: hidden;
  border: 1px solid var(--fr-line);
  border-radius: 12px;
  background: white;
  color: var(--fr-ink);
}
.sg-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--fr-line);
  font-size: 12px;
}
.sg-heading small,
.sg-controls small {
  color: var(--fr-muted);
  font-size: 10px;
}
.sg-frame {
  position: relative;
  margin: 0 12px;
  border: 1px solid var(--fr-line);
  border-radius: 8px;
}
.sg-frame img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
}
.sg-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.sg-overlay circle {
  fill: #fff4f855;
  stroke: #b92252;
  stroke-width: 3;
}
.sg-overlay > path {
  fill: none;
  stroke: #b92252;
  stroke-width: 3;
}
.sg-overlay marker path {
  fill: #b92252;
}
.sg-description {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  margin: 10px 12px 12px;
  padding: 8px 12px;
  border: 1px solid #eed3dc;
  border-radius: 7px;
  background: #fff7fa;
  color: #b92252;
  font-size: 12px;
  line-height: 1.5;
}
.sg-description b {
  flex: none;
  font-size: 20px;
}
.sg-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--fr-line);
}
.sg-controls > div {
  display: flex;
  gap: 16px;
  flex-shrink: 0;
}
.sg-controls button {
  border: 0;
  background: none;
  color: #b92252;
  font-size: 11px;
  cursor: pointer;
}
@container (max-width:480px) {
  .sg-heading {
    padding: 12px;
  }
  .sg-frame {
    margin: 0 8px;
  }
  .sg-description {
    font-size: 11px;
  }
  .sg-controls {
    padding: 12px;
    flex-wrap: wrap;
  }
  .sg-controls small {
    font-size: 9px;
  }
}
</style>
