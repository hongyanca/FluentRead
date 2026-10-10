<script setup lang="ts">
import BrandReader from './BrandReader.vue'
import GuideVisual from './GuideVisual.vue'
withDefaults(defineProps<{ en?: boolean; variant?: 'reader' | 'card' | 'subtitles' | 'input' }>(), {
  en: false,
  variant: 'reader',
})
</script>
<template>
  <BrandReader v-if="variant === 'reader'" :en="en" />
  <GuideVisual
    v-else
    :en="en"
    :kind="variant === 'card' ? 'selection' : variant === 'subtitles' ? 'video' : 'input'"
  />
</template>
