/**
 * @file src/features/area-translation/content/contextMenuBridge.ts
 * 文件职责：为“右键截图翻译屏幕区域”提供内容脚本内的单向调用桥，让后台消息不必持有圈选覆盖层的组件实例。
 * 主要内容：保存当前入口注册的处理函数，提供注销句柄，并将按需挂载的异步结果返回调用方。
 * 模块边界：这里只保管一个函数引用，不绘制选区、不截图、不调用 OCR；圈选交互归 AreaTranslator.vue，消息分发归 app/content。
 */

/** 返回 true 表示已经进入圈选状态，等待用户拖拽选区。 */
export type AreaContextMenuHandler = () => boolean | Promise<boolean>;

let activeHandler: AreaContextMenuHandler | null = null;

/** 无 DOM 入口注册时保存处理函数；返回的注销句柄只会清除自己注册的那一个。 */
export function setAreaContextMenuHandler(handler: AreaContextMenuHandler): () => void {
    activeHandler = handler;
    return () => {
        if (activeHandler === handler) activeHandler = null;
    };
}

export function startAreaTranslationFromContextMenu(): boolean | Promise<boolean> {
    return activeHandler?.() ?? false;
}
