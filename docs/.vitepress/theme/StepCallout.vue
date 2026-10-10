<script setup lang="ts">
withDefaults(defineProps<{ number: number; text: string; align?: 'start' | 'end' }>(), {
  align: 'end',
})
const numbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']
</script>
<template>
  <span class="sc" :class="`sc-${align}`" :data-callout-step="number">
    <svg class="sc-arrow" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M3 25 25 3 M12 3h13v13" />
    </svg>
    <span class="sc-copy"
      ><b>{{ numbers[number - 1] ?? number }}</b
      >{{ text }}</span
    >
  </span>
</template>
<style scoped>
.sc {
  position: absolute;
  z-index: 20;
  top: calc(100% + 10px);
  right: calc(50% - 10px);
  display: flex;
  align-items: flex-start;
  gap: 5px;
  width: max-content;
  max-width: 185px;
  color: #b92252;
  font: 550 11px/1.5 var(--vp-font-family-base);
  text-align: left;
  pointer-events: none;
}
.sc-arrow {
  order: 1;
  flex: none;
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sc-copy {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  margin-top: 10px;
  padding: 4px 7px;
  border: 1px solid #eed3dc;
  border-radius: 5px;
  background: #fff7fa;
}
.sc-copy b {
  flex: none;
  font-size: 14px;
  line-height: 1;
}
.sc-start {
  right: auto;
  left: calc(50% - 10px);
}
.sc-start .sc-arrow {
  order: 0;
  transform: scaleX(-1);
}
@container (max-width: 480px) {
  .sc {
    max-width: 155px;
    font-size: 10px;
  }
  .sc-copy {
    padding: 3px 5px;
    gap: 4px;
  }
}
</style>
