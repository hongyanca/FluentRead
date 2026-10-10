<!--
@file src/features/selection-translation/ui/SpeechFollowText.vue
文件职责：在扩展自身的朗读文字上显示随音频推进的完整词高亮。
主要内容：稳定分词保留原文与排版，当前词以中性色背景轻柔淡入淡出；说明估算精度，尊重减少动画偏好。
模块边界：不修改宿主页、不加载模型、不使用 HTML 字符串渲染；播放位置与生命周期由 SelectionTranslator 提供。
-->
<template>
    <span><template v-for="token in tokens" :key="token.start"><span v-if="token.word" class="fr-speech-word" :class="{'fr-speech-current': isCurrent(token)}" :title="isCurrent(token) ? translateLegacy(progress?.estimated ? '跟读进度按句段时长估算' : '跟随语音词边界') : undefined">{{ token.text }}</span><template v-else>{{ token.text }}</template></template></span>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import {speechTextTokens, type SpeechProgress, type SpeechTextToken} from '@/src/core/tts/speechProgress';
import {useUiI18n} from '@/src/ui/i18n';
const {translateLegacy}=useUiI18n();
const props=defineProps<{text:string; offset:number; progress:SpeechProgress|null}>();
const tokens=computed(()=>speechTextTokens(props.text));
function isCurrent(token: SpeechTextToken): boolean {
    return props.progress !== null && token.start + props.offset < props.progress.end && token.end + props.offset > props.progress.start;
}
</script>
<style scoped>
.fr-speech-word {border-radius:2px;background-color:transparent;box-decoration-break:clone;-webkit-box-decoration-break:clone;transition:background-color .12s ease-out;}
.fr-speech-current {background-color:color-mix(in srgb,currentColor 16%,transparent);}
@media (prefers-reduced-motion:reduce){.fr-speech-word{transition:none;}}
</style>
