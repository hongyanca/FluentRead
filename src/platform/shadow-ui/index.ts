/**
 * @file src/platform/shadow-ui/index.ts
 *
 * 文件职责：作为 Shadow UI 平台能力的公共入口，集中导出 feature 在隔离 Shadow DOM 中挂载 Vue 组件的能力。
 * 主要内容：从 vue.ts 转出 feature 挂载所用的 createVueShadowUi，避免 feature 直接依赖内部实现文件；页面主世界 bridge 由 pageBridge 模块单独提供。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

export {
    createVueShadowUi,
    type VueShadowMount,
} from './vue';
