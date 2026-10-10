<!-- 数据传递示意：分别标注保存与恢复方向；仅播放示例数据流动，不执行同步、备份或翻译请求。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
const props = defineProps<{
  kind: 'sync' | 'backup' | 'privacy'
  en?: boolean
  running: boolean
}>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const privacy = computed(() => props.kind === 'privacy')
const destination = computed(() =>
  privacy.value
    ? t('所选翻译服务', 'Translation provider')
    : props.kind === 'backup'
    ? t('本地备份文件', 'Backup file')
    : t('已连接的云存储', 'Connected cloud storage')
)
</script>
<template>
  <div class="tf" :data-running="running">
    <div class="tf-endpoint">
      <img :src="withBase('/brand-icon.webp')" width="44" height="44" alt="" />
      <b>
        {{ privacy ? t('待译文字', 'Text to translate') : t('浏览器配置', 'Browser settings') }}
      </b>
      <small>
        {{
          privacy
            ? t('你主动使用的翻译功能', 'Your translation request')
            : t('当前设备上的设置', 'Settings on this device')
        }}
      </small>
    </div>
    <div
      class="tf-paths"
      :aria-label="
        privacy
          ? t('文字发送与译文返回', 'Text sent and translation returned')
          : t('配置保存与恢复', 'Save and restore settings')
      "
    >
      <div class="tf-direction tf-outgoing">
        <span
          >② {{ privacy ? t('发送待译文字', 'Send text') : t('保存配置', 'Save settings') }}</span
        >
        <div class="tf-track" aria-hidden="true">
          <i></i>
          <i></i>
        </div>
      </div>
      <div class="tf-direction tf-incoming">
        <div class="tf-track" aria-hidden="true">
          <i></i>
          <i></i>
        </div>
        <span>
          {{
            privacy
              ? t('③ 返回译文', '③ Return translation')
              : t('③ 恢复或合并配置', '③ Restore or merge')
          }}
        </span>
      </div>
    </div>
    <div class="tf-endpoint">
      <svg v-if="kind !== 'backup'" viewBox="0 0 56 48" aria-hidden="true">
        <path d="M15 38a12 12 0 0 1-1-24 15 15 0 0 1 28-2 13 13 0 0 1 0 26Z" /></svg
      ><svg v-else viewBox="0 0 40 48" aria-hidden="true">
        <path d="M5 2h18l12 12v32H5Z M23 2v12h12 M12 25h16 M12 32h16 M12 39h10" />
      </svg>
      <b>{{ destination }}</b>
      <small>
        {{
          privacy
            ? t('处理请求并生成译文', 'Processes your request')
            : kind === 'backup'
            ? t('导出后请妥善保存', 'Keep the exported file safe')
            : 'Google Drive / WebDAV'
        }}
      </small>
    </div>
  </div>
</template>
<style scoped>
.tf {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(100px, 1.15fr) minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 22px 8px;
}
.tf-endpoint {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 12px;
  text-align: center;
}
.tf-endpoint > svg {
  width: 48px;
  height: 44px;
  fill: #faf1f5;
  stroke: #b92252;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.tf-endpoint b {
  font-size: 13px;
}
.tf-endpoint small {
  color: var(--fr-muted);
  font-size: 10px;
  line-height: 1.6;
}
.tf-paths {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.tf-direction {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 10px;
  text-align: center;
  color: var(--vp-c-brand-1);
}
.tf-incoming {
  color: #39796c;
}
.tf-track {
  position: relative;
  width: 100%;
  height: 2px;
  background: currentColor;
}
.tf-track::after {
  content: '';
  position: absolute;
  right: 0;
  top: -3px;
  width: 8px;
  height: 8px;
  border-top: 2px solid;
  border-right: 2px solid;
  transform: rotate(45deg);
}
.tf-incoming .tf-track::after {
  right: auto;
  left: 0;
  transform: rotate(-135deg);
}
.tf-track i {
  position: absolute;
  top: -3px;
  left: 0;
  width: 8px;
  height: 8px;
  border: 2px solid white;
  border-radius: 50%;
  background: currentColor;
  box-sizing: content-box;
  animation: tf-send 2.8s linear infinite;
  animation-play-state: paused;
}
.tf-track i + i {
  animation-delay: -1.4s;
}
.tf-incoming i {
  animation-direction: reverse;
}
.tf[data-running='true'] i {
  animation-play-state: running;
}
@keyframes tf-send {
  from {
    left: 0;
  }
  to {
    left: calc(100% - 10px);
  }
}
@media (max-width: 640px) {
  .tf {
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) minmax(76px, 1fr) minmax(0, 1fr);
    padding-inline: 0;
  }
  .tf-endpoint b {
    font-size: 11px;
  }
  .tf-endpoint small {
    font-size: 9px;
  }
  .tf-direction {
    font-size: 9px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tf-track i {
    animation: none;
    left: 35%;
  }
  .tf-track i + i {
    left: 65%;
  }
}
</style>
