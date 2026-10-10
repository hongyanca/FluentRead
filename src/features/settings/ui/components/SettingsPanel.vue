<!--
@file src/features/settings/ui/components/SettingsPanel.vue
文件职责：按设置中心当前页内分类显示相关表单，保留切换前的编辑状态。
主要内容：通过父级提供的分类 ID 控制单层容器的可见性，为浏览器验证提供稳定的分类标记。
模块边界：只控制显示，不拥有配置或路由、不销毁隐藏表单，不执行存储和网络请求。
-->
<template>
  <div v-show="!active || active === name" class="settings-page-panel" :data-settings-panel="name"><slot /></div>
</template>
<script setup lang="ts">
defineProps<{name: string; active?: string}>()
</script>
