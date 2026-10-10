<!--
 * @file src/features/image-translation/ui/MangaEntry.vue
 * 文件职责：提供安静的漫画入口，仅在用户主动启动且缺少资源时说明首次下载。
 * 主要内容：普通悬浮球不可见时显示紧凑漫画按钮，默认常驻；按源语言说明识别资源和首次下载，俄语或韩语复用既有语言包；圈选页使用区域入口，关闭确认不开始，路由和源语言变化、卸载使迟到检查失效。
 * 模块边界：不自动展开阅读面板，不下载资源、不扫描图片；单页进度属于图片运行时，动作通过注入端口执行，界面只属于 closed Shadow UI。
 -->
<template>
  <button v-if="standalone" ref="launcher" class="fr-manga-launcher" :class="{'is-expanded': expanded || alwaysExpanded}" type="button" :data-animated="settings.animations" :aria-label="actionLabel" :title="buttonTitle" :aria-pressed="status.active" :aria-busy="busy || status.pending" @mouseenter="reveal" @pointermove="pointerReveal" @mouseleave="retract" @focusin="reveal" @focusout="retract" @keydown.esc.stop="collapseLauncher" @click="activate" @contextmenu.prevent="openSettings">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /><path d="M5.5 8.5h4v4h-2l-1.5 1v-1h-.5v-4Zm9.5.5h3m-3 3h3m-3 3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
    <span v-if="busy || status.pending" class="fr-manga-spinner" aria-hidden="true" />
    <span v-else-if="status.errors" class="fr-manga-badge fr-manga-error-badge" aria-hidden="true">!</span>
    <span v-else-if="status.active && (status.completed ?? 0) > 0" class="fr-manga-badge" aria-hidden="true">✓</span>
  </button>
  <aside v-if="visible" class="fr-manga-entry" role="dialog" :aria-label="t('漫画翻译')" @keydown.esc.stop="close">
    <header><strong>{{ t('漫画翻译') }}</strong><button type="button" class="fr-manga-close" :aria-label="t('关闭')" @click="close">×</button></header>
    <template v-if="consent">
      <h3>{{ t('首次使用，先准备阅读资源') }}</h3>
      <p>{{ resourceDescription }}</p>
      <p class="fr-manga-hint">{{ t('首次等待可能较长。图片在本地处理，识别出的文字交给你选择的翻译服务。') }}</p>
      <button type="button" class="fr-manga-primary" :disabled="busy" @click="confirm">{{ t('准备资源并开始') }}</button>
      <button type="button" class="fr-manga-later" :disabled="busy" @click="close">{{ t('稍后') }}</button>
    </template>
    <template v-else>
      <p class="fr-manga-error" role="alert" data-i18n-ignore>{{ error }}</p>
      <button type="button" class="fr-manga-primary" :disabled="busy" @click="start">{{ t('重试') }}</button>
    </template>
    <p v-if="consent && error" class="fr-manga-error" role="alert" data-i18n-ignore>{{ error }}</p>
    <footer><button type="button" @click="openSettings">{{ t('漫画设置') }}</button></footer>
  </aside>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import type {MangaTranslationStatus} from '../content/mangaSession';
import {getMangaOcrEngine, getRequiredImageOcrLanguages} from '../ocrLanguages';
const props = defineProps<{
  status: MangaTranslationStatus; page: {site: string; route: string};
  settings: {sourceLanguage?: string; promptEnabled: boolean; floatingBallVisible: boolean; downloadConfirmed: boolean; animations: boolean; toolsDisplay?: string};
  toggle: () => void; inspectResources: () => Promise<boolean>; persist: (patch: Record<string, unknown>) => Promise<unknown>; openSettings: () => void;
  startAreaTranslation: () => Promise<boolean>;
}>();
const {translateLegacy: t} = useUiI18n();
const consent = ref(false), busy = ref(false), error = ref('');
const standalone = computed(() => props.status.available && !props.settings.floatingBallVisible && props.settings.promptEnabled);
const alwaysExpanded = computed(() => props.settings.toolsDisplay !== 'hover');
const visible = computed(() => props.status.available && (consent.value || !!error.value));
const resourceDescription = computed(() => {
  const sourceLanguage = props.settings.sourceLanguage ?? 'auto';
  if (getMangaOcrEngine(sourceLanguage) === 'paddle') return t('需要下载约 30 MB 的文字识别资源，复杂画面另需约 197 MB 的文字清除资源。下载一次后可重复使用。');
  return t(getRequiredImageOcrLanguages(sourceLanguage).includes('rus')
    ? '需要准备俄语和英语识别资源，约 16 MB。复杂画面另需约 197 MB 的文字清除资源，已下载资源可重复使用。'
    : '需要准备韩语和英语识别资源，约 13 MB。复杂画面另需约 197 MB 的文字清除资源，已下载资源可重复使用。');
});
const actionLabel = computed(() => t(props.status.areaFallback ? '圈选漫画翻译' : props.status.active ? '暂停并显示原图' : '开启连续翻译'));
const buttonTitle = computed(() => {
  const message = busy.value ? '正在检查阅读资源' : props.status.pending ? props.status.message || '正在处理当前漫画页' : props.status.errors ? '部分页面未完成' : '';
  return [t('漫画翻译'), message && t(message), actionLabel.value].filter(Boolean).join(' · ');
});
let disposed = false, request = 0;
const launcher = ref<HTMLButtonElement | null>(null), expanded = ref(false);
let idleTimer: ReturnType<typeof setTimeout> | null = null;
function clearIdle() {if (idleTimer !== null) clearTimeout(idleTimer);idleTimer = null;}
function reveal() {
  expanded.value = true;clearIdle();
  if (alwaysExpanded.value) return;
  if (launcher.value?.matches(':focus-visible')) return;
  idleTimer = setTimeout(() => {idleTimer = null;if (!launcher.value?.matches(':focus-visible')) expanded.value = false;}, 2500);
}
function pointerReveal(event: PointerEvent) {if (event.pointerType === 'mouse') reveal();}
function retract() {clearIdle();if (!launcher.value?.matches(':focus-visible')) expanded.value = false;}
function collapseLauncher() {launcher.value?.blur();clearIdle();expanded.value = false;}
function activate(event: MouseEvent) {void start();if (event.detail > 0) launcher.value?.blur();reveal();}
function close() {request++;busy.value = false;consent.value = false;error.value = '';}
async function start() {
  if (busy.value || !props.status.available) return;
  if (props.status.areaFallback) {
    const owner = ++request;busy.value = true;consent.value = false;error.value = '';
    try {const started = await props.startAreaTranslation();
      if (!disposed && owner === request) {if (started) close();else error.value = t('请在图片/漫画设置中启用圈选翻译，再拖选漫画区域。');}
    } catch (cause) {if (!disposed && owner === request) error.value = t(cause instanceof Error ? cause.message : String(cause));}
    finally {if (!disposed && owner === request) busy.value = false;}return;
  }
  if (props.status.active || props.settings.downloadConfirmed) {close();props.toggle();return;}
  const owner = ++request; busy.value = true; error.value = '';
  try {
    const ready = await props.inspectResources();
    if (disposed || owner !== request || !props.status.available) return;
    if (!ready) consent.value = true;
    else {close();props.toggle();}
  } catch (cause) {if (!disposed && owner === request) error.value = t(cause instanceof Error ? cause.message : String(cause));}
  finally {if (!disposed && owner === request) busy.value = false;}
}
async function confirm() {
  if (busy.value || !consent.value || !props.status.available) return;
  const owner = ++request;busy.value = true;error.value = '';
  try {
    await props.persist({imageTranslationMangaDownloadConfirmed: true});
    if (!disposed && owner === request && props.status.available) {close();props.toggle();}
  } catch (cause) {if (!disposed && owner === request) error.value = t(cause instanceof Error ? cause.message : String(cause));}
  finally {if (!disposed && owner === request) busy.value = false;}
}
watch(() => props.page.route, close);
watch(() => props.settings.sourceLanguage, close);
watch(() => props.status.areaFallback, close);
watch(() => props.status.available, available => {if (!available) close();});
watch(standalone, () => {clearIdle();expanded.value = false;});
onBeforeUnmount(() => {disposed = true;clearIdle();close();});
defineExpose({open: start});
</script>
<style scoped>
.fr-manga-launcher,.fr-manga-entry{box-sizing:border-box;font:13px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#263244;pointer-events:auto;z-index:2147483647;color-scheme:light}
.fr-manga-launcher{position:fixed;right:16px;top:50%;width:32px;height:32px;padding:6px;border:1px solid #dce1e9;border-radius:50%;background:#fff;color:#dc315f;cursor:pointer;box-shadow:0 2px 8px #10182712;transform:translateX(50%);clip-path:inset(-6px 50% -6px -6px);opacity:.52;transition:transform .24s ease,opacity .24s ease}.fr-manga-launcher.is-expanded,.fr-manga-launcher:focus-visible{transform:translateX(0);clip-path:none;opacity:1}.fr-manga-launcher svg{display:block;width:18px;height:18px}.fr-manga-launcher:focus-visible,.fr-manga-entry button:focus-visible{outline:2px solid #dc315f;outline-offset:3px}
.fr-manga-badge{position:absolute;right:-3px;bottom:-3px;width:19px;height:19px;border:2px solid #fff;border-radius:50%;box-sizing:border-box;background:#15803d;color:#fff;font-size:12px;line-height:15px;text-align:center;font-weight:700}.fr-manga-error-badge{background:#a64009}.fr-manga-spinner{position:absolute;inset:3px;border:2px solid #f4c8d5;border-top-color:#dc315f;border-radius:50%;animation:fr-manga-entry-spin .8s linear infinite}
.fr-manga-entry{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:320px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;padding:16px;background:#fff;border:1px solid #e5e8ee;border-radius:16px;box-shadow:0 8px 32px #10182729}.fr-manga-entry *{box-sizing:border-box}.fr-manga-entry header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.fr-manga-entry strong{font-size:15px}.fr-manga-entry p{margin:8px 0 12px}.fr-manga-entry h3{font-size:14px;margin:8px 0}.fr-manga-hint{font-size:12px;color:#667085}.fr-manga-entry button{font:inherit;cursor:pointer;border:0;background:transparent;color:inherit;border-radius:8px}.fr-manga-entry button:disabled{opacity:.55;cursor:default}.fr-manga-close{width:28px;height:28px;font-size:22px!important;color:#697589!important}.fr-manga-entry .fr-manga-primary{width:100%;min-height:38px;padding:8px 12px;background:#dc315f;color:#fff;font-weight:650}.fr-manga-later{display:block;margin:6px auto 0;padding:5px 12px}.fr-manga-entry footer{border-top:1px solid #eef0f4;margin-top:12px;padding-top:8px}.fr-manga-entry footer button{font-size:12px;color:#697589;padding:3px 0}.fr-manga-error{color:#a64009;font-size:12px}@keyframes fr-manga-entry-spin{to{transform:rotate(360deg)}}
.fr-manga-launcher[data-animated=false] .fr-manga-spinner{animation:none}.fr-manga-launcher[data-animated=false]{transition:none}
@media(prefers-color-scheme:dark){.fr-manga-entry,.fr-manga-launcher{color:#f1f3f8;background:#222731;border-color:#404858;color-scheme:dark}.fr-manga-launcher{color:#ff799c}.fr-manga-badge{border-color:#222731}.fr-manga-hint,.fr-manga-entry footer button{color:#b0bacb}.fr-manga-entry footer{border-color:#404858}.fr-manga-error{color:#ffca9e}}
@media(prefers-reduced-motion:reduce){.fr-manga-spinner{animation:none}.fr-manga-launcher{transition:none}}
</style>
