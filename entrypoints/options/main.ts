/**
 * @file entrypoints/options/main.ts
 * 文件职责：启动 FluentRead 设置页的 Vue 应用。
 * 主要内容：把 #app 容器交给 mountOptionsApp，加载设置导航、服务配置和数据管理界面。
 * 模块边界：入口不读取或保存用户配置，页面状态与持久化由 options app 和 settings feature 管理。
 */
import { mountOptionsApp } from '@/src/app/options'

mountOptionsApp('#app')
