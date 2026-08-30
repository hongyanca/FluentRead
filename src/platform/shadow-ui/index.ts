/**
 * @file src/platform/shadow-ui/index.ts
 *
 * 文件职责：作为 Shadow UI 平台能力的公共入口，集中导出 Vue 挂载器和页面主世界 bridge 安装函数。
 * 主要内容：从 vue.ts 转出 createVueShadowUi 及其类型，并暴露 installShadowAndRouteBridge，避免 feature 直接依赖内部实现文件。 可核对的公开符号包括 聚合导出。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

export {
  createVueShadowUi,
  type VueShadowMount,
  type VueShadowUiOptions,
} from './vue';
export {installShadowAndRouteBridge} from './pageBridge';
