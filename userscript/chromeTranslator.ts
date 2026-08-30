export default async function unsupportedChromeTranslator(): Promise<never> {
    throw new Error('Chrome 内置翻译依赖浏览器扩展权限，userscript 版本不支持');
}
