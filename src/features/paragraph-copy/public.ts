/**
 * @file src/features/paragraph-copy/public.ts
 * 文件职责：提供段落复制功能的稳定公共出口，让 content composition root 无需了解手势实现与取词细节即可挂载该能力。
 * 主要内容：只再导出 content 组合根挂载所需的 mountParagraphCopyContentFeature；段落取词与文本组合纯函数留在 core 内部。
 * 模块边界：该 barrel 不创建监听器、不读取配置，也不写入剪贴板；所有副作用都发生在调用导出的挂载函数之后。
 */
export {mountParagraphCopyContentFeature} from './content';
