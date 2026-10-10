/**
 * @file src/features/section-translation/public.ts
 * 文件职责：提供局部翻译 feature 的稳定公共出口，让 content 组合根挂载快捷键入口、让消息运行时从 Popup 进入区域选择模式，而无需了解选择界面与区域判定的内部实现。
 * 主要内容：只再导出 mountSectionTranslationContentFeature 与 startSectionTranslationPicker；选择浮层、区域判定和标签规则留在 content/picker 与 core 内部。
 * 模块边界：该 barrel 不创建监听器、不读取配置，也不发起翻译；所有副作用都发生在调用导出的函数之后。
 */
export {mountSectionTranslationContentFeature, startSectionTranslationPicker} from './content';
