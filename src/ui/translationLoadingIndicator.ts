/**
 * @file src/ui/translationLoadingIndicator.ts
 * 文件职责：创建不受宿主网页 CSS 与同名关键帧影响的段落翻译加载指示器。
 * 主要内容：以固定尺寸的 light-DOM 宿主保留翻译状态标记，在独立 Shadow Root 内渲染 15 种反馈；同一 Document 共享解析后的样式表，不支持时安全回退，并统一处理缓存色与减少动态效果。
 * 模块边界：本文件只负责指示器 DOM 与视觉隔离，不读取配置仓库、不插入目标段落，也不管理翻译请求生命周期。
 */

import {
  normalizeTranslationLoadingStyle,
  type TranslationLoadingStyle,
} from '@/src/core/config/translationLoadingStyle'

export interface TranslationLoadingIndicatorOptions {
  style: TranslationLoadingStyle
  animated: boolean
  cacheHit?: boolean
}

const HOST_IMPORTANT_STYLES: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],
  ['box-sizing', 'border-box'],
  ['position', 'static'],
  ['inset', 'auto'],
  ['display', 'inline-flex'],
  ['float', 'none'],
  ['clear', 'none'],
  ['flex', '0 0 16px'],
  ['width', '16px'],
  ['min-width', '16px'],
  ['max-width', '16px'],
  ['height', '16px'],
  ['min-height', '16px'],
  ['max-height', '16px'],
  ['margin', '0 0 0 2px'],
  ['padding', '0'],
  ['border', '0'],
  ['border-radius', '0'],
  ['align-items', 'center'],
  ['justify-content', 'center'],
  ['overflow', 'hidden'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['color', 'initial'],
  ['background', 'transparent'],
  ['box-shadow', 'none'],
  ['font', 'normal 16px/1 sans-serif'],
  ['line-height', '1'],
  ['vertical-align', '-2px'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['animation', 'none'],
  ['transition', 'none'],
  ['pointer-events', 'none'],
  ['user-select', 'none'],
  ['isolation', 'isolate'],
  ['contain', 'layout style paint'],
]

const LOADING_INDICATOR_STYLES = `
:host {
  all: initial !important;
  box-sizing: border-box !important;
  display: inline-flex !important;
  width: 16px !important;
  min-width: 16px !important;
  max-width: 16px !important;
  height: 16px !important;
  min-height: 16px !important;
  max-height: 16px !important;
  margin: 0 0 0 2px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  align-items: center !important;
  justify-content: center !important;
  overflow: hidden !important;
  color: initial !important;
  background: transparent !important;
  box-shadow: none !important;
  font: normal 16px/1 sans-serif !important;
  line-height: 1 !important;
  opacity: 1 !important;
  vertical-align: -2px !important;
  transform: none !important;
  filter: none !important;
  pointer-events: none !important;
  user-select: none !important;
  isolation: isolate !important;
  contain: layout style paint !important;
}

:host::before,
:host::after {
  content: none !important;
  display: none !important;
}

.fr-loading-visual,
.fr-loading-visual > i {
  box-sizing: border-box;
}

.fr-loading-visual {
  position: relative;
  display: grid;
  width: 14px;
  height: 14px;
  margin: 0;
  padding: 0;
  border: 0;
  place-items: center;
  color: #7b8493;
  background: transparent;
  line-height: 1;
}

.fr-loading-visual > i {
  display: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: currentColor;
}

:host([data-fr-loading-style="minimal"]) .fr-loading-visual > i:first-child {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  opacity: .46;
  animation: fluent-read-loading-breathe 1.35s ease-in-out infinite;
}

:host([data-fr-loading-style="ring"]) .fr-loading-visual {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(123, 132, 147, .22);
  border-top-color: rgba(103, 119, 148, .82);
  border-right-color: rgba(103, 119, 148, .48);
  border-radius: 50%;
  animation: fluent-read-loading-spin .92s linear infinite;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual {
  display: flex;
  width: 15px;
  height: 10px;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual > i {
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  opacity: .48;
  animation: fluent-read-loading-dot 1.05s ease-in-out infinite;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual > i:nth-child(2) {
  animation-delay: .13s;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual > i:nth-child(3) {
  animation-delay: .26s;
}

:host([data-fr-loading-style="orbit"]) .fr-loading-visual {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(123, 132, 147, .24);
  border-radius: 50%;
}

:host([data-fr-loading-style="orbit"]) .fr-loading-visual > i:first-child {
  position: absolute;
  top: -1px;
  left: 5.5px;
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  transform-origin: 1.5px 8px;
  animation: fluent-read-loading-spin 1.3s linear infinite;
}

:host([data-fr-loading-style="orbit"]) .fr-loading-visual > i:nth-child(2) {
  position: absolute;
  top: 5px;
  left: 5px;
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  opacity: .32;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual {
  width: 16px;
  height: 14px;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual > i {
  position: absolute;
  display: block;
  clip-path: polygon(50% 0, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0 50%, 37% 37%);
  border-radius: 1px;
  animation: fluent-read-loading-sparkle 1.45s ease-in-out infinite;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual > i:first-child {
  top: 2px;
  left: 1px;
  width: 8px;
  height: 8px;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual > i:nth-child(2) {
  right: 1px;
  bottom: 1px;
  width: 5px;
  height: 5px;
  opacity: .38;
  animation-delay: .42s;
}

:host([data-fr-loading-style="pulse"]) .fr-loading-visual {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(123, 132, 147, .22);
  border-radius: 50%;
}

:host([data-fr-loading-style="pulse"]) .fr-loading-visual > i:first-child {
  display: block;
  width: 6px;
  height: 6px;
  border: 1px solid currentColor;
  border-radius: 50%;
  animation: fluent-read-loading-pulse 1.35s ease-out infinite;
}

:host([data-fr-loading-style="pulse"]) .fr-loading-visual > i:nth-child(2) {
  position: absolute;
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  opacity: .75;
}

:host([data-fr-loading-style="wave"]) .fr-loading-visual {
  display: flex;
  width: 15px;
  height: 13px;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

:host([data-fr-loading-style="wave"]) .fr-loading-visual > i {
  display: block;
  width: 2px;
  height: 8px;
  border-radius: 2px;
  opacity: .62;
  animation: fluent-read-loading-wave 1.05s ease-in-out infinite;
}

:host([data-fr-loading-style="wave"]) .fr-loading-visual > i:nth-child(2) { animation-delay: .13s; }
:host([data-fr-loading-style="wave"]) .fr-loading-visual > i:nth-child(3) { animation-delay: .26s; }

:host([data-fr-loading-style="sweep"]) .fr-loading-visual {
  width: 15px;
  height: 10px;
  border-bottom: 1px solid rgba(123, 132, 147, .28);
}

:host([data-fr-loading-style="sweep"]) .fr-loading-visual > i:first-child {
  position: absolute;
  left: 1px;
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  animation: fluent-read-loading-sweep 1.25s ease-in-out infinite;
}

:host([data-fr-loading-style="sweep"]) .fr-loading-visual > i:nth-child(2) {
  position: absolute;
  left: 1px;
  bottom: 1px;
  display: block;
  width: 5px;
  height: 1px;
  opacity: .38;
  animation: fluent-read-loading-sweep-tail 1.25s ease-in-out infinite;
}

:host([data-fr-loading-style="hourglass"]) .fr-loading-visual {
  width: 12px;
  height: 14px;
  animation: fluent-read-loading-hourglass 1.55s ease-in-out infinite;
}

:host([data-fr-loading-style="hourglass"]) .fr-loading-visual > i:first-child,
:host([data-fr-loading-style="hourglass"]) .fr-loading-visual > i:nth-child(2) {
  position: absolute;
  left: 2px;
  display: block;
  width: 8px;
  height: 6px;
  border: 1px solid currentColor;
  opacity: .65;
}

:host([data-fr-loading-style="hourglass"]) .fr-loading-visual > i:first-child {
  top: 0;
  clip-path: polygon(0 0, 100% 0, 62% 100%, 38% 100%);
}

:host([data-fr-loading-style="hourglass"]) .fr-loading-visual > i:nth-child(2) {
  bottom: 0;
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
}

:host([data-fr-loading-style="hourglass"]) .fr-loading-visual > i:nth-child(3) {
  display: block;
  width: 2px;
  height: 4px;
  border-radius: 1px;
  opacity: .7;
}

:host([data-fr-loading-style="comet"]) .fr-loading-visual {
  width: 16px;
  height: 12px;
}

:host([data-fr-loading-style="comet"]) .fr-loading-visual > i:first-child {
  position: absolute;
  left: 2px;
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  animation: fluent-read-loading-comet 1.2s ease-in-out infinite;
}

:host([data-fr-loading-style="comet"]) .fr-loading-visual > i:nth-child(2),
:host([data-fr-loading-style="comet"]) .fr-loading-visual > i:nth-child(3) {
  position: absolute;
  left: 1px;
  display: block;
  height: 1px;
  border-radius: 1px;
  opacity: .42;
  transform-origin: left center;
  animation: fluent-read-loading-comet-tail 1.2s ease-in-out infinite;
}

:host([data-fr-loading-style="comet"]) .fr-loading-visual > i:nth-child(2) {
  top: 4px;
  width: 7px;
}

:host([data-fr-loading-style="comet"]) .fr-loading-visual > i:nth-child(3) {
  top: 7px;
  width: 4px;
  animation-delay: .08s;
}

:host([data-fr-loading-style="flip"]) .fr-loading-visual {
  width: 12px;
  height: 12px;
  perspective: 24px;
}

:host([data-fr-loading-style="flip"]) .fr-loading-visual > i:first-child {
  display: block;
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  border-radius: 2px;
  animation: fluent-read-loading-flip 1.2s ease-in-out infinite;
}

:host([data-fr-loading-style="bounce"]) .fr-loading-visual {
  width: 15px;
  height: 14px;
  align-items: end;
}

:host([data-fr-loading-style="bounce"]) .fr-loading-visual > i:first-child {
  position: absolute;
  bottom: 3px;
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  animation: fluent-read-loading-bounce 1s ease-in-out infinite;
}

:host([data-fr-loading-style="bounce"]) .fr-loading-visual > i:nth-child(2) {
  position: absolute;
  bottom: 1px;
  display: block;
  width: 10px;
  height: 1px;
  border-radius: 1px;
  opacity: .3;
}

:host([data-fr-loading-style="typing"]) .fr-loading-visual {
  width: 14px;
  height: 13px;
  align-items: center;
  justify-content: center;
}

:host([data-fr-loading-style="typing"]) .fr-loading-visual > i:first-child {
  display: block;
  width: 2px;
  height: 11px;
  border-radius: 1px;
  animation: fluent-read-loading-caret 1s step-end infinite;
}

:host([data-fr-loading-style="typing"]) .fr-loading-visual > i:nth-child(2),
:host([data-fr-loading-style="typing"]) .fr-loading-visual > i:nth-child(3) {
  position: absolute;
  display: block;
  height: 1px;
  border-radius: 1px;
  opacity: .28;
}

:host([data-fr-loading-style="typing"]) .fr-loading-visual > i:nth-child(2) { top: 2px; left: 1px; width: 4px; }
:host([data-fr-loading-style="typing"]) .fr-loading-visual > i:nth-child(3) { bottom: 2px; right: 1px; width: 5px; }

:host([data-fr-loading-style="scan"]) .fr-loading-visual {
  width: 15px;
  height: 12px;
  border: 1px solid rgba(123, 132, 147, .25);
  border-radius: 2px;
}

:host([data-fr-loading-style="scan"]) .fr-loading-visual > i:first-child {
  position: absolute;
  left: 1px;
  display: block;
  width: 1px;
  height: 10px;
  opacity: .78;
  animation: fluent-read-loading-scan 1.25s ease-in-out infinite;
}

:host([data-fr-loading-style="scan"]) .fr-loading-visual > i:nth-child(2) {
  display: block;
  width: 5px;
  height: 1px;
  opacity: .28;
}

:host([data-fr-loading-style="scan"]) .fr-loading-visual > i:nth-child(3) {
  position: absolute;
  right: 2px;
  display: block;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  opacity: .48;
}

:host([data-fr-loading-style="signal"]) .fr-loading-visual {
  display: flex;
  width: 15px;
  height: 13px;
  align-items: end;
  justify-content: center;
  gap: 2px;
}

:host([data-fr-loading-style="signal"]) .fr-loading-visual > i {
  display: block;
  width: 2px;
  border-radius: 1px;
  opacity: .62;
  animation: fluent-read-loading-signal 1.1s ease-in-out infinite;
}

:host([data-fr-loading-style="signal"]) .fr-loading-visual > i:first-child { height: 4px; }
:host([data-fr-loading-style="signal"]) .fr-loading-visual > i:nth-child(2) { height: 8px; animation-delay: .14s; }
:host([data-fr-loading-style="signal"]) .fr-loading-visual > i:nth-child(3) { height: 12px; animation-delay: .28s; }

:host([data-fr-cache="true"]) .fr-loading-visual {
  color: #679276;
}

:host([data-fr-cache="true"][data-fr-loading-style="ring"]) .fr-loading-visual {
  border-color: rgba(103, 146, 118, .22);
  border-top-color: rgba(82, 139, 101, .82);
  border-right-color: rgba(82, 139, 101, .48);
}

:host([data-fr-motion="static"]) .fr-loading-visual,
:host([data-fr-motion="static"]) .fr-loading-visual > i {
  animation: none !important;
}

:host([data-fr-motion="static"][data-fr-loading-style="minimal"]) .fr-loading-visual > i:first-child {
  opacity: .55;
  transform: none;
}

:host([data-fr-motion="static"][data-fr-loading-style="dots"]) .fr-loading-visual > i {
  opacity: .5;
  transform: none;
}

:host([data-fr-motion="static"][data-fr-loading-style="sparkle"]) .fr-loading-visual > i {
  opacity: .5;
  transform: none;
}

@keyframes fluent-read-loading-breathe {
  0%, 100% { opacity: .3; transform: scale(.82); }
  50% { opacity: .62; transform: scale(1); }
}

@keyframes fluent-read-loading-spin {
  to { transform: rotate(360deg); }
}

@keyframes fluent-read-loading-dot {
  0%, 60%, 100% { opacity: .38; transform: translateY(1px); }
  30% { opacity: .76; transform: translateY(-2px); }
}

@keyframes fluent-read-loading-sparkle {
  0%, 100% { opacity: .22; transform: scale(.72) rotate(0deg); }
  48% { opacity: .72; transform: scale(1) rotate(20deg); }
}

@keyframes fluent-read-loading-pulse {
  0% { opacity: .72; transform: scale(.5); }
  70%, 100% { opacity: 0; transform: scale(2.1); }
}

@keyframes fluent-read-loading-wave {
  0%, 100% { opacity: .35; transform: scaleY(.5); }
  50% { opacity: .82; transform: scaleY(1.15); }
}

@keyframes fluent-read-loading-sweep {
  0%, 100% { opacity: .3; transform: translateX(0); }
  50% { opacity: .9; transform: translateX(9px); }
}

@keyframes fluent-read-loading-sweep-tail {
  0%, 100% { opacity: .15; transform: translateX(0) scaleX(.6); }
  50% { opacity: .48; transform: translateX(9px) scaleX(1); }
}

@keyframes fluent-read-loading-hourglass {
  0%, 38% { transform: rotate(0deg); }
  50%, 88%, 100% { transform: rotate(180deg); }
}

@keyframes fluent-read-loading-comet {
  0%, 100% { opacity: .28; transform: translateX(0); }
  50% { opacity: .9; transform: translateX(9px); }
}

@keyframes fluent-read-loading-comet-tail {
  0%, 100% { opacity: .18; transform: scaleX(.5); }
  50% { opacity: .5; transform: scaleX(1); }
}

@keyframes fluent-read-loading-flip {
  0%, 25% { transform: rotateY(0deg); }
  65%, 100% { transform: rotateY(180deg); }
}

@keyframes fluent-read-loading-bounce {
  0%, 100% { opacity: .45; transform: translateY(0) scaleX(1); }
  45% { opacity: .9; transform: translateY(-6px) scaleX(.88); }
  60% { transform: translateY(0) scaleX(1.12); }
}

@keyframes fluent-read-loading-caret {
  0%, 48% { opacity: .85; }
  49%, 100% { opacity: .14; }
}

@keyframes fluent-read-loading-scan {
  0%, 100% { opacity: .25; transform: translateX(0); }
  50% { opacity: .9; transform: translateX(12px); }
}

@keyframes fluent-read-loading-signal {
  0%, 100% { opacity: .28; transform: scaleY(.62); }
  50% { opacity: .9; transform: scaleY(1); }
}

@media (prefers-reduced-motion: reduce) {
  .fr-loading-visual,
  .fr-loading-visual > i {
    animation: none !important;
  }
}
`

type SharedLoadingStylesheet = CSSStyleSheet & {
  replaceSync?: (text: string) => void
}

const sharedLoadingStylesheets = new WeakMap<Document, SharedLoadingStylesheet>()

/** 在当前 Document 的 CSS realm 中只构造一次样式表；任一能力缺失都交给 style 回退。 */
function getSharedLoadingStylesheet(document: Document): SharedLoadingStylesheet | null {
  const existing = sharedLoadingStylesheets.get(document)
  if (existing) return existing

  const CSSStyleSheetConstructor = document.defaultView?.CSSStyleSheet as
    | (new () => SharedLoadingStylesheet)
    | undefined
  if (typeof CSSStyleSheetConstructor !== 'function') return null

  try {
    const stylesheet = new CSSStyleSheetConstructor()
    if (typeof stylesheet.replaceSync !== 'function') return null
    stylesheet.replaceSync(LOADING_INDICATOR_STYLES)
    sharedLoadingStylesheets.set(document, stylesheet)
    return stylesheet
  } catch {
    return null
  }
}

/** 将共享表应用到 closed ShadowRoot；Shadow DOM 不支持或被宿主拒绝时保持原有 style 注入。 */
function adoptSharedLoadingStylesheet(shadow: ShadowRoot, document: Document): boolean {
  const stylesheet = getSharedLoadingStylesheet(document)
  if (!stylesheet) return false

  try {
    const adopted = shadow.adoptedStyleSheets
    if (!Array.isArray(adopted)) return false
    shadow.adoptedStyleSheets = [...adopted, stylesheet]
    return true
  } catch {
    return false
  }
}

/** 创建固定外部布局、完全隔离内部视觉的加载指示器。 */
export function createTranslationLoadingIndicator(
  document: Document,
  options: TranslationLoadingIndicatorOptions,
): HTMLElement {
  const host = document.createElement('span')
  const style = normalizeTranslationLoadingStyle(options.style)
  host.className = 'fluent-read-loading'
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('translate', 'no')
  host.setAttribute('data-fr-loading-style', style)
  host.setAttribute('data-fr-motion', options.animated ? 'animated' : 'static')
  if (options.cacheHit) host.setAttribute('data-fr-cache', 'true')
  for (const [property, value] of HOST_IMPORTANT_STYLES) {
    host.style.setProperty(property, value, 'important')
  }

  // closed root 也不会被全文扫描当作待翻译页面内容，并阻止宿主页脚本
  // 直接改写内部样式；外层 host 仍保留状态机需要的可观察标记。
  const shadow = host.attachShadow({mode: 'closed'})
  const visual = document.createElement('span')
  visual.className = 'fr-loading-visual'
  visual.setAttribute('aria-hidden', 'true')
  visual.append(
    document.createElement('i'),
    document.createElement('i'),
    document.createElement('i'),
  )
  if (!adoptSharedLoadingStylesheet(shadow, document)) {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = LOADING_INDICATOR_STYLES
    shadow.append(stylesheet)
  }
  shadow.append(visual)
  return host
}

/** 总开关关闭或系统要求减少动态效果时，只渲染静态状态。 */
export function shouldAnimateTranslationLoading(
  animationsEnabled: boolean,
  view: Pick<Window, 'matchMedia'> | null = null,
): boolean {
  if (!animationsEnabled) return false
  if (!view) return true
  try {
    return view.matchMedia('(prefers-reduced-motion: reduce)').matches !== true
  } catch {
    return true
  }
}
