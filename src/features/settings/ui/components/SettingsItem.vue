<!--
@file src/features/settings/ui/components/SettingsItem.vue
文件职责：统一单条设置的标签、辅助说明和操作控件布局，使长配置页面保持清晰的阅读节奏与对齐关系。
主要内容：支持常规双列和 stacked 单列模式、禁用视觉状态、控制区插槽，以及窄屏下从横向到纵向的响应式排列。
模块边界：本组件只处理展示和插槽排版，不拥有字段值、不触发持久化，也不约束所嵌套 Element Plus 或自定义控件的业务行为。
-->
<template>
  <div class="settings-item" :class="{ stacked, disabled }">
    <div class="settings-item-copy">
      <strong>{{ label }}</strong>
      <small v-if="description">{{ description }}</small>
    </div>
    <div class="settings-item-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  description?: string
  stacked?: boolean
  disabled?: boolean
}>(), {
  description: '',
  stacked: false,
  disabled: false,
})
</script>

<style scoped>
.settings-item {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(220px, 360px);
  align-items: center;
  gap: 24px;
  min-height: 66px;
  padding: 12px 16px;
  transition: background 150ms ease;
}

.settings-item:hover { background: var(--surface-soft); }
.settings-item.disabled { opacity: .58; }

.settings-item-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.settings-item-copy strong {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.45;
}

.settings-item-copy small {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
}

.settings-item-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
}

.settings-item-control :deep(.el-select),
.settings-item-control :deep(.el-input),
.settings-item-control :deep(.el-input-number),
.settings-item-control :deep(.hotkey-config) {
  width: 100%;
  max-width: 360px;
}

.settings-item.stacked {
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 12px;
}

.settings-item.stacked .settings-item-control {
  justify-content: stretch;
}

.settings-item.stacked .settings-item-control > :deep(*) {
  width: 100%;
  max-width: none;
}

@media (max-width: 700px) {
  .settings-item {
    grid-template-columns: minmax(0, 1fr) minmax(170px, 44%);
    gap: 14px;
    min-height: 62px;
    padding: 11px 12px;
  }
}

@media (max-width: 480px) {
  .settings-item {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    gap: 9px;
  }

  .settings-item-control { justify-content: stretch; }
  .settings-item-control :deep(.el-select),
  .settings-item-control :deep(.el-input),
  .settings-item-control :deep(.el-input-number),
  .settings-item-control :deep(.hotkey-config) { max-width: none; }
}
</style>
