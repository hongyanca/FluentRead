<!--
 * @file src/features/glossary/ui/BuiltinGlossaries.vue
 * 文件职责：展示随扩展内嵌的主题词库，让用户先查看真实词条，再添加可编辑副本。
 * 主要内容：标题与说明直接位于页面上，词库卡片不再套在外层卡片内；按领域呈现语言、条数、真实示例与已添加状态，添加为主操作、预览为文字操作，术语库总开关关闭时提示添加后需先开启；本地搜索预览完整词表，说明独立整理来源及不自动覆盖的版本策略。
 * 模块边界：只读取目录和父级传入的配置，添加通过事件交给设置页既有保存队列；不写存储、不联网、不改变总开关。
 -->
<template>
  <section class="fluentread-glossary" data-testid="builtin-glossaries" data-i18n-ignore>
    <div class="builtin-catalog">
      <h3 class="builtin-heading">{{ t('glossary.builtin.title') }} <small>{{ BUILTIN_GLOSSARIES.length }}</small></h3>
      <p class="glossary-help">{{ t('glossary.builtin.help') }}</p>
      <p v-if="!enabled" class="glossary-help builtin-disabled-note" role="note">{{ t('glossary.builtin.helpDisabled') }}</p>
      <div class="builtin-grid">
        <article v-for="preset in BUILTIN_GLOSSARIES" :key="preset.id" :data-testid="`builtin-${preset.id}`" class="builtin-card">
          <div class="builtin-card-heading"><UiIcon :name="preset.id.startsWith('ai') ? 'star' : preset.id.startsWith('software') ? 'sliders' : preset.id.startsWith('finance') ? 'chart' : 'book'" :size="20" /><h4>{{ t(preset.nameKey) }}</h4><span v-if="installed(preset.id)" class="builtin-added">{{ t('glossary.builtin.added') }}</span></div><p class="glossary-help">{{ t(preset.descriptionKey) }}</p>
          <small>{{ t('glossary.entryCount', {count: preset.terms.length}) }} · {{ t(preset.targetLanguage ? 'glossary.builtin.englishChinese' : 'glossary.builtin.allLanguages') }}</small>
          <div class="builtin-examples"><div v-for="[source, target] in preset.terms.slice(0, 2)" :key="source"><span>{{ source }}</span><span>→</span><strong>{{ target || t('glossary.keepOriginal') }}</strong></div></div>
          <div class="glossary-actions builtin-actions">
            <button type="button" class="glossary-text-button" :aria-label="t('glossary.builtin.previewNamed', {name: t(preset.nameKey)})" @click="previewId = preset.id; search = ''">{{ t('glossary.builtin.preview') }}</button>
            <button type="button" :class="{'builtin-add': !installed(preset.id)}" :disabled="disabled || (!installed(preset.id) && atCapacity(preset.terms.length))" :aria-label="t(installed(preset.id) ? 'glossary.builtin.manageNamed' : 'glossary.builtin.addNamed', {name: t(preset.nameKey)})" @click="$emit('add', preset.id)">{{ t(installed(preset.id) ? 'glossary.builtin.manage' : 'glossary.builtin.add') }}</button>
          </div>
        </article>
      </div>
    </div>
    <el-dialog :model-value="Boolean(preview)" :title="preview ? t(preview.nameKey) : ''" width="min(680px, calc(100vw - 28px))" @update:model-value="previewId = ''">
      <div v-if="preview" class="fluentread-glossary" data-i18n-ignore data-testid="builtin-glossary-preview">
        <p class="glossary-help">{{ t('glossary.builtin.source', {version: preview.version}) }}</p>
        <p class="glossary-help">{{ t('glossary.builtin.previewHelp') }}</p>
        <label>{{ t('glossary.search') }}<input v-model="search" type="search" /></label>
        <p role="status">{{ t('glossary.entryCount', {count: terms.length}) }}</p>
        <div class="builtin-terms glossary-table-scroll"><table class="glossary-table"><thead><tr><th>{{ t('glossary.source') }}</th><th>{{ t('glossary.target') }}</th></tr></thead>
          <tbody><tr v-for="[source, target] in terms" :key="source"><td>{{ source }}</td><td>{{ target || t('glossary.keepOriginal') }}</td></tr></tbody>
        </table><p v-if="!terms.length" class="glossary-help">{{ t('glossary.noResults') }}</p></div>
        <div class="glossary-actions glossary-dialog-actions"><button type="button" @click="previewId = ''">{{ t('common.close') }}</button><button type="button" class="primary" :disabled="disabled || (!installed(preview.id) && atCapacity(preview.terms.length))" @click="$emit('add', preview.id); previewId = ''">{{ t(installed(preview.id) ? 'glossary.builtin.manage' : 'glossary.builtin.add') }}</button></div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import UiIcon from '@/src/ui/components/UiIcon.vue';
import {BUILTIN_GLOSSARIES} from '@/src/core/glossary/builtins';
import {GLOSSARY_LIMITS, type GlossaryLibrary} from '@/src/core/glossary';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{libraries: GlossaryLibrary[]; enabled: boolean; disabled: boolean}>();
defineEmits<{add: [id: string]}>();
const {t} = useUiI18n();
const previewId = ref('');
const search = ref('');
const preview = computed(() => BUILTIN_GLOSSARIES.find(preset => preset.id === previewId.value));
const terms = computed(() => (preview.value?.terms || []).filter(([source, target]) => `${source}\n${target}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
function atCapacity(count: number): boolean {return props.libraries.length >= GLOSSARY_LIMITS.libraries || props.libraries.reduce((total, library) => total + library.entries.length, count) > GLOSSARY_LIMITS.totalEntries;}
function installed(id: string): GlossaryLibrary | undefined {return props.libraries.find(library => library.preset?.id === id);}
</script>

<style scoped src="./glossary-settings.css"></style>
<style scoped>
.fluentread-glossary .builtin-heading { margin: 0; font-weight: 650; }
.builtin-heading small { margin-left: 5px; font-weight: 400; }
.fluentread-glossary .builtin-catalog > .glossary-help { margin: 4px 0 0; }
.fluentread-glossary .builtin-disabled-note { color: var(--el-color-warning-dark-2); }
.builtin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 12px; }
.builtin-card { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--line, var(--el-border-color)); border-radius: 12px; padding: 18px; background: var(--surface, var(--el-bg-color)); }
.builtin-card-heading { display: flex; align-items: center; gap: 10px; }
.builtin-card-heading > svg { color: var(--brand, var(--el-color-primary)); }
.builtin-card h4 { margin: 0; font-size: 14px; }
.builtin-added { margin-left: auto; font-size: 11px; color: var(--brand, var(--el-color-primary)); }
.builtin-examples { background: var(--surface-soft, var(--el-fill-color-light)); border-radius: 8px; padding: 10px 12px; margin: 14px 0; font-size: 12px; }
.builtin-examples > div { display: grid; grid-template-columns: minmax(0,1fr) 14px minmax(0,1fr); gap: 10px; padding: 3px 0; overflow-wrap: anywhere; }
.builtin-examples strong { font-weight: 500; }
.builtin-actions { margin-top: auto; gap: 14px; }
.fluentread-glossary .builtin-add { border-color: var(--brand, var(--el-color-primary)); color: var(--brand-strong, var(--el-color-primary)); background: var(--brand-soft, var(--el-color-primary-light-9)); font-weight: 600; }
.fluentread-glossary .builtin-add:hover:not(:disabled) { background: var(--brand-soft, var(--el-color-primary-light-9)); filter: brightness(.97); }
.builtin-terms { max-height: 300px; }
@media (max-width: 760px) { .builtin-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
