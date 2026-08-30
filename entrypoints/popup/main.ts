/**
 * @file entrypoints/popup/main.ts
 * 文件职责：启动浏览器工具栏 popup 的 Vue 应用。
 * 主要内容：把 #app 容器交给 mountPopupApp，呈现翻译控制、快捷功能和设置入口。
 * 模块边界：入口不访问标签页或配置存储，popup app 负责组合所需的浏览器与业务端口。
 */
import {mountPopupApp} from '@/src/app/popup';

mountPopupApp('#app');
