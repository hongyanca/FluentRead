<!--
 * @file src/features/settings/ui/VideoLocalModelSettings.vue
 * 文件职责：提供 X 本地视频字幕模型选择与下载管理，向用户呈现模型推荐、可用状态和缓存操作。
 * 主要内容：模型卡片作为唯一选择入口，通过后台真实文件清单查询 Tiny/Base/Small 的可用状态，呈现质量、体积、推荐、真实下载字节和连接/换源状态；本页选择下载优先来源，仅传给后续请求，不写持久化配置；失败模型可重试，命令结束重读权威缓存；停用时移除 UI 监听，回页重读模型和识别缓存，旧配置事件及迟到回包不进入新视图。
 * 模块边界：通过视频 feature 公共配置和后台消息获取模型，不直接执行识别、下载权重或操作网页播放器；下载进度只读取后台转存的变化事件。
 -->
<template>
  <section class="video-model-management" aria-labelledby="video-model-management-title">
    <div class="video-model-download-heading">
      <div>
        <h3 id="video-model-management-title">本地 AI 字幕模型</h3>
        <p class="video-model-status" role="status">{{ !modelStateLoaded ? '正在读取模型状态…' : downloaded.includes(config.videoLocalModel) ? '当前模型已下载，可直接生成' : t('video.modelChoiceHint') }}</p>
      </div>
      <span class="video-model-local-badge"><Cpu aria-hidden="true" />本地运行</span>
    </div>
    <p v-if="!browserCapabilities.extensionDom" class="capability-warning" role="status">当前浏览器不支持本地 AI 字幕，无法下载或运行本地模型</p>
    <div class="video-model-source-settings">
      <label class="video-model-source-choice">
        <span>{{ t('video.downloadSourceLabel') }}</span>
        <select :value="sourcePreference" :onChange="sourceControls.choose" data-video-model-source :disabled="!active || !config.videoTranslationEnabled || !browserCapabilities.extensionDom" aria-describedby="video-model-source-hint">
          <option value="auto">{{ t('video.downloadSourceAuto') }}</option>
          <option value="mirror">{{ t('video.downloadSourceMirror') }}</option>
          <option value="official">{{ t('video.downloadSourceOfficial') }}</option>
        </select>
      </label>
      <p id="video-model-source-hint" class="video-model-guidance">{{ t('video.downloadSourceHint') }}</p>
      <p class="video-model-source-links">
        <span>{{ t('video.downloadSourcePages') }}</span>
        <a :href="`https://huggingface.co/onnx-community/whisper-${config.videoLocalModel}`" target="_blank" rel="noopener noreferrer" @click.stop>Hugging Face ↗</a>
        <a :href="`https://hf-mirror.com/onnx-community/whisper-${config.videoLocalModel}`" target="_blank" rel="noopener noreferrer" @click.stop>HF Mirror ↗</a>
        <a :href="`https://modelscope.cn/models/onnx-community/whisper-${config.videoLocalModel}`" target="_blank" rel="noopener noreferrer" @click.stop>ModelScope ↗</a>
      </p>
    </div>
    <div class="video-model-list" role="radiogroup" aria-label="本地 AI 字幕模型">
      <article v-for="item in modelCards" :key="item.value" class="video-model-card" :class="{ selected: item.value === config.videoLocalModel, disabled: !active || !config.videoTranslationEnabled || !browserCapabilities.extensionDom }" :onClick="item.choose">
        <label class="video-model-choice">
          <input v-model="item.selection.value" type="radio" name="video-local-model" :value="item.value" :disabled="!active || !config.videoTranslationEnabled || !browserCapabilities.extensionDom" />
          <span class="video-model-card-heading">
            <span class="video-model-icon" aria-hidden="true"><Cpu /></span>
            <strong>{{ item.label }}</strong>
            <span v-if="item.value === recommendedModel" class="video-model-recommended">推荐</span>
            <span v-if="item.value === config.videoLocalModel" class="video-model-selected">当前选择</span>
          </span>
        </label>
        <p class="video-model-description">{{ item.description }}</p>
        <p class="video-model-size">{{ t('modelCache.downloadSize', {size: item.downloadSizeMb}) }}</p>
        <div class="video-model-card-footer">
          <div v-if="isDownloading(item.value)" class="video-model-progress">
            <DownloadProgress :progress="progress[item.value]" :label="t('video.aiDownloadingModel')" :data-video-model-progress="item.value" />
            <p class="video-model-transfer-status" role="status" :data-video-model-transfer="item.value">{{ downloadStatus(item.value) }}</p>
          </div>
          <span v-else class="video-model-availability" role="status">
            <Check v-if="downloaded.includes(item.value)" aria-hidden="true" />
            {{ !modelStateLoaded ? '读取中…' : downloaded.includes(item.value) ? '可离线使用' : '尚未下载' }}
          </span>
          <button v-if="downloaded.includes(item.value)" type="button" class="video-model-download-button" :disabled="!active || removing.includes(item.value)" :aria-label="t('modelCache.removeNamed', {name: translateLegacy(item.label)})" @click.stop="item.remove()"><Delete aria-hidden="true" />{{ t(removing.includes(item.value) ? 'modelCache.removing' : 'modelCache.remove') }}</button>
          <button v-else type="button" class="video-model-download-button" :aria-label="t('video.modelDownloadAria', {model: translateLegacy(item.label)})" :disabled="!active || !modelStateLoaded || isDownloading(item.value) || !config.videoTranslationEnabled || !browserCapabilities.extensionDom" @click.stop="item.download()">
            <component :is="isDownloading(item.value) ? Loading : Download" :class="{ 'is-loading': isDownloading(item.value) }" aria-hidden="true" />
            {{ isDownloading(item.value) ? '下载中…' : failedDownloads.includes(item.value) ? t('video.downloadRetry') : '下载模型' }}
          </button>
        </div>
      </article>
    </div>
    <p class="video-model-guidance">{{ t('video.modelDeviceHint') }}</p>
    <p v-if="downloadError || modelReadError" class="video-model-error" role="alert">{{ downloadError || modelReadError }}</p>
  </section>
  <section class="video-ai-cache-panel" data-video-ai-cache aria-labelledby="video-ai-cache-title">
    <div class="video-ai-cache-copy">
      <div class="video-ai-cache-heading">
        <Files aria-hidden="true" />
        <h3 id="video-ai-cache-title">已识别视频缓存</h3>
        <span class="video-ai-cache-status" role="status">{{ cacheStats ? t('video.cacheCount', {count: cacheStats.entries}) : cacheError ? '读取失败' : '读取中…' }}</span>
      </div>
      <p>最多保留 32 个视频、7 天；只保存字幕文字和时间，不保存音频</p>
      <p v-if="cacheError" class="video-model-error" role="alert">{{ cacheError }}</p>
    </div>
    <button type="button" class="video-model-download-button video-ai-cache-clear" :disabled="!active || clearingCache || !cacheStats || cacheStats.entries === 0" :onClick="cacheActions.clear">
      <Delete aria-hidden="true" />{{ clearingCache ? '清除中…' : '清除缓存' }}
    </button>
  </section>
</template>

<script lang="ts" setup>
import {useUiI18n} from '@/src/ui/i18n';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useSettingsActionContext} from '../model/useSettingsActionContext';
import browser from 'webextension-polyfill';
import {Check, Cpu, Delete, Download, Files, Loading} from '@element-plus/icons-vue';
import {
  VIDEO_LOCAL_TRANSCRIPTION_MODELS,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE,
  VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE,
  VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE,
  normalizeVideoLocalTranscriptionModels,
  VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL,
  type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/public';
import type {Config} from '@/src/core/config/model';
import type {ModelSourcePreference} from '@/src/platform/http/modelDownloads';
import {videoModelDownloadId, type DownloadProgress as DownloadProgressValue} from '@/src/core/download/progress';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {watchDownloadProgress} from '@/src/platform/storage/downloadProgress';
import DownloadProgress from '@/src/ui/components/DownloadProgress.vue';

const {t, translateLegacy} = useUiI18n();
const props = withDefaults(defineProps<{config: Config; active?: boolean; context?: unknown}>(), {active: true});
// 设置页会整体替换草稿；始终读取最新 prop，避免卡片继续编辑旧配置。
const config = computed(() => props.config);
const {active, capture, revision} = useSettingsActionContext(() => props.active, () => [props.config, props.context]);
const modelOptions = VIDEO_LOCAL_TRANSCRIPTION_MODELS;
// 来源偏好只属于本设置视图；旧模板事件不得改变新视图后续请求的来源。
const sourcePreference = ref<ModelSourcePreference>('auto');
const sourceControls = computed(() => {
  const current = capture(), target = props.config;
  return {choose: (event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (current() && target.videoTranslationEnabled && browserCapabilities.extensionDom && ['auto', 'official', 'mirror'].includes(value)) sourcePreference.value = value as ModelSourcePreference;
  }};
});
const modelCopy: Record<VideoLocalTranscriptionModel, [string, string]> = {
  tiny: ['video.modelTinyName', 'video.modelTinyHint'],
  base: ['video.modelBaseName', 'video.modelBaseHint'],
  small: ['video.modelSmallName', 'video.modelSmallHint'],
};
const modelCards = computed(() => {
  const current = capture(), target = props.config;
  return modelOptions.map(item => ({
    ...item,
    label: t(modelCopy[item.value][0]),
    description: t(modelCopy[item.value][1]),
    selection: computed({get: () => target.videoLocalModel, set: (value: VideoLocalTranscriptionModel) => selectModel(value, current, target)}),
    choose: () => selectModel(item.value, current, target),
    download: () => {
      selectModel(item.value, current, target);
      return download(item.value, current);
    },
    remove: () => removeModel(item.value, current),
  }));
});
const cacheActions = computed(() => {
  const current = capture();
  return {clear: () => clearVideoAiCache(current)};
});
// 与播放器内的首次下载确认使用同一推荐，避免两处给出不同建议。
const recommendedModel = VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL;
const downloaded = ref<VideoLocalTranscriptionModel[]>([]);
const modelStateLoaded = ref(false);
// 本页发起的请求与播放器里发起、仍在进行的下载都算“下载中”；后者只能从实时进度事件得知。
const downloading = ref<VideoLocalTranscriptionModel[]>([]);
const observedDownloads = ref<VideoLocalTranscriptionModel[]>([]);
const progress = ref<Partial<Record<VideoLocalTranscriptionModel, DownloadProgressValue>>>({});
const downloadError = ref('');
const failedDownloads = ref<VideoLocalTranscriptionModel[]>([]);
let stopObserving: (() => void) | undefined;
const modelReadError = ref('');
const removing = ref<VideoLocalTranscriptionModel[]>([]);
const cacheStats = ref<{entries: number; bytes: number; maxEntries: number; ttlMs: number} | null>(null);
const cacheError = ref('');
const clearingCache = ref(false);
const mounted = ref(false);
// 记录已交给后台、尚未回包的各模型下载；视图停用不会取消这些任务。
const pendingDownloads = ref(new Set<VideoLocalTranscriptionModel>());
let modelGeneration = 0;
let cacheGeneration = 0;

function selectModel(model: VideoLocalTranscriptionModel, current: () => boolean, target: Config): void {
  if (!current() || !target.videoTranslationEnabled || !browserCapabilities.extensionDom) return;
  target.videoLocalModel = model;
}

function isDownloading(model: VideoLocalTranscriptionModel): boolean {
  return !downloaded.value.includes(model) && (downloading.value.includes(model) || observedDownloads.value.includes(model) || pendingDownloads.value.has(model));
}

function downloadStatus(model: VideoLocalTranscriptionModel): string {
  const transfer = progress.value[model]?.transfer;
  if (!transfer) return t('video.downloadWaiting');
  const names = {modelscope: 'ModelScope', huggingface: 'Hugging Face', 'hf-mirror': 'HF Mirror', other: t('video.downloadSourceOther')};
  const key = transfer.state === 'receiving' ? 'video.downloadReceiving' : transfer.attempt > 1 ? 'video.downloadSwitching' : 'video.downloadConnecting';
  return t(key, {source: names[transfer.source], attempt: transfer.attempt, attempts: transfer.attempts});
}

function handleDownloadProgress(id: string, next: DownloadProgressValue | undefined): void {
  const model = modelOptions.find(item => videoModelDownloadId(item.value) === id)!.value;
  progress.value = {...progress.value, [model]: next};
  if (next) {
    if (!observedDownloads.value.includes(model)) observedDownloads.value = [...observedDownloads.value, model];
    return;
  }
  // 结束事件不说明成败；不是本页发起的下载需要重新读取已下载列表。
  const external = observedDownloads.value.includes(model) && !downloading.value.includes(model);
  observedDownloads.value = observedDownloads.value.filter(item => item !== model);
  if (external) void refresh();
}

async function refresh(force = false): Promise<void> {
  const current = capture();
  if (!current() || !force && (downloading.value.length || removing.value.length)) return;
  const request = ++modelGeneration;
  try {
    const response = await browser.runtime.sendMessage({type: VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE}) as {success?: boolean; models?: unknown} | undefined;
    if (!current() || request !== modelGeneration) return;
    if (response?.success !== true || !Array.isArray(response.models)) throw new Error('无法读取模型缓存，请重试');
    downloaded.value = normalizeVideoLocalTranscriptionModels(response.models);
    modelReadError.value = '';
  } catch {
    if (current() && request === modelGeneration) {
      modelReadError.value = '无法读取模型缓存，请重试';
    }
  } finally {
    if (current() && request === modelGeneration) modelStateLoaded.value = true;
  }
}

async function download(model: VideoLocalTranscriptionModel, current = capture()): Promise<void> {
  if (!current()) return;
  if (!browserCapabilities.extensionDom) {
    downloadError.value = '当前浏览器不支持本地 AI 字幕';
    return;
  }
  if (pendingDownloads.value.has(model) || downloaded.value.includes(model) || isDownloading(model)) return;
  modelGeneration++;
  downloadError.value = '';
  failedDownloads.value = failedDownloads.value.filter(item => item !== model);
  progress.value = {...progress.value, [model]: undefined};
  downloading.value = [...downloading.value, model];
  pendingDownloads.value.add(model);
  try {
    const response = await browser.runtime.sendMessage({type: 'fluentReadPrepareLocalVideoModel', model, preference: sourcePreference.value}) as {success?: boolean; models?: unknown; error?: string} | undefined;
    if (!current()) return;
    if (!response?.success) throw new Error(response?.error || '模型下载失败');
  } catch (error) {
    if (current()) {
      failedDownloads.value = [...failedDownloads.value, model];
      downloadError.value = error instanceof Error ? t('video.modelDownloadError', {error: translateLegacy(error.message)}) : '模型下载失败，请检查网络后重试';
    }
  } finally {
    pendingDownloads.value.delete(model);
    if (current()) {
      downloading.value = downloading.value.filter(item => item !== model);
      observedDownloads.value = observedDownloads.value.filter(item => item !== model);
    }
    // 命令结算后新视图独立重读权威状态，不移交旧回包或错误。
    if (active.value) await refresh();
  }
}

async function removeModel(model: VideoLocalTranscriptionModel, current = capture()): Promise<void> {
  if (!current() || removing.value.includes(model)) return;
  modelGeneration++;
  removing.value.push(model);
  downloadError.value = '';
  failedDownloads.value = failedDownloads.value.filter(item => item !== model);
  try {
    const response = await browser.runtime.sendMessage({type: 'fluentReadRemoveLocalVideoModel', model}) as {success?: boolean; error?: string; models?: unknown} | undefined;
    if (!current()) return;
    if (!response?.success) throw new Error(response?.error || t('modelCache.removeFailed'));
  } catch (error) { if (current()) downloadError.value = error instanceof Error ? translateLegacy(error.message) : t('modelCache.removeFailed'); }
  finally {
    if (current()) {
      removing.value = removing.value.filter(item => item !== model);
      await refresh();
    }
  }
}

async function refreshCacheStats(): Promise<void> {
  const current = capture();
  const request = ++cacheGeneration;
  try {
    const response = await browser.runtime.sendMessage({type: VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE}) as {success?: boolean; stats?: typeof cacheStats.value} | undefined;
    if (!current() || request !== cacheGeneration) return;
    if (!response?.success || !response.stats) throw new Error('无法读取已识别字幕缓存，请重试');
    cacheStats.value = response.stats;
    cacheError.value = '';
  } catch (error) {
    if (current() && request === cacheGeneration) cacheError.value = error instanceof Error ? error.message : '无法读取已识别字幕缓存，请重试';
  }
}

async function clearVideoAiCache(current = capture()): Promise<void> {
  if (!current() || clearingCache.value) return;
  cacheGeneration++;
  clearingCache.value = true;
  cacheError.value = '';
  try {
    const response = await browser.runtime.sendMessage({type: VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE}) as {success?: boolean; error?: string} | undefined;
    if (!current()) return;
    if (!response?.success) throw new Error(response?.error || '清除已识别字幕失败');
    await refreshCacheStats();
  } catch (error) {
    if (current()) cacheError.value = error instanceof Error ? error.message : '清除已识别字幕失败，请重试';
  } finally {
    if (current()) clearingCache.value = false;
  }
}

watch(() => [mounted.value, revision.value], () => {
  stopObserving?.();
  stopObserving = undefined;
  modelGeneration++;
  cacheGeneration++;
  downloading.value = [];
  removing.value = [];
  observedDownloads.value = [];
  progress.value = {};
  downloadError.value = '';
  failedDownloads.value = [];
  modelReadError.value = '';
  modelStateLoaded.value = false;
  clearingCache.value = false;
  cacheError.value = '';
  if (!mounted.value || !active.value) return;
  const current = capture();
  const handleStorageChange = (changes: Record<string, browser.Storage.StorageChange>, areaName: string) => {
    if (current() && areaName === 'local' && changes[VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY]) void refresh();
  };
  // 回到设置时重新核对模型文件与字幕统计；Cache Storage 丢失文件不会触发 storage.onChanged。
  const refreshVisibleCacheStats = () => {
    if (current() && !clearingCache.value && document.visibilityState !== 'hidden') {
      void refresh();
      void refreshCacheStats();
    }
  };
  browser.storage.onChanged.addListener(handleStorageChange);
  const stopProgress = watchDownloadProgress(modelOptions.map(item => videoModelDownloadId(item.value)), (id, next) => {
    if (current()) handleDownloadProgress(id, next);
  });
  document.addEventListener('visibilitychange', refreshVisibleCacheStats);
  window.addEventListener('focus', refreshVisibleCacheStats);
  stopObserving = () => {
    browser.storage.onChanged.removeListener(handleStorageChange);
    stopProgress();
    document.removeEventListener('visibilitychange', refreshVisibleCacheStats);
    window.removeEventListener('focus', refreshVisibleCacheStats);
  };
  void refresh(true);
  void refreshCacheStats();
}, {flush: 'sync'});
onMounted(() => {mounted.value = true;});
onUnmounted(() => {mounted.value = false;});
</script>

<style scoped>
.video-model-size { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.video-model-management {
  display: grid;
  gap: 14px;
  padding: 18px 16px;
  border-top: 1px solid var(--line);
}

.video-model-download-heading,
.video-model-card-heading,
.video-model-card-footer,
.video-ai-cache-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.video-model-download-heading,
.video-model-card-footer { justify-content: space-between; }
.video-model-download-heading { align-items: flex-start; }
h3 { margin: 0; color: var(--ink); font-size: 12.5px; font-weight: 700; line-height: 1.5; }
.video-model-status { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.video-model-choice { display: block; min-width: 0; cursor: pointer; }
.video-model-choice input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.video-model-choice:focus-within .video-model-card-heading { outline: 2px solid var(--brand); outline-offset: 3px; border-radius: 5px; }
.video-model-local-badge,
.video-model-availability,
.video-model-download-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.video-model-local-badge { flex: none; padding: 5px 8px; border-radius: 6px; color: var(--muted); background: var(--surface-soft); font-size: 10px; }
svg { width: 15px; height: 15px; flex: none; }
.video-model-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 12px; }
.video-model-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
.video-model-card:not(.disabled) { cursor: pointer; }
.video-model-card.selected { border-color: var(--brand); background: color-mix(in srgb, var(--brand-soft) 25%, var(--surface)); }
.video-model-card-heading { flex-wrap: wrap; gap: 8px; }
.video-model-card-heading strong { color: var(--ink); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.video-model-card-heading::before { width: 15px; height: 15px; flex: none; border: 2px solid var(--line); border-radius: 50%; background: var(--surface); box-shadow: inset 0 0 0 3px var(--surface); content: ''; }
.video-model-choice input:checked + .video-model-card-heading::before { border-color: var(--brand); background: var(--brand); }
.video-model-choice input:disabled + .video-model-card-heading { cursor: default; }
.video-model-choice input:disabled + .video-model-card-heading::before { opacity: .6; }
.video-model-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 8px; color: var(--muted); background: var(--surface-soft); }
.selected .video-model-icon { color: var(--brand-strong); background: var(--brand-soft); }
.video-model-icon svg { width: 18px; height: 18px; }
.video-model-recommended { padding: 3px 6px; border-radius: 5px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; line-height: 1.4; white-space: nowrap; }
.video-model-selected { padding: 3px 6px; border-radius: 5px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; line-height: 1.4; white-space: nowrap; }
.video-model-description { flex: 1; margin: 0; color: var(--muted); font-size: 11px; line-height: 1.65; }
.video-model-availability { justify-content: flex-start; color: var(--muted); font-size: 10.5px; line-height: 1.5; }
.video-model-progress { flex: 1 1 auto; }
.video-model-transfer-status { margin: 5px 0 0; color: var(--muted); font-size: 10.5px; line-height: 1.5; overflow-wrap: anywhere; }
.video-model-source-settings { display: grid; gap: 7px; min-width: 0; }
.video-model-source-choice { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--ink); font-size: 11px; }
.video-model-source-choice select { max-width: 100%; min-height: 32px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); font: inherit; }
.video-model-source-choice select:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.video-model-source-links { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0; color: var(--muted); font-size: 10.5px; line-height: 1.5; }
.video-model-source-links a { color: var(--brand-strong); }
.video-model-download-button {
  flex: none;
  min-height: 32px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--surface);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.video-model-download-button:hover:not(:disabled) { color: var(--brand-strong); border-color: var(--brand); background: var(--brand-soft); }
.video-model-download-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.video-model-download-button:disabled { color: var(--muted); background: var(--surface-soft); opacity: .65; cursor: default; }
.video-model-guidance { margin: 0; color: var(--muted); font-size: 10.5px; line-height: 1.65; }
.video-model-error { margin: 0; color: var(--el-color-danger); font-size: 11px; line-height: 1.5; }
.video-ai-cache-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px 20px;
  margin: 0 16px 16px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-soft);
}
.video-ai-cache-copy { display: grid; gap: 7px; min-width: 0; flex: 1 1 260px; }
.video-ai-cache-heading { flex-wrap: wrap; gap: 8px; color: var(--muted); }
.video-ai-cache-copy > p { margin: 0; color: var(--muted); font-size: 10.5px; line-height: 1.65; }
.video-ai-cache-copy > .video-model-error { color: var(--el-color-danger); }
.video-ai-cache-status { padding: 3px 7px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--surface); font-size: 10px; line-height: 1.4; }
.capability-warning { margin: 6px 0 0; color: var(--el-color-danger); font-size: 11px; line-height: 1.5; }
.is-loading { animation: video-model-spin 1s linear infinite; }
@keyframes video-model-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .is-loading { animation: none; } }
@media (max-width: 480px) {
  .video-model-management { padding: 16px 12px; }
  .video-model-download-heading { flex-wrap: wrap; }
  .video-model-card { padding: 12px; }
  .video-ai-cache-panel { margin: 0 12px 12px; padding: 12px; }
  .video-ai-cache-clear { width: 100%; }
}
</style>
