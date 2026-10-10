<script setup lang="ts">
defineProps<{ browser: 'Chrome' | 'Edge' | 'Firefox' }>()
</script>
<template>
  <svg class="bv-browser-glyph" viewBox="0 0 32 32" aria-hidden="true">
    <template v-if="browser === 'Chrome'">
      <circle cx="16" cy="16" r="14" fill="#fbbc05" />
      <path d="M3.8 9A14 14 0 0 1 28.2 9H16l-6 10.4Z" fill="#ea4335" />
      <path d="M3.8 9 10 19.4 16 30A14 14 0 0 1 3.8 9" fill="#34a853" />
      <circle cx="16" cy="16" r="6.8" fill="white" />
      <circle cx="16" cy="16" r="5.4" fill="#4285f4" />
    </template>
    <template v-else-if="browser === 'Edge'">
      <path d="M3 19C0 8 8 1 18 2c9 1 14 9 11 16-2-6-9-8-14-6-5 2-6 5-4 8Z" fill="#12b5a0" />
      <path
        d="M3 18c-2 9 10 16 21 10 3-2 5-5 5-8-6 6-18 3-18-2 0-4 4-6 8-6-8-3-14 0-16 6Z"
        fill="#0879ce"
      />
      <path d="M3 18c-1 9 10 14 18 10-8 1-14-4-11-9Z" fill="#174caa" />
    </template>
    <template v-else>
      <circle cx="16" cy="17" r="12" fill="#6335bc" />
      <path
        d="m25 2-1 8c7 6 5 17-6 20C7 33-2 23 3 12l3-5 2 7c4-4 9-5 15-3-5 0-6 2-7 5l-6 1c0 8 11 10 15 2 3-6-1-10-5-12Z"
        fill="#ff8c21"
      />
      <path d="M3 12c-2 10 7 19 17 15-8 1-12-4-11-9l7-2-8-2Z" fill="#ffb531" />
    </template>
  </svg>
</template>
