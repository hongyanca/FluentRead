/**
 * @file src/features/hover-translation/public.ts
 * 文件职责：作为悬浮翻译 feature 的最小公共入口，向内容脚本组合层暴露可注入、可清理的手势挂载函数。
 * 主要内容：文件仅从 ./content 再导出 mountHoverTranslationContentFeature，使外部不必知道按键状态、屏幕坐标节流和事件监听器的内部实现。
 * 模块边界：该 barrel 不绑定 DOM 事件也不触发翻译；具体监听在 content/index.ts，全文翻译动作和配置/站点能力必须由调用方按依赖接口注入。
 */
export {mountHoverTranslationContentFeature} from './content';
