<!--
@file src/features/settings/ui/ConfigManagement.vue
文件职责：提供备份与恢复页面的完整数据备份和设置历史。
主要内容：首先挂载唯一的完整备份入口，再展示最近修改与自动设置快照，并在恢复前展示差异。
模块边界：本组件拥有设置历史的预览与恢复；主动备份和旧文件兼容导入由 LocalDataManagement 统一编排。
-->
<template>
  <section class="config-management">
    <LocalDataManagement :config="config" />

    <header class="history-heading">
      <h2>设置历史</h2>
      <p>用于找回误改的设置；不包含单词本、模型用量或 API 凭据。</p>
    </header>
    <div class="version-grid">
      <section class="version-panel" aria-labelledby="recent-config-title">
        <header class="version-panel-heading">
          <div>
            <h2 id="recent-config-title">最近修改</h2>
            <p>有效配置变化会自动记录，最多保留 10 份。</p>
          </div>
          <span>{{ historyEntries.length }}/10</span>
        </header>
        <div v-if="historyEntries.length" class="version-list">
          <button
            v-for="entry in historyEntries"
            :key="entry.version"
            type="button"
            class="version-entry"
            :class="{ current: entry.version === currentHistoryVersion }"
            :aria-label="`查看最近修改 v${entry.version}，${snapshotSummary(entry.config)}，${formatTime(entry.savedAt)}`"
            @click="openHistoryPreview(entry)"
          >
            <span class="version-badge">v{{ entry.version }}</span>
            <span class="version-copy">
              <strong>{{ snapshotSummary(entry.config) }}</strong>
              <small>{{ formatTime(entry.savedAt) }}</small>
            </span>
            <span v-if="entry.version === currentHistoryVersion" class="current-mark">当前</span>
            <span v-else class="view-link">查看</span>
          </button>
        </div>
        <div v-else class="version-empty">修改设置后会在这里生成版本。</div>
      </section>

      <section class="version-panel" aria-labelledby="automatic-backup-title">
        <header class="version-panel-heading">
          <div>
            <h2 id="automatic-backup-title">自动设置快照</h2>
            <p>后台每 6 小时保存一次设置，最多保留 10 份。</p>
          </div>
          <span>{{ backupEntries.length }}/10</span>
        </header>
        <div v-if="backupEntries.length" class="version-list">
          <button
            v-for="entry in backupEntries"
            :key="entry.version"
            type="button"
            class="version-entry"
            :aria-label="`查看自动设置快照 b${entry.version}，${snapshotSummary(entry.config)}，${formatTime(entry.savedAt)}`"
            @click="openBackupPreview(entry)"
          >
            <span class="version-badge backup">b{{ entry.version }}</span>
            <span class="version-copy">
              <strong>{{ snapshotSummary(entry.config) }}</strong>
              <small>{{ formatTime(entry.savedAt) }}</small>
            </span>
            <span class="view-link">查看</span>
          </button>
        </div>
        <div v-else class="version-empty">首次启动后台后会建立一份基线备份。</div>
      </section>
    </div>

    <el-dialog
      v-model="previewVisible"
      class="config-preview-dialog"
      :title="previewTitle"
      width="min(880px, calc(100vw - 32px))"
      destroy-on-close
      @closed="clearPreview"
    >
      <template v-if="previewTarget">
        <div class="preview-summary">
          <div>
            <span>{{ previewSourceLabel }}</span>
            <strong>{{ formatTime(previewTarget.savedAt) }}</strong>
          </div>
          <b :class="{ empty: previewChangeCount === 0 }">
            {{ previewChangeCount ? `${previewChangeCount} 项不同` : '与当前相同' }}
          </b>
        </div>

        <div v-if="previewDiff.groups.length" class="diff-groups">
          <section v-for="group in previewDiff.groups" :key="group.id" class="diff-group">
            <h3>{{ group.label }}<span>{{ group.changes.length }}</span></h3>
            <div class="diff-list">
              <article v-for="change in group.changes" :key="change.key" class="diff-item">
                <strong>{{ change.label }}</strong>
                <div><span>当前</span><p>{{ change.before }}</p></div>
                <div><span>此版本</span><p>{{ change.after }}</p></div>
              </article>
            </div>
          </section>
        </div>
        <div v-else class="diff-empty">这份配置与当前可恢复配置完全相同。</div>

        <details class="json-details">
          <summary>查看完整配置 JSON</summary>
          <pre>{{ previewJson }}</pre>
        </details>
        <p class="restore-boundary">{{ previewBoundary }}</p>
      </template>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="applyBusy"
          :disabled="!previewTarget || previewChangeCount === 0"
          @click="applyPreviewTarget"
        >{{ previewActionLabel }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {computed, onUnmounted, ref} from 'vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import browser from 'webextension-polyfill';
import {options} from '@/src/core/config/catalog';
import {buildConfigDiff} from '@/src/core/config/diff';
import type {Config} from '@/src/core/config/model';
import {
  configAutoBackupsReady,
  configHistoryReady,
  getConfigAutoBackupsSnapshot,
  getConfigHistorySnapshot,
  requestConfigAutoBackupRestore,
  requestConfigHistoryAction,
  subscribeConfigAutoBackups,
  subscribeConfigHistory,
  type ConfigAutoBackupEntry,
  type ConfigAutoBackupState,
  type ConfigHistoryEntry,
  type ConfigHistoryState,
} from '@/src/services/config';
import {toRestorableConfig} from '@/src/services/config/history';
import LocalDataManagement from './LocalDataManagement.vue';

const props = defineProps<{config: Config}>();
const sendRuntimeMessage = browser.runtime.sendMessage.bind(browser.runtime);

const configHistory = ref<ConfigHistoryState>(getConfigHistorySnapshot());
const configBackups = ref<ConfigAutoBackupState>(getConfigAutoBackupsSnapshot());
const historyEntries = computed(() => [...configHistory.value.entries].reverse());
const backupEntries = computed(() => [...configBackups.value.entries].reverse());
const currentHistoryVersion = computed(() => configHistory.value.entries[configHistory.value.cursor]?.version ?? null);

void configHistoryReady.then(() => { configHistory.value = getConfigHistorySnapshot(); });
void configAutoBackupsReady.then(() => { configBackups.value = getConfigAutoBackupsSnapshot(); });
const unsubscribeHistory = subscribeConfigHistory((history) => { configHistory.value = history; });
const unsubscribeBackups = subscribeConfigAutoBackups((backups) => { configBackups.value = backups; });
onUnmounted(() => {
  unsubscribeHistory();
  unsubscribeBackups();
});

function formatTime(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function snapshotSummary(value: ConfigHistoryEntry['config'] | ConfigAutoBackupEntry['config']): string {
  const target = options.to.find((item: any) => item.value === value.to)?.label || value.to;
  const service = options.services.find((item: any) => item.value === value.service)?.label || value.service;
  const rules = (value.alwaysTranslateDomains?.length || 0) + (value.disabledExtensionDomains?.length || 0);
  return `${target} · ${service} · ${rules} 条网站规则`;
}

type PreviewKind = 'history' | 'backup';
interface PreviewTarget {
  kind: PreviewKind;
  version?: number;
  label: string;
  savedAt: string;
  config: unknown;
}

const previewTarget = ref<PreviewTarget | null>(null);
const previewVisible = ref(false);
const applyBusy = ref(false);
const resolvedPreviewConfig = computed(() => previewTarget.value?.config);
const previewDiff = computed(() => buildConfigDiff(
  toRestorableConfig(props.config),
  toRestorableConfig(resolvedPreviewConfig.value),
));
const previewChangeCount = computed(() => previewDiff.value.changeCount);
const previewJson = computed(() => JSON.stringify(toRestorableConfig(resolvedPreviewConfig.value), null, 2));
const previewTitle = '设置版本详情';
const previewSourceLabel = computed(() => previewTarget.value?.kind === 'history'
  ? `最近修改 ${previewTarget.value.label}`
  : `自动设置快照 ${previewTarget.value?.label || ''}`);
const previewActionLabel = '恢复此版本';
const previewBoundary = 'API 凭据和翻译次数不会随设置版本恢复。';

function showPreview(target: PreviewTarget) {
  previewTarget.value = target;
  previewVisible.value = true;
}

function openHistoryPreview(entry: ConfigHistoryEntry) {
  showPreview({kind: 'history', version: entry.version, label: `v${entry.version}`, savedAt: entry.savedAt, config: entry.config});
}

function openBackupPreview(entry: ConfigAutoBackupEntry) {
  showPreview({kind: 'backup', version: entry.version, label: `b${entry.version}`, savedAt: entry.savedAt, config: entry.config});
}

function clearPreview() {
  previewTarget.value = null;
  applyBusy.value = false;
}

async function applyPreviewTarget() {
  const target = previewTarget.value;
  if (!target || previewChangeCount.value === 0 || applyBusy.value) return;
  try {
    await ElMessageBox.confirm(
      `将恢复 ${target.label}，并生成一份新的最近修改记录。是否继续？`,
      '确认恢复设置',
      {confirmButtonText: '恢复', cancelButtonText: '取消', type: 'warning'},
    );
  } catch {
    return;
  }

  applyBusy.value = true;
  try {
    if (target.kind === 'history') {
      configHistory.value = await requestConfigHistoryAction('restore', target.version, sendRuntimeMessage);
    } else if (target.kind === 'backup') {
      const result = await requestConfigAutoBackupRestore(target.version!, sendRuntimeMessage);
      configBackups.value = result.backups;
      configHistory.value = result.history;
    }
    previewVisible.value = false;
    ElMessage.success('设置已恢复');
  } catch (error) {
    ElMessage.error(`恢复失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    applyBusy.value = false;
  }
}
</script>

<style scoped>
.config-management { width: 100%; }
.history-heading { width: min(100%, 1080px); margin: 0 auto 10px; padding: 0 4px; }
.history-heading h2 { margin: 0; color: var(--ink); font-size: 15px; line-height: 1.4; }
.history-heading p { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.version-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; width: min(100%, 1080px); margin: 0 auto 22px; }
.version-panel { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); box-shadow: 0 7px 22px rgba(31, 40, 61, .035); }
.version-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px; border-bottom: 1px solid var(--line); }
.version-panel-heading h2 { margin: 0; color: var(--ink); font-size: 15px; }
.version-panel-heading p { margin: 4px 0 0; color: var(--muted); font-size: 10.5px; line-height: 1.5; }
.version-panel-heading > span { flex: none; padding: 4px 8px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; font-weight: 750; }
.version-list { max-height: 360px; overflow-y: auto; }
.version-entry { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 58px; padding: 9px 12px; border: 0; border-bottom: 1px solid var(--line); color: inherit; background: transparent; text-align: left; cursor: pointer; }
.version-entry:last-child { border-bottom: 0; }
.version-entry:hover { background: var(--surface-soft); }
.version-entry.current { background: var(--brand-soft); }
.version-badge { display: grid; place-items: center; min-height: 28px; border-radius: 9px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; font-weight: 800; }
.version-badge.backup { color: #267260; background: #eaf8f4; }
.version-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.version-copy strong { overflow: hidden; color: var(--ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.version-copy small { color: var(--muted); font-size: 9.5px; }
.view-link, .current-mark { color: var(--brand-strong); font-size: 10px; font-weight: 750; }
.current-mark { padding: 3px 7px; border-radius: 999px; background: var(--brand-soft); }
.version-empty { padding: 28px 16px; color: var(--muted); font-size: 11px; text-align: center; }
.preview-summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-soft); }
.preview-summary > div { display: flex; flex-direction: column; gap: 3px; }
.preview-summary span { color: var(--muted); font-size: 10px; }
.preview-summary strong { color: var(--ink); font-size: 12px; }
.preview-summary b { padding: 5px 9px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; }
.preview-summary b.empty { color: #267260; background: #eaf8f4; }
.diff-groups { display: grid; gap: 14px; max-height: 48vh; margin-top: 16px; padding-right: 4px; overflow-y: auto; }
.diff-group h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 7px; color: var(--ink); font-size: 12px; }
.diff-group h3 span { display: grid; place-items: center; min-width: 20px; height: 20px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 9px; }
.diff-list { overflow: hidden; border: 1px solid var(--line); border-radius: 12px; }
.diff-item { display: grid; grid-template-columns: minmax(130px, .65fr) repeat(2, minmax(0, 1fr)); gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.diff-item:last-child { border-bottom: 0; }
.diff-item > strong { align-self: center; color: var(--ink); font-size: 10.5px; }
.diff-item div { min-width: 0; }
.diff-item span { color: var(--muted); font-size: 9px; }
.diff-item p { margin: 3px 0 0; overflow-wrap: anywhere; color: var(--muted); font-size: 10px; line-height: 1.45; }
.diff-empty { margin-top: 16px; padding: 28px; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); font-size: 11px; text-align: center; }
.json-details { margin-top: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); }
.json-details summary { padding: 11px 13px; color: var(--ink); cursor: pointer; font-size: 10.5px; font-weight: 700; }
.json-details pre { max-height: 280px; margin: 0; padding: 12px; overflow: auto; border-top: 1px solid var(--line); color: var(--muted); background: var(--surface); font-size: 9.5px; line-height: 1.55; white-space: pre-wrap; }
.restore-boundary { margin: 10px 2px 0; color: var(--muted); font-size: 10px; line-height: 1.5; }

@media (max-width: 900px) {
  .version-grid { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .diff-item { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .version-entry { grid-template-columns: 40px minmax(0, 1fr) auto; }
}

:global(:root.dark) .version-badge.backup { color: #80d8c2; background: rgba(38, 114, 96, .22); }
:global(:root.dark) .preview-summary b.empty { color: #80d8c2; background: rgba(38, 114, 96, .22); }
</style>
