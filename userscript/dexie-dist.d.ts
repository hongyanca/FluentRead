/**
 * @file userscript/dexie-dist.d.ts
 * 文件职责：为 dexie 的实现产物 dist/dexie.min.js 补充类型声明，使油猴构建可以绕开会注册全局符号的官方入口。
 * 主要内容：以环境模块声明复用 dexie 自带的默认导出类型。
 * 模块边界：本文件必须保持为全局脚本（不含顶层 import/export），否则 declare module 会退化为模块增强而无法生效；
 * 运行时替换逻辑见 userscript/dexie.ts 与 userscript/vite.config.ts 中的别名。
 */
declare module 'dexie/dist/dexie.min.js' {
    const Dexie: typeof import('dexie')['default'];
    export default Dexie;
}
