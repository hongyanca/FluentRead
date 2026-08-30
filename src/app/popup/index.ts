/**
 * @file src/app/popup/index.ts
 * 文件职责：创建 Popup Vue 应用并注册其 Element Plus 控件和图标依赖，作为 WXT popup entrypoint 与 PopupApp 之间的 composition root。
 * 主要内容：加载 popup.css、Element Plus 基础样式和共享 token，维护 Select、Switch、Slider、Dialog 等组件及图标清单，创建 App、逐项注册后挂载到指定 selector。
 * 模块边界：这里不读取当前标签页、不保存配置，也不处理 Popup 业务事件；所有响应式交互在 PopupApp 中，feature 与 runtime 行为通过公开模块完成。
 */
import {createApp} from 'vue';
import './popup.css';
import App from './PopupApp.vue';
import 'element-plus/dist/index.css'
import { ChatDotRound, Setting, Refresh, Edit, Upload, Download, Star, Loading, Coffee, WarningFilled, Warning, CircleCheckFilled } from '@element-plus/icons-vue'

import {
  ElRow,
  ElCol,
  ElContainer,
  ElHeader,
  ElMain,
  ElFooter,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElInput,
  ElSwitch,
  ElCollapse,
  ElCollapseItem,
  ElTooltip,
  ElEmpty,
  ElIcon,
  ElLink,
  ElText,
  ElButton,
  ElDialog,
  ElDivider,
  ElInputNumber,
  ElDrawer
} from 'element-plus'

const ELEMENT_COMPONENTS = [
  ElRow,
  ElCol,
  ElContainer,
  ElHeader,
  ElMain,
  ElFooter,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElInput,
  ElSwitch,
  ElCollapse,
  ElCollapseItem,
  ElTooltip,
  ElEmpty,
  ElIcon,
  ElLink,
  ElText,
  ElButton,
  ElDialog,
  ElDivider,
  ElInputNumber,
  ElDrawer
] as const

const ELEMENT_ICONS = {
  ChatDotRound,
  Setting,
  Refresh,
  Edit,
  Upload,
  Download,
  Star,
  Loading,
  Coffee,
  WarningFilled,
  Warning,
  CircleCheckFilled,
} as const

/** Popup 的唯一组装入口：注册页面依赖后挂载 Vue 根组件。 */
export function mountPopupApp(selector: string): void {
  const app = createApp(App)

  // 步骤 1：只注册 Popup 模板真正使用的 Element Plus 组件和图标。
  for (const component of ELEMENT_COMPONENTS) {
    if (component.name) app.component(component.name, component)
  }
  for (const [name, component] of Object.entries(ELEMENT_ICONS)) {
    app.component(name, component)
  }

  // 步骤 2：由唯一的 WXT 启动入口提供挂载目标，避免 app 层假定页面结构。
  app.mount(selector)
}
