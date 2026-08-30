<!--
 * @file src/features/image-translation/ui/ImageOcrSettings.vue
 * 文件职责：实现设置页中的图片 OCR 语言包管理界面，展示浏览器能力、推荐语言组合、单包下载状态、缓存说明和失败重试反馈。
 * 主要内容：组件读取本地语言状态，按 chi_sim、eng、jpn 渲染卡片，发送 fluentReadImageOcrDownload 消息，维护并发下载列表，并在不支持 imageOcr 的浏览器保留配置但显示不可用提示。
 * 模块边界：UI 不直接创建 Tesseract Worker 或写存储；下载和持久化由后台 handlers/repository 完成，能力判断来自 platform/browser，语言元数据只依赖 ocrLanguages 公共契约。
 -->
<template>
  <section class="settings-section image-ocr-section" aria-labelledby="image-ocr-pack-title">
    <div v-if="!browserCapabilities.imageOcr" class="image-ocr-unavailable" role="status">
      <strong>当前浏览器暂不支持图片翻译与 OCR</strong>
      <p>原有图片翻译偏好和语言包记录会保留；请在 Chrome 中使用及管理此功能。</p>
    </div>
    <template v-else>
      <div class="image-ocr-heading">
        <div>
          <h2 id="image-ocr-pack-title">OCR 语言包</h2>
          <p>按需下载并缓存在浏览器本地，不会随扩展安装包一起下载。</p>
        </div>
        <span class="image-ocr-runtime-badge">按需下载</span>
      </div>
      <div class="image-ocr-recommendation">
        <div>
          <strong>推荐先下载中文和 English</strong>
          <p>自动检测默认使用这两种语言。识别日文图片前，再下载日本語语言包即可。</p>
        </div>
        <button type="button" class="image-ocr-primary-action"
          :disabled="recommendedReady || recommendedDownloading"
          @click="downloadLanguages(recommendedCodes)">
          {{ recommendedReady ? '推荐语言已就绪' : recommendedDownloading ? '下载中…' : '下载推荐语言' }}
        </button>
      </div>
      <div class="image-ocr-pack-list">
        <article v-for="pack in languagePacks" :key="pack.code" class="image-ocr-pack-card">
          <div class="image-ocr-pack-icon">{{ pack.code === 'chi_sim' ? '中' : pack.code === 'eng' ? 'A' : '日' }}</div>
          <div class="image-ocr-pack-copy">
            <div class="image-ocr-pack-title">
              <strong>{{ pack.label }}</strong>
              <span v-if="pack.recommended" class="image-ocr-recommended">推荐</span>
            </div>
            <small>{{ pack.description }} · {{ pack.size }}</small>
          </div>
          <div class="image-ocr-pack-action">
            <span :class="['image-ocr-pack-status', {ready: downloadedCodes.includes(pack.code)}]">
              {{ downloadedCodes.includes(pack.code) ? '已下载' : '未下载' }}
            </span>
            <button type="button" class="image-ocr-download-button"
              :disabled="downloadedCodes.includes(pack.code) || downloadingCodes.includes(pack.code)"
              @click="downloadLanguages([pack.code])">
              {{ downloadedCodes.includes(pack.code) ? '已就绪' : downloadingCodes.includes(pack.code) ? '下载中…' : '下载' }}
            </button>
          </div>
        </article>
      </div>
      <p v-if="downloadError" class="image-ocr-error">{{ downloadError }}</p>
      <p class="image-ocr-footnote">只有下载对应语言后，图片翻译才会执行文字识别。语言包由 Tesseract.js 下载并缓存到扩展本地存储。</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import browser from 'webextension-polyfill';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {configStorage} from '@/src/platform/storage/configStorageRuntime';
import {
  IMAGE_OCR_LANGUAGE_PACKS,
  IMAGE_OCR_LANGUAGE_STATE_KEY,
  IMAGE_OCR_RECOMMENDED_LANGUAGES,
  normalizeImageOcrLanguageCodes,
  type ImageOcrLanguageCode,
} from '../ocrLanguages';

const languagePacks = IMAGE_OCR_LANGUAGE_PACKS;
const recommendedCodes = IMAGE_OCR_RECOMMENDED_LANGUAGES;
const downloadedCodes = ref<ImageOcrLanguageCode[]>([]);
const downloadingCodes = ref<ImageOcrLanguageCode[]>([]);
const downloadError = ref('');
const recommendedReady = computed(() => recommendedCodes.every(code => downloadedCodes.value.includes(code)));
const recommendedDownloading = computed(() => recommendedCodes.some(code => downloadingCodes.value.includes(code)));

function formatDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('Receiving end does not exist')
    || message.includes('Could not establish connection')
    || message.includes('Offscreen 文档')
    || message.includes('接收端')) {
    return 'OCR 服务初始化失败，请重新打开设置页后重试。';
  }
  return message
    ? `${message}。请检查网络后重试。`
    : '语言包下载失败，请检查网络后重试。';
}

async function refreshLanguageState() {
  const stored = await configStorage.getItem(`local:${IMAGE_OCR_LANGUAGE_STATE_KEY}`);
  downloadedCodes.value = normalizeImageOcrLanguageCodes(stored);
}

async function downloadLanguages(languages: ImageOcrLanguageCode[]) {
  if (!browserCapabilities.imageOcr) return;
  const pending = languages.filter(code => !downloadedCodes.value.includes(code));
  if (pending.length === 0) return;
  downloadError.value = '';
  downloadingCodes.value = [...new Set([...downloadingCodes.value, ...pending])];
  try {
    const response = await browser.runtime.sendMessage({
      type: 'fluentReadImageOcrDownload', languages: pending,
    }) as {success?: boolean; languages?: unknown; error?: string} | undefined;
    if (!response?.success) throw new Error(response?.error || '语言包下载失败');
    downloadedCodes.value = normalizeImageOcrLanguageCodes(response.languages);
  } catch (error) {
    downloadError.value = formatDownloadError(error);
  } finally {
    downloadingCodes.value = downloadingCodes.value.filter(code => !pending.includes(code));
  }
}

onMounted(() => {
  if (browserCapabilities.imageOcr) void refreshLanguageState().catch(() => undefined);
});
</script>

<style scoped src="./image-ocr-settings.css"></style>
