/**
 * @file userscript/dexie.ts
 * 文件职责：为油猴脚本提供不注册全局符号的 Dexie 入口，避免与宿主页面或其他脚本携带的 Dexie 副本互相判定为版本冲突。
 * 主要内容：直接引入 dexie 的实现产物 dist/dexie.min.js，跳过官方 import-wrapper 对 globalThis[Symbol.for('Dexie')] 的注册与 semVer 校验。
 * 模块边界：本文件只改写模块入口，不修改 Dexie 行为、不读写存储、不访问脚本管理器 API；扩展构建仍走 dexie 官方入口，此替换只在 userscript/vite.config.ts 的别名中生效。
 *
 * 背景（issue #524）：dexie 的 ESM 入口会把自身挂到跨 realm 共享的 globalThis[Symbol.for('Dexie')]，
 * 并在版本不一致时于模块求值阶段直接抛错。扩展内容脚本运行在独立 world，不受影响；而 Safari
 * Userscripts 等脚本管理器把脚本注入页面主 world，只要宿主页面或另一个脚本已注册了别的 Dexie
 * 版本，整个 bundle 就会在入口处中断，表现为脚本完全没有反应。
 *
 * 这里只导出默认构造函数：共享核心目前仅使用 `import Dexie, {type Table} from 'dexie'`，Table 是纯类型。
 * 若将来有模块引入 dexie 的运行时具名导出，打包会在此处报缺失导出而直接失败，便于及时补齐。
 */
import DexieImplementation from 'dexie/dist/dexie.min.js';

/** 与 dexie/import-wrapper-prod.mjs 引入同一份实现产物，仅去掉全局注册与 semVer 校验。 */
const Dexie = DexieImplementation as unknown as typeof import('dexie')['default'];

export {Dexie};
export default Dexie;
