<!-- 官网文档翻译示意：用本地示例文件、逐段译文与带页码的报告版式呈现导入和双语阅读，不调用翻译服务。 -->
<script setup lang="ts">
import { computed } from 'vue'
import DemoSteps from './DemoSteps.vue'

const props = defineProps<{ step: number; en?: boolean; playing: boolean; reduced?: boolean }>()
defineEmits<{ select: [index: number] }>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const complete = computed(() => props.step >= 4)
const progress = computed(() => [0, 18, 46, 78, 100, 100][props.step] ?? 0)
const stages = computed(() => [
  t('导入文件', 'Import file'),
  t('翻译文档', 'Translate'),
  t('对照阅读', 'Read both'),
])
const activeStage = computed(() => (props.step === 0 ? 0 : complete.value ? 2 : 1))
const report = {
  english: {
    language: 'en',
    title: 'The future of clean energy',
    section: '01  Overview',
    paragraph:
      'Clean energy is changing how we power our world. Solar and wind bring new possibilities.',
    caption: '02  Renewable energy growth',
    footer: 'ENERGY REPORT · 2026',
  },
  chinese: {
    language: 'zh-CN',
    title: '清洁能源的未来',
    section: '01  概述',
    paragraph: '清洁能源正在改变世界的供能方式。太阳能与风能带来了新的可能。',
    caption: '02  可再生能源增长',
    footer: '能源报告 · 2026',
  },
}
const pages = computed(() =>
  props.en ? [report.chinese, report.english] : [report.english, report.chinese]
)
</script>

<template>
  <div class="dd" :data-document-complete="complete">
    <div class="dd-filebar">
      <span class="dd-file-icon" aria-hidden="true">PDF</span>
      <div class="dd-file-info">
        <strong>energy-report.pdf</strong>
        <small>{{ t('示例文档 · 3 页', 'Sample document · 3 pages') }}</small>
      </div>
      <span class="dd-language">{{ t('英语 → 简体中文', 'Chinese → English') }}</span>
    </div>
    <DemoSteps
      :labels="stages"
      :active="activeStage"
      :label="t('文档翻译流程', 'Document translation workflow')"
      :playing="playing"
      :reduced="reduced"
      :en="en"
      @select="$emit('select', $event)"
    />

    <div class="dd-workspace">
      <div v-if="step === 0" class="dd-import">
        <svg viewBox="0 0 48 56" aria-hidden="true">
          <path d="M7 2h22l12 12v38H7Z M29 2v12h12 M15 26h18 M15 33h18 M15 40h11" />
        </svg>
        <strong>{{ t('把文件拖到这里', 'Drop files here') }}</strong>
        <span class="dd-import-file">
          <span class="dd-file-icon" aria-hidden="true">PDF</span>
          energy-report.pdf
        </span>
        <small>{{ t('支持 PDF、Word、ePub 等格式', 'PDF, Word, ePub and more') }}</small>
      </div>
      <template v-else>
        <div
          class="dd-spread"
          :aria-label="t('报告原文与译文对照示例', 'Original and translated report example')"
        >
          <section v-for="(page, index) in pages" :key="index" class="dd-page-column">
            <div class="dd-page-label">
              <span>{{ index === 0 ? t('原文', 'Original') : t('译文', 'Translation') }}</span>
              <small>{{ page.language === 'en' ? 'EN' : '中文' }}</small>
            </div>
            <article class="dd-paper" :lang="page.language">
              <div
                class="dd-paper-heading"
                :class="{ 'dd-pending': index === 1 && step < 2 }"
                :aria-hidden="index === 1 && step < 2"
              >
                <small>{{ page.footer }}</small>
                <h3>{{ page.title }}</h3>
                <h4>{{ page.section }}</h4>
                <p>{{ page.paragraph }}</p>
              </div>
              <div v-if="index === 1 && step < 2" class="dd-placeholder" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>
              <div
                class="dd-paper-figure"
                :class="{ 'dd-pending': index === 1 && step < 3 }"
                :aria-hidden="index === 1 && step < 3"
              >
                <h4>{{ page.caption }}</h4>
                <svg
                  viewBox="0 0 180 65"
                  role="img"
                  :aria-label="
                    t(
                      '示例图表：2023 至 2025 年可再生能源增长',
                      'Sample chart: renewable energy growth from 2023 to 2025'
                    )
                  "
                >
                  <path d="M12 12h156 M12 30h156 M12 48h156" class="dd-chart-grid" />
                  <path d="M35 47V32 M86 47V23 M137 47V12" class="dd-chart-bars" />
                  <text x="35" y="62">2023</text>
                  <text x="86" y="62">2024</text>
                  <text x="137" y="62">2025</text>
                </svg>
              </div>
              <footer>
                <span>{{ page.language === 'en' ? 'CLEAN ENERGY' : '清洁能源' }}</span>
                <span>01</span>
              </footer>
            </article>
          </section>
        </div>
      </template>
    </div>
    <div class="dd-status">
      <template v-if="complete">
        <span class="dd-complete">
          <span aria-hidden="true">✓</span>
          {{ t('翻译完成 · 可校订、下载', 'Translated · edit or download') }}
        </span>
        <span class="dd-page-count">{{ t('第 1 / 3 页', 'Page 1 / 3') }}</span>
      </template>
      <template v-else>
        <span>
          {{
            step === 0
              ? t('等待导入示例文件', 'Ready to import the sample')
              : t('正在逐段翻译…', 'Translating passages…')
          }}
        </span>
        <div
          class="dd-progress"
          role="progressbar"
          :aria-label="t('示例翻译进度', 'Sample translation progress')"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <i :style="{ width: `${progress}%` }"></i>
        </div>
        <span class="dd-progress-value">{{ progress }}%</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dd {
  container-type: inline-size;
  font-size: 11px;
}
.dd-filebar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
}
.dd-file-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 36px;
  border: 1px solid #ecc2cf;
  border-radius: 4px 9px 4px 4px;
  background: #fff4f7;
  color: var(--vp-c-brand-1);
  font-size: 9px;
  font-weight: 750;
}
.dd-file-info {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  line-height: 1.6;
}
.dd-file-info strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dd-file-info small,
.dd-language {
  color: var(--fr-muted);
  font-size: 10px;
}
.dd-language {
  white-space: nowrap;
}
.dd-workspace {
  display: flex;
  gap: 16px;
  height: 380px;
  padding: 14px 20px 18px;
  border-block: 1px solid var(--fr-line);
  background: #f5f5f7;
}
.dd-import {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 14px;
  margin: 12px;
  border: 1px dashed #d9b9c5;
  border-radius: 8px;
  background: #fff;
}
.dd-import > svg {
  width: 40px;
  height: 48px;
  fill: #fff4f7;
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.dd-import strong {
  font-size: 14px;
}
.dd-import-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border: 1px solid var(--fr-line);
  border-radius: 6px;
  font-size: 12px;
}
.dd-import small {
  color: var(--fr-muted);
  font-size: 11px;
}
.dd-thumbnails {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 12px;
  width: 36px;
  padding-top: 24px;
}
.dd-thumbnails > div {
  text-align: center;
  color: var(--fr-muted);
  line-height: 1.3;
}
.dd-mini-page {
  display: block;
  height: 47px;
  padding: 7px 5px;
  border: 1px solid #dddde3;
  background: white;
  box-shadow: 0 2px 3px #26232c06;
}
.dd-mini-page i {
  display: block;
  height: 2px;
  margin-bottom: 4px;
  background: #dedce2;
}
.dd-mini-page i:first-child {
  width: 70%;
  background: #b8b4bf;
}
.dd-mini-page b {
  display: block;
  height: 9px;
  margin-top: 5px;
  background: #dfebe7;
}
.dd-thumbnail-active .dd-mini-page {
  outline: 1px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.dd-thumbnail-active small {
  color: var(--vp-c-brand-1);
}
.dd-spread {
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
}
.dd-page-column {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}
.dd-page-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  color: var(--fr-muted);
  line-height: 1;
}
.dd-page-label small {
  font-size: 9px;
}
.dd-paper {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 18px 16px 12px;
  border: 1px solid #e2e1e6;
  border-radius: 1px;
  background: #fff;
  box-shadow: 0 3px 8px #26232c08;
}
.dd-paper-heading > small {
  display: block;
  color: #77717e;
  font-size: 7px;
  letter-spacing: 0.8px;
}
.dd .dd-paper h3 {
  min-height: 45px;
  margin: 8px 0 14px;
  padding: 0 0 10px;
  border-bottom: 2px solid #39796c;
  color: #2d4e48;
  font: 600 19px/1.25 Georgia, 'Noto Serif SC', serif;
  text-align: left;
  text-wrap: initial;
}
.dd-paper h4 {
  margin: 0 0 6px;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.4;
}
.dd-paper p {
  font-size: 10px;
  line-height: 1.7;
}
.dd-paper-figure {
  margin-top: auto;
  padding-top: 12px;
}
.dd-paper-figure svg {
  display: block;
  width: 100%;
  height: 58px;
  overflow: visible;
}
.dd-chart-grid {
  fill: none;
  stroke: #e5e9e7;
}
.dd-chart-bars {
  stroke: #65998d;
  stroke-width: 23px;
}
.dd-paper-figure text {
  fill: #77717e;
  font: 8px sans-serif;
  text-anchor: middle;
}
.dd-paper footer {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--fr-line);
  color: #77717e;
  font-size: 7px;
  letter-spacing: 0.5px;
}
.dd-paper-heading,
.dd-paper-figure {
  transition: opacity 0.3s ease;
}
.dd-pending {
  opacity: 0;
  visibility: hidden;
}
.dd-placeholder {
  position: absolute;
  top: 23px;
  right: 16px;
  left: 16px;
}
.dd-placeholder i {
  display: block;
  height: 4px;
  margin-bottom: 9px;
  border-radius: 2px;
  background: #eceaee;
}
.dd-placeholder i:first-child {
  width: 45%;
  margin-bottom: 24px;
}
.dd-placeholder i:nth-child(2) {
  height: 10px;
  width: 75%;
  margin-bottom: 35px;
}
.dd-placeholder i:last-child {
  width: 65%;
}
.dd-status {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 42px;
  padding: 10px 20px;
  color: var(--fr-muted);
  font-size: 10px;
}
.dd-complete {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #39796c;
}
.dd-page-count {
  margin-left: auto;
}
.dd-progress {
  width: 76px;
  height: 4px;
  margin-left: auto;
  overflow: hidden;
  border-radius: 4px;
  background: #eceaee;
}
.dd-progress i {
  display: block;
  height: 100%;
  background: var(--vp-c-brand-1);
  transition: width 0.3s ease;
}
.dd-progress-value {
  width: 28px;
  text-align: right;
}
@container (max-width: 470px) {
  .dd-filebar {
    flex-wrap: wrap;
    padding: 14px 14px 10px;
  }
  .dd-language {
    width: 100%;
    padding-left: 40px;
  }
  .dd-workspace {
    gap: 0;
    height: 400px;
    padding-inline: 12px;
  }
  .dd-thumbnails {
    display: none;
  }
  .dd-spread {
    gap: 10px;
  }
  .dd-paper {
    padding: 14px 10px 10px;
  }
  .dd .dd-paper h3 {
    font-size: 17px;
  }
  .dd-paper h4 {
    font-size: 9px;
  }
  .dd-paper p {
    font-size: 9px;
  }
  .dd-status {
    padding-inline: 14px;
  }
}
@container (max-width: 320px) {
  .dd-workspace {
    height: 440px;
    padding-inline: 8px;
  }
  .dd-spread {
    gap: 8px;
  }
  .dd .dd-paper h3 {
    font-size: 15px;
  }
  .dd-import {
    margin: 6px;
  }
  .dd-import strong {
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dd-paper-heading,
  .dd-paper-figure,
  .dd-progress i {
    transition: none;
  }
}
</style>
