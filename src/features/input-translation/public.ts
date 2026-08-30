/**
 * @file src/features/input-translation/public.ts
 * 文件职责：定义输入框翻译 feature 面向 content composition root 的最小公共 API，只暴露 feature 工厂和用于判断配置变化的稳定序列化键。
 * 主要内容：文件从 ./content 再导出 createInputTranslationContentFeature 与 inputBoxTranslationConfigKey，隐藏触发算法、tooltip DOM 和后台消息实现。
 * 模块边界：公共出口本身无副作用；应用层负责注入 ContentScriptContext、配置、消息与 Shadow UI，其他 feature 不应直接操作输入框翻译内部请求状态。
 */
export {
    createInputTranslationContentFeature,
    inputBoxTranslationConfigKey,
} from './content';
