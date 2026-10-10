<!--
 * @file src/ui/components/TranslationLoadingPreview.vue
 * 文件职责：在设置界面中复用网页运行时的真实段落加载指示器，保证样式预览与最终效果一致。
 * 主要内容：按传入样式与动画开关创建隔离指示器，并在选择变化时替换旧实例、自动停止已移除节点的 CSS 动画。
 * 模块边界：本组件只承载视觉预览，不修改配置、不插入网页正文，也不管理翻译状态。
-->
<template>
  <span ref="container" class="translation-loading-preview-runtime" aria-hidden="true" />
</template>

<script lang="ts" setup>
import {onBeforeUnmount, onMounted, ref, watch} from 'vue'
import type {TranslationLoadingStyle} from '@/src/core/config/translationLoadingStyle'
import {createTranslationLoadingIndicator} from '@/src/ui/translationLoadingIndicator'

const props = defineProps<{
  loadingStyle: TranslationLoadingStyle
  animated: boolean
}>()

const container = ref<HTMLElement | null>(null)

function renderPreview() {
  if (!container.value) return
  const indicator = createTranslationLoadingIndicator(document, {
    style: props.loadingStyle,
    animated: props.animated,
  })
  container.value.replaceChildren(indicator)
}

onMounted(renderPreview)
watch(() => [props.loadingStyle, props.animated] as const, renderPreview)
onBeforeUnmount(() => container.value?.replaceChildren())
</script>

<style scoped>
.translation-loading-preview-runtime {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
