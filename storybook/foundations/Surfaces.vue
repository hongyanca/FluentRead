<template>
  <div class="fr-story-stack">
    <h2>圆角与层次</h2>
    <p class="fr-story-note">菜单复用共享圆角和阴影变量。功能开关卡与下拉框保留组件本身的圆角规则。</p>
    <div class="fr-story-grid">
      <article class="fr-story-tile" style="border-radius: 10px"><h3>功能开关卡</h3><code>10px</code><small>FeatureEnableCard.vue</small></article>
      <article class="fr-story-tile" style="border-radius: 12px"><h3>下拉控件</h3><code>12px</code><small>UiSelect.vue</small></article>
      <article class="fr-story-tile" style="border-radius: var(--fr-menu-radius); box-shadow: var(--fr-menu-shadow)"><h3>菜单浮层</h3><code>--fr-menu-radius</code><code>--fr-menu-shadow</code><small>tokens.css</small></article>
    </div>
  </div>
</template>
