/**
 * @file src/app/popup/PopupDrawer.ts
 * 文件职责：提供 Popup 快捷抽屉的按需加载边界。
 * 主要内容：首次打开时一起加载 Element Plus 抽屉与配套样式，避免进入首屏解析链。
 * 模块边界：只导出受控抽屉组件；抽屉状态、内容和持久化仍由 PopupApp 管理。
 */
import {ElDrawer} from 'element-plus/es/components/drawer/index';
import 'element-plus/es/components/drawer/style/css';

export default ElDrawer;
