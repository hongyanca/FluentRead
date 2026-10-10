<!--
 * @file src/features/settings/ui/PopupLayoutEditor.vue
 * 文件职责：提供可复用的 Popup 布局排序与显隐编辑器，供顶层模块和快捷功能两级布局共同使用。
 * 主要内容：将可见项目呈现为可拖动卡片，通过右上角叉号移除非必选项目，将移除项目收纳为可重新添加的芯片，并提供键盘排序、恢复默认顺序和无障碍状态播报。
 * 模块边界：组件只编辑传入的纯布局数据，不认识具体业务功能、不读写浏览器存储，也不渲染真实 Popup。
-->
<template>
  <div
    ref="editorRoot"
    class="popup-layout-editor"
    :class="`popup-layout-editor--${props.scope}`"
    :data-popup-layout-editor="props.scope === 'popupModule' ? '' : undefined"
    :data-popup-quick-feature-editor="props.scope === 'quickFeature' ? '' : undefined"
    @keydown.esc.prevent="finishDrag"
  >
    <div class="popup-layout-toolbar">
      <span>{{ copy(props.scope === 'quickFeature' ? 'gridOrderHint' : 'orderHint') }}</span>
      <button type="button" :disabled="isDefaultOrder" @click="restoreDefaultOrder">
        {{ copy('restoreDefault') }}
      </button>
    </div>

    <section class="popup-layout-section" :aria-label="copy('visibleSection')">
      <div class="popup-layout-section-heading">
        <strong>{{ copy('visibleSection') }}</strong>
        <span>{{ visibleItems.length }}</span>
      </div>
      <ol class="popup-layout-list" :aria-label="copy('listAria')">
        <li
          v-for="(item, index) in visibleItems"
          :key="item.id"
          class="popup-layout-item"
          :class="{
            dragging: draggedItem === item.id,
            'drop-before': dropTarget === item.id && dropPosition === 'before',
            'drop-after': dropTarget === item.id && dropPosition === 'after',
          }"
          :data-popup-layout-module="props.scope === 'popupModule' ? item.id : undefined"
          :data-popup-quick-feature-layout="props.scope === 'quickFeature' ? item.id : undefined"
          draggable="true"
          @dragstart="handleItemDragStart($event, item.id)"
          @dragover="handleDragOver($event, item.id)"
          @dragleave="handleDragLeave($event, item.id)"
          @drop="handleDrop($event, item.id)"
          @dragend="finishDrag"
        >
          <button
            class="popup-layout-handle"
            type="button"
            draggable="true"
            :aria-label="copy('handleAria', {label: item.label})"
            :aria-pressed="draggedItem === item.id"
            @keydown.up.prevent="moveItem(item.id, -1)"
            @keydown.down.prevent="moveItem(item.id, 1)"
            @keydown.left="handleHorizontalKey($event, item.id, -1)"
            @keydown.right="handleHorizontalKey($event, item.id, 1)"
          >
            <span aria-hidden="true">⠿</span>
          </button>

          <span class="popup-layout-copy">
            <strong>{{ item.label }}</strong>
            <small>{{ item.description }}</small>
          </span>

          <button
            v-if="!item.required"
            class="popup-layout-hide"
            type="button"
            :aria-label="copy('hideAria', {label: item.label})"
            :title="copy('hideAria', {label: item.label})"
            @dragstart.stop.prevent
            @click="setItemVisibility(item, false, $event)"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
          <span class="popup-layout-move-buttons">
            <button
              type="button"
              :disabled="index === 0"
              :aria-label="copy('moveUp', {label: item.label})"
              @dragstart.stop.prevent
              @click="moveItem(item.id, -1)"
            >↑</button>
            <button
              type="button"
              :disabled="index === visibleItems.length - 1"
              :aria-label="copy('moveDown', {label: item.label})"
              @dragstart.stop.prevent
              @click="moveItem(item.id, 1)"
            >↓</button>
          </span>
        </li>
      </ol>
      <p v-if="visibleItems.length === 0" class="popup-layout-empty">
        {{ copy('visibleEmpty') }}
      </p>
    </section>

    <section class="popup-layout-section popup-layout-hidden-section" :aria-label="copy('hiddenSection')">
      <div class="popup-layout-section-heading">
        <strong>{{ copy('hiddenSection') }}</strong>
        <span>{{ hiddenItems.length }}</span>
      </div>
      <div v-if="hiddenItems.length" class="popup-layout-hidden-list">
        <div v-for="item in hiddenItems" :key="item.id" class="popup-layout-hidden-chip">
          <span class="popup-layout-hidden-copy">
            <strong>{{ item.label }}</strong>
            <small>{{ item.description }}</small>
          </span>
          <button
            type="button"
            class="popup-layout-add"
            :aria-label="copy('addAria', {label: item.label})"
            @click="setItemVisibility(item, true, $event)"
          >
            <span aria-hidden="true">+</span>
            {{ copy('add') }}
          </button>
        </div>
      </div>
      <p v-else class="popup-layout-empty">
        {{ copy('hiddenEmpty') }}
      </p>
    </section>

    <p class="popup-layout-help">
      {{ copy('help') }}
    </p>
    <p class="popup-layout-announcement" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<script lang="ts" setup>
import {computed, nextTick, ref} from 'vue'
import {useUiI18n} from '@/src/ui/i18n'
import {
  usePopupLayoutReorder,
  type PopupLayoutDropAxis,
} from './usePopupLayoutReorder'

export interface PopupLayoutEditorItem {
  id: string
  label: string
  description: string
  visible: boolean
  required?: boolean
}

const props = defineProps<{
  items: readonly PopupLayoutEditorItem[]
  order: readonly string[]
  defaultOrder: readonly string[]
  scope: 'popupModule' | 'quickFeature'
  copyPrefix: string
}>()

const emit = defineEmits<{
  'update:order': [value: string[]]
  'update:visibility': [id: string, value: boolean]
}>()
const {t} = useUiI18n()

const editorRoot = ref<HTMLElement | null>(null)
const announcement = ref('')
const itemById = computed(() => new Map(props.items.map((item) => [item.id, item])))
const normalizedOrder = computed(() => {
  const registered = new Set(itemById.value.keys())
  const seen = new Set<string>()
  const saved = props.order.filter((id) => {
    if (!registered.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return [...saved, ...props.items.map((item) => item.id).filter((id) => !seen.has(id))]
})
const orderedItems = computed(() => normalizedOrder.value
  .map((id) => itemById.value.get(id))
  .filter((item): item is PopupLayoutEditorItem => Boolean(item)))
const visibleItems = computed(() => orderedItems.value.filter((item) => item.visible || item.required))
const hiddenItems = computed(() => orderedItems.value.filter((item) => !item.visible && !item.required))
const visibleIds = computed(() => visibleItems.value.map((item) => item.id))
const isDefaultOrder = computed(() => normalizedOrder.value.every(
  (id, index) => id === props.defaultOrder[index],
) && normalizedOrder.value.length === props.defaultOrder.length)

const reorder = usePopupLayoutReorder({
  order: () => normalizedOrder.value,
  visibleIds: () => visibleIds.value,
  onUpdate: emitOrder,
})
const {
  draggedItem,
  dropTarget,
  dropPosition,
} = reorder

function copy(suffix: string, params?: Record<string, string | number>): string {
  return t(`${props.copyPrefix}.${suffix}`, params)
}

function setItemVisibility(item: PopupLayoutEditorItem, visible: boolean, event: MouseEvent): void {
  if (item.required && !visible) return
  const currentIndex = visibleItems.value.findIndex((visibleItem) => visibleItem.id === item.id)
  const focusAfterHide = currentIndex >= 0
    ? visibleItems.value[currentIndex + 1]?.id ?? visibleItems.value[currentIndex - 1]?.id
    : undefined
  emit('update:visibility', item.id, visible)
  announcement.value = copy(visible ? 'shown' : 'hidden', {label: item.label})
  // 仅在用户正在使用当前页面的键盘时接续焦点，鼠标点击或后台同步不应激活窗口或滚动页面。
  if (event.detail === 0 && editorRoot.value?.ownerDocument.hasFocus()) {
    focusVisibleItem(visible ? item.id : focusAfterHide)
  }
}

function emitOrder(nextOrder: string[], movedItem: string): void {
  const item = itemById.value.get(movedItem)
  const visibleSet = new Set(visibleIds.value)
  const position = nextOrder.filter((id) => visibleSet.has(id)).indexOf(movedItem) + 1
  emit('update:order', nextOrder)
  announcement.value = copy('moved', {
    label: item?.label ?? movedItem,
    position: position > 0 ? position : nextOrder.indexOf(movedItem) + 1,
  })
}

function moveItem(itemId: string, offset: -1 | 1): void {
  reorder.move(itemId, offset)
}

function handleHorizontalKey(event: KeyboardEvent, itemId: string, offset: -1 | 1): void {
  if (props.scope !== 'quickFeature') return
  event.preventDefault()
  moveItem(itemId, offset)
}

function restoreDefaultOrder(): void {
  emit('update:order', [...props.defaultOrder])
  announcement.value = copy('restored')
}

function dragAxis(event: DragEvent): PopupLayoutDropAxis {
  if (props.scope !== 'quickFeature') return 'y'
  const card = event.currentTarget as HTMLElement | null
  const list = card?.parentElement
  if (!list) return 'x'

  if (typeof window !== 'undefined') {
    const columns = window.getComputedStyle(list).gridTemplateColumns
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
    if (columns.length > 0) return columns.length > 1 ? 'x' : 'y'
  }

  const cardBounds = card?.getBoundingClientRect()
  if (cardBounds && cardBounds.width > 0 && cardBounds.height > 0) {
    const hasSameRow = Array.from(list.children).some((child) => {
      if (child === card || typeof (child as HTMLElement).getBoundingClientRect !== 'function') return false
      const bounds = (child as HTMLElement).getBoundingClientRect()
      return bounds.width > 0 && Math.abs(bounds.top - cardBounds.top) < 1
    })
    return hasSameRow ? 'x' : 'y'
  }
  return 'x'
}

function handleItemDragStart(event: DragEvent, itemId: string): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('button:not(.popup-layout-handle), input, select, textarea, a')) {
    event.preventDefault()
    reorder.finish()
    return
  }
  reorder.start(event, itemId)
}

function handleDragOver(event: DragEvent, itemId: string): void {
  reorder.over(event, itemId, dragAxis(event))
}

function handleDrop(event: DragEvent, itemId: string): void {
  reorder.drop(event, itemId, dragAxis(event))
}

function handleDragLeave(event: DragEvent, itemId: string): void {
  const current = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (current && related && current.contains(related)) return
  if (dropTarget.value === itemId) dropTarget.value = null
}

function focusVisibleItem(itemId: string | undefined): void {
  if (!itemId) return
  void nextTick(() => {
    const root = editorRoot.value
    if (!root) return
    const itemNode = Array.from(root.querySelectorAll<HTMLElement>(
      '[data-popup-layout-module], [data-popup-quick-feature-layout]',
    )).find((node) => (
      node.getAttribute('data-popup-layout-module') === itemId
      || node.getAttribute('data-popup-quick-feature-layout') === itemId
    ))
    itemNode?.querySelector<HTMLElement>('.popup-layout-handle')?.focus({preventScroll: true})
  })
}

function finishDrag(): void {
  reorder.finish()
}
</script>

<style scoped>
.popup-layout-editor {
  display: grid;
  width: 100%;
  gap: 10px;
}

.popup-layout-toolbar,
.popup-layout-section-heading,
.popup-layout-hidden-chip,
.popup-layout-move-buttons,
.popup-layout-add {
  display: flex;
  align-items: center;
}

.popup-layout-toolbar {
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 11px;
}

.popup-layout-toolbar button,
.popup-layout-add {
  flex: none;
  border: 0;
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.popup-layout-toolbar button {
  padding: 4px 8px;
}

.popup-layout-toolbar button:disabled {
  color: var(--muted);
  background: var(--surface-soft);
  cursor: default;
  opacity: .65;
}

.popup-layout-section {
  display: grid;
  gap: 6px;
}

.popup-layout-section-heading {
  justify-content: space-between;
  gap: 8px;
  color: var(--ink);
  font-size: 11px;
}

.popup-layout-section-heading span {
  min-width: 18px;
  padding: 2px 5px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 8px;
  text-align: center;
}

.popup-layout-list,
.popup-layout-hidden-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.popup-layout-editor--quickFeature .popup-layout-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.popup-layout-item {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 49px;
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 66px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 2px 8px rgba(31, 40, 61, .025);
  cursor: grab;
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
}

.popup-layout-item:active {
  cursor: grabbing;
}

.popup-layout-item:hover {
  border-color: color-mix(in srgb, var(--brand) 30%, transparent);
  box-shadow: 0 5px 14px rgba(31, 40, 61, .055);
}

.popup-layout-item.dragging {
  opacity: .45;
}

.popup-layout-item.drop-before::before,
.popup-layout-item.drop-after::after {
  position: absolute;
  right: 5px;
  left: 5px;
  height: 2px;
  border-radius: 99px;
  background: var(--brand);
  content: '';
}

.popup-layout-item.drop-before::before {
  top: -5px;
}

.popup-layout-item.drop-after::after {
  bottom: -5px;
}

.popup-layout-editor--quickFeature .popup-layout-item.drop-before::before,
.popup-layout-editor--quickFeature .popup-layout-item.drop-after::after {
  top: 5px;
  right: auto;
  bottom: 5px;
  left: -5px;
  width: 2px;
  height: auto;
}

.popup-layout-editor--quickFeature .popup-layout-item.drop-after::after {
  right: -5px;
  left: auto;
}

.popup-layout-handle {
  display: grid;
  width: 24px;
  height: 30px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--muted);
  background: var(--surface-soft);
  cursor: grab;
}

.popup-layout-handle:focus-visible,
.popup-layout-move-buttons button:focus-visible,
.popup-layout-toolbar button:focus-visible,
.popup-layout-hide:focus-visible,
.popup-layout-add:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand) 55%, transparent);
  outline-offset: 2px;
}

.popup-layout-handle span {
  font-size: 15px;
  line-height: 1;
  transform: rotate(90deg);
}

.popup-layout-copy,
.popup-layout-hidden-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.popup-layout-copy strong,
.popup-layout-hidden-copy strong {
  color: var(--ink);
  font-size: 12px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.popup-layout-copy small,
.popup-layout-hidden-copy small {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.popup-layout-hide {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}

.popup-layout-hide svg { width: 14px; height: 14px; }
.popup-layout-hide:hover { color: var(--brand-strong); background: var(--brand-soft); }

.popup-layout-add {
  padding: 4px 7px;
  font-size: 10px;
  white-space: nowrap;
}

.popup-layout-add:hover {
  background: color-mix(in srgb, var(--brand-soft) 75%, var(--brand));
}

.popup-layout-move-buttons {
  align-self: end;
  justify-self: end;
  gap: 3px;
}

.popup-layout-move-buttons button {
  display: grid;
  width: 23px;
  height: 23px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  background: var(--surface);
  font-size: 12px;
  cursor: pointer;
}

.popup-layout-move-buttons button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--brand) 35%, transparent);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.popup-layout-move-buttons button:disabled {
  cursor: default;
  opacity: .28;
}

.popup-layout-hidden-section {
  padding-top: 2px;
  border-top: 1px solid var(--line);
}

.popup-layout-hidden-list {
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}

.popup-layout-hidden-chip {
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 7px 8px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 72%, var(--surface));
}

.popup-layout-add {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.popup-layout-add span {
  font-size: 13px;
  font-weight: 500;
  line-height: .8;
}

.popup-layout-empty,
.popup-layout-help {
  margin: 0 1px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.45;
}

.popup-layout-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 620px) {
  .popup-layout-toolbar {
    align-items: flex-start;
  }

  .popup-layout-editor--quickFeature .popup-layout-list {
    grid-template-columns: 1fr;
  }

  .popup-layout-hidden-list {
    grid-template-columns: 1fr;
  }

  .popup-layout-editor--quickFeature .popup-layout-item.drop-before::before,
  .popup-layout-editor--quickFeature .popup-layout-item.drop-after::after {
    top: -5px;
    right: 5px;
    bottom: auto;
    left: 5px;
    width: auto;
    height: 2px;
  }

  .popup-layout-editor--quickFeature .popup-layout-item.drop-after::after {
    right: 5px;
    bottom: -5px;
    left: 5px;
  }
}
</style>
