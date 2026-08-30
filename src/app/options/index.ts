/**
 * @file src/app/options/index.ts
 * 文件职责：创建 Options Vue 应用并集中注册页面所需的 Element Plus 组件、图标与样式，向 WXT 入口暴露稳定挂载函数。
 * 主要内容：维护显式组件和图标清单，载入 Element Plus、settings-page 及共享 token 样式，createApp(OptionsApp) 后逐项注册并挂载到给定 selector。
 * 模块边界：此文件只做 UI 依赖装配，不实现导航、设置保存或业务组件；OptionsApp 管理页面状态，各 feature 负责配置和词汇逻辑，WXT 入口决定启动时机。
 */
import { createApp, type Component } from 'vue'
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElCol,
  ElDialog,
  ElDivider,
  ElEmpty,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElOptionGroup,
  ElRow,
  ElSelect,
  ElSwitch,
  ElText,
  ElTooltip,
} from 'element-plus'
import {
  CircleCheckFilled,
  Coffee,
  Download,
  Edit,
  InfoFilled,
  Loading,
  Refresh,
  Setting,
  Star,
  Upload,
  Warning,
  WarningFilled,
} from '@element-plus/icons-vue'
import OptionsApp from './OptionsApp.vue'
import 'element-plus/dist/index.css'
import '@/src/features/settings/ui/settings-page.css'

const ELEMENT_COMPONENTS: Component[] = [
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElCol,
  ElDialog,
  ElDivider,
  ElEmpty,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElOptionGroup,
  ElRow,
  ElSelect,
  ElSwitch,
  ElText,
  ElTooltip,
]

const ELEMENT_ICONS: Record<string, Component> = {
  CircleCheckFilled,
  Coffee,
  Download,
  Edit,
  InfoFilled,
  Loading,
  Refresh,
  Setting,
  Star,
  Upload,
  Warning,
  WarningFilled,
}

/** options 的唯一组装入口：注册页面依赖后挂载 Vue 根组件。 */
export function mountOptionsApp(selector: string): void {
  const app = createApp(OptionsApp)

  for (const component of ELEMENT_COMPONENTS) {
    if (component.name) app.component(component.name, component)
  }
  for (const [name, component] of Object.entries(ELEMENT_ICONS)) {
    app.component(name, component)
  }

  app.mount(selector)
}
