<script setup lang="ts">
import { ref } from 'vue'
import FeatureEnableCard from '../../src/ui/components/FeatureEnableCard.vue'
import DownloadProgress from '../../src/ui/components/DownloadProgress.vue'
import ServiceIcon from '../../src/ui/components/ServiceIcon.vue'
import SelectDemo from '../ui/SelectDemo.vue'
const enabled = ref(true)
</script>
<template>
  <div class="fr-story-stack">
    <div><h1>阅读与翻译</h1><p class="fr-story-note">组件组合示例。设置只保留在此预览中。</p></div>
    <FeatureEnableCard v-model="enabled" title="划词翻译" description="选中文字后，在阅读卡片中查看译文。" />
    <article class="fr-story-tile"><h2>翻译语言</h2><SelectDemo long-labels /></article>
    <article class="fr-story-tile"><div class="fr-story-row"><ServiceIcon service="localTranslation" /><div><h3>本地模型</h3><small>固定演示进度 · 不下载模型</small></div></div><DownloadProgress label="模型下载演示" :progress="{ loaded: 12 * 1024 * 1024, total: 32 * 1024 * 1024 }" /></article>
  </div>
</template>
