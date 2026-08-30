<!--
@file src/features/settings/ui/components/SettingsGroup.vue
文件职责：建立设置页面的二级分组容器，用一致的标题、说明和卡片边界区分相关配置而不重复页面级介绍。
主要内容：按需渲染分组标题与描述，通过默认插槽承载设置项，并统一相邻分隔线、悬停反馈、响应式间距和表面样式。
模块边界：本组件是无业务状态的布局壳，不解释配置、不读写 store，也不决定导航分类；具体字段及控件由调用页面和 SettingsItem 提供。
-->
<template>
  <section class="settings-group">
    <header v-if="title || description" class="settings-group-heading">
      <h2 v-if="title">{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
    </header>
    <div class="settings-group-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
}>()
</script>

<style scoped>
.settings-group {
  width: min(100%, 1080px);
  margin: 0 auto 22px;
}

.settings-group-heading {
  margin: 0 4px 10px;
}

.settings-group-heading h2 {
  margin: 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.4;
  letter-spacing: -.01em;
}

.settings-group-heading p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.settings-group-body {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 7px 22px rgba(31, 40, 61, .035);
}

.settings-group-body :deep(.settings-item + .settings-item) {
  border-top: 1px solid var(--line);
}

.settings-group-body :deep(.el-row) {
  min-height: 64px !important;
  margin: 0 !important;
  padding: 11px 16px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.settings-group-body :deep(.el-row + .el-row) {
  border-top: 1px solid var(--line) !important;
}

.settings-group-body :deep(.el-row:hover) {
  background: var(--surface-soft) !important;
  transform: none !important;
}

@media (max-width: 700px) {
  .settings-group { margin-bottom: 18px; }
  .settings-group-heading { margin-right: 2px; margin-left: 2px; }
}
</style>
