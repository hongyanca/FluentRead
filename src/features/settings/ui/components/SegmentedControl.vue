<!--
@file src/features/settings/ui/components/SegmentedControl.vue
文件职责：为少量互斥设置提供紧凑且可访问的分段选择控件，替代难以快速比较的普通下拉框。
主要内容：以 radiogroup 语义渲染选项，支持禁用状态、双向绑定以及方向键、Home、End 的循环键盘导航和焦点同步。
模块边界：本组件只接收通用标签和值并发出选择事件，不包含任何 FluentRead 配置字段含义，也不负责保存配置或展示页面说明。
-->
<template>
  <div ref="groupElement" class="segmented-control" role="radiogroup" :aria-label="label" :aria-disabled="disabled">
    <button
      v-for="(option, index) in options"
      :key="String(option.value)"
      type="button"
      role="radio"
      :data-option-index="index"
      :aria-checked="modelValue === option.value"
      :tabindex="modelValue === option.value && !disabled && !option.disabled ? 0 : -1"
      :class="{ active: modelValue === option.value }"
      :disabled="disabled || option.disabled"
      @click="$emit('update:modelValue', option.value)"
      @keydown="handleKeydown($event, index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import {ref} from 'vue'

export type SegmentedOption = {
  label: string
  value: string | number
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string | number
  options: SegmentedOption[]
  label: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const groupElement = ref<HTMLElement | null>(null)

function handleKeydown(event: KeyboardEvent, currentIndex: number) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const enabledIndexes = props.options
    .map((option, index) => (!props.disabled && !option.disabled ? index : -1))
    .filter(index => index >= 0)
  if (!enabledIndexes.length) return

  event.preventDefault()
  const position = Math.max(0, enabledIndexes.indexOf(currentIndex))
  let nextIndex: number
  if (event.key === 'Home') nextIndex = enabledIndexes[0]
  else if (event.key === 'End') nextIndex = enabledIndexes.at(-1)!
  else {
    const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    nextIndex = enabledIndexes[(position + offset + enabledIndexes.length) % enabledIndexes.length]
  }
  emit('update:modelValue', props.options[nextIndex].value)
  requestAnimationFrame(() => {
    groupElement.value?.querySelector<HTMLButtonElement>(`button[data-option-index="${nextIndex}"]`)?.focus()
  })
}
</script>

<style scoped>
.segmented-control {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  width: 100%;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-soft);
}

.segmented-control button {
  min-width: 0;
  min-height: 36px;
  padding: 0 10px;
  overflow: hidden;
  border: 0;
  border-radius: 9px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}

.segmented-control button:hover:not(:disabled) { color: var(--ink); }
.segmented-control button.active {
  color: var(--brand-strong);
  background: var(--surface);
  box-shadow: 0 2px 7px rgba(31, 40, 61, .09);
}
.segmented-control button:disabled { cursor: not-allowed; opacity: .55; }
.segmented-control button:focus-visible { outline: 2px solid rgba(239, 71, 118, .28); outline-offset: 1px; }
</style>
