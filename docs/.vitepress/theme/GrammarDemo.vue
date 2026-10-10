<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDemoPlayback } from './useDemoPlayback'
import DemoSteps from './DemoSteps.vue'
const props = defineProps<{ en?: boolean }>()
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, choose, select } = useDemoPlayback(root, 4, true, 2800)
const active = computed(() => step.value)
const t = (zh: string, en: string) => (props.en ? en : zh)
const parts = [
  {
    text: 'Every language',
    role: ['主语', 'Subject'],
    type: ['名词短语', 'Noun phrase'],
    meaning: ['每一种语言', 'Every language'],
    detail: [
      '谁在提供新的方式？Every language 是句子的主语。Every 修饰 language，指每一种语言。',
      'Who offers the new perspective? “Every language” is the subject. “Every” describes “language”.',
    ],
    color: 'teal',
  },
  {
    text: 'offers',
    role: ['谓语', 'Predicate'],
    type: ['动词', 'Verb'],
    meaning: ['提供、带来', 'Provides, gives'],
    detail: [
      'offers 表示“提供、带来”，说明主语做了什么。主语是单数 language，所以动词用 offers。',
      '“Offers” tells us what the subject does. It takes the -s ending because “language” is singular.',
    ],
    color: 'rose',
  },
  {
    text: 'a new way',
    role: ['宾语', 'Object'],
    type: ['名词短语', 'Noun phrase'],
    meaning: ['一种新的方式', 'A new way'],
    detail: [
      '提供了什么？a new way 是 offers 的宾语，new 修饰 way。',
      'What does each language offer? “A new way” is the object of “offers”. “New” describes “way”.',
    ],
    color: 'blue',
  },
  {
    text: 'to see the world',
    role: ['后置定语', 'Modifier'],
    type: ['不定式短语', 'Infinitive phrase'],
    meaning: ['看世界的', 'To see the world'],
    detail: [
      '是哪一种方式？to see the world 放在 way 后面，补充说明“看世界的方式”。',
      'What kind of way? “To see the world” follows “way” and tells us what that way is for.',
    ],
    color: 'amber',
  },
]
function next(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  choose((index + (event.key === 'ArrowRight' ? 1 : -1) + parts.length) % parts.length)
  const group = (event.currentTarget as HTMLElement).parentElement
  ;(group?.querySelectorAll('button')[active.value] as HTMLElement)?.focus()
}
</script>

<template>
  <div
    ref="root"
    class="fr-grammar"
    data-demo="grammar"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
  >
    <p class="fr-demo-kicker">
      {{ t('原句拆解 · 自动高亮并解释一个片段', 'SENTENCE STRUCTURE · ONE PHRASE AT A TIME') }}
    </p>
    <DemoSteps
      :labels="parts.map((part) => part.role[en ? 1 : 0])"
      :active="active"
      :label="t('句子拆解步骤', 'Sentence walkthrough')"
      :playing="playing"
      :reduced="reduced"
      :en="en"
      @select="select"
    />
    <div
      class="fr-grammar-parts"
      role="group"
      :aria-label="t('句子结构示例', 'Example sentence structure')"
    >
      <button
        v-for="(part, index) in parts"
        :key="part.text"
        type="button"
        :class="[`fr-grammar-${part.color}`, { active: active === index }]"
        :aria-pressed="active === index"
        :data-grammar-index="index"
        @click="choose(index)"
        @keydown="next($event, index)"
      >
        <span>{{ part.text }}{{ index === parts.length - 1 ? '.' : '' }}</span
        ><small>{{ part.role[en ? 1 : 0] }} · {{ part.type[en ? 1 : 0] }}</small>
      </button>
    </div>
    <p class="fr-grammar-translation">
      {{
        t(
          '每一种语言都带来一种看世界的新方式。',
          'Every language offers a new way to see the world.'
        )
      }}
    </p>
    <div class="fr-grammar-detail" :key="active" :aria-live="playing ? 'off' : 'polite'">
      <strong
        >{{ parts[active].text }} <span>{{ parts[active].meaning[en ? 1 : 0] }}</span></strong
      >
      <p>{{ parts[active].detail[en ? 1 : 0] }}</p>
    </div>
    <div class="bv-auto-controls">
      <small>{{
        t('自动拆解句子 · 可点选片段', 'Automatic walkthrough · choose any phrase')
      }}</small>
      <button
        v-if="!reduced"
        type="button"
        :aria-label="
          playing ? t('暂停句法演示', 'Pause grammar demo') : t('播放句法演示', 'Play grammar demo')
        "
        @click="playing = !playing"
      >
        {{ playing ? t('暂停', 'Pause') : t('播放', 'Play') }}
      </button>
    </div>
    <p class="fr-demo-disclosure">
      {{
        t(
          '示例内容 · 句子标注仅供学习参考',
          'Example content · sentence annotations are for learning reference'
        )
      }}
    </p>
  </div>
</template>
