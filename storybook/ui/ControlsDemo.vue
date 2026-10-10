<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElDialog, ElInput, ElSwitch, ElTooltip } from 'element-plus'
const prompt = ref('把选中的文字翻译成简体中文。')
const enabled = ref(true)
const open = ref(false)
</script>
<template>
  <div class="fr-story-stack settings-card">
    <div class="fr-story-row"><ElButton type="primary" @click="open = true">打开预览弹窗</ElButton><ElButton>取消</ElButton><ElButton disabled>不可用</ElButton></div>
    <label class="fr-story-field"><span>提示词示例</span><ElInput v-model="prompt" aria-label="提示词示例" /></label>
    <div class="fr-story-row"><ElSwitch v-model="enabled" aria-label="双语显示" /><span>双语显示</span><ElTooltip content="保留原文，并在相邻位置展示译文。"><ElButton>查看说明</ElButton></ElTooltip></div>
    <ElDialog v-model="open" title="组件预览" width="min(440px, calc(100vw - 32px))">
      <p>这是设置页使用的 Element Plus 弹窗。可以通过关闭按钮或 Escape 返回。</p>
      <template #footer><ElButton @click="open = false">取消</ElButton><ElButton type="primary" @click="open = false">完成</ElButton></template>
    </ElDialog>
  </div>
</template>
