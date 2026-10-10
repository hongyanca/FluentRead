<!--
@file src/features/settings/ui/components/SettingsNumberInput.vue
文件职责：为设置行提供统一尺寸的数值输入框，让延迟、长度、次数等数值在各分区保持同一宽度、对齐方式和单位位置。
主要内容：包裹 Element Plus 数值输入并关闭两侧步进按钮，固定为紧凑宽度、数字居中；可选单位显示在输入框内右侧，仍作为普通文本可被读屏读到；其余属性与事件原样透传给内部输入框，方向键步进、范围限制和 change 校验保持原有行为。
模块边界：本组件只负责外观与透传，不保存配置、不做业务校验或换算；取值范围、步长和保存时机由调用方决定。
-->
<template>
  <span class="settings-number-input" :class="{ 'has-unit': unit }">
    <el-input-number v-bind="$attrs" :controls="false" />
    <span v-if="unit" class="settings-number-unit">{{ unit }}</span>
  </span>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineProps<{ unit?: string }>()
</script>

<style scoped>
.settings-number-input {
  position: relative;
  display: inline-block;
  flex: none;
  width: 132px;
  max-width: 100%;
}

.settings-number-input :deep(.el-input-number) {
  width: 100%;
  min-width: 0;
  max-width: none;
}

.settings-number-input :deep(.el-input__inner) { text-align: center; }
.settings-number-input.has-unit :deep(.el-input__wrapper) { padding-inline: 38px; }

.settings-number-unit {
  position: absolute;
  top: 50%;
  right: 12px;
  z-index: 1;
  color: var(--muted);
  font-size: 12px;
  line-height: 1;
  pointer-events: none;
  transform: translateY(-50%);
  user-select: none;
  white-space: nowrap;
}
</style>
