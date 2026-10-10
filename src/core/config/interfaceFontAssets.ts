/**
 * @file src/core/config/interfaceFontAssets.ts
 * 文件职责：声明按需界面字体的固定版本、完整性数据与备用下载入口。
 * 主要内容：按字体方案返回必需文件，计算排除共享资源后的可清除文件，构造国内优化镜像与海外来源链接。
 * 模块边界：仅包含纯数据和 URL 规则，不发起请求，不读取配置或操作 DOM。
 */
import manifest from '../../../assets/interface-fonts/manifest.json'
import type {InterfaceFont} from './interfaceAppearance'

export const INTERFACE_FONT_REVISION = 'dfe4e0cdbb4fad114b5dedaeba9a88e42c95816d'
const resourcePath = `FluentRead/FluentRead@${INTERFACE_FONT_REVISION}/assets/interface-fonts/`
export const interfaceFontSources = [
  {id: 'jsdmirror', label: 'JSDMirror', region: 'china', base: `https://cdn.jsdmirror.com/gh/${resourcePath}`},
  {id: 'onmicrosoft', label: 'onmicrosoft CDN', region: 'china', base: `https://jsd.onmicrosoft.cn/gh/${resourcePath}`},
  {id: 'github', label: 'GitHub Raw', region: 'global', base: `https://raw.githubusercontent.com/FluentRead/FluentRead/${INTERFACE_FONT_REVISION}/assets/interface-fonts/`},
  {id: 'jsdelivr', label: 'jsDelivr', region: 'global', base: `https://cdn.jsdelivr.net/gh/${resourcePath}`},
] as const
export type InterfaceFontSourceId = typeof interfaceFontSources[number]['id']
export interface InterfaceFontAsset {
  file: string
  family: string
  weight: string
  bytes: number
  sha256: string
}
const faces: Record<InterfaceFont, Array<[string, string, string]>> = {
  system: [],
  inter: [['Inter', 'Inter', '100 900']],
  'noto-sans-sc': [['NotoSansSC', 'Noto Sans SC', '100 900']],
  roboto: [['Roboto', 'Roboto', '100 900']],
  'source-sans-3': [['SourceSans3', 'Source Sans 3', '200 900']],
  'ibm-plex-sans': [['IBMPlexSans', 'IBM Plex Sans', '100 700']],
  manrope: [['Manrope', 'Manrope', '200 800']],
  'nunito-sans': [['NunitoSans', 'Nunito Sans', '200 1000']],
  'lxgw-wenkai': [['LXGWWenKaiTC-Regular', 'LXGW WenKai', '400'], ['LXGWWenKaiTC-Bold', 'LXGW WenKai', '700']],
  'noto-serif-sc': [['NotoSerifSC', 'Noto Serif SC', '200 900']],
}

export function getInterfaceFontAssets(font: InterfaceFont): InterfaceFontAsset[] {
  const required = [...faces[font]]
  // Latin families share one cached Chinese fallback. CJK families already cover Chinese.
  if (!['system', 'noto-sans-sc', 'noto-serif-sc', 'lxgw-wenkai'].includes(font)) {
    required.push(...faces['noto-sans-sc'])
  }
  return required.map(([name, family, weight]) => {
    const file = `${name}.woff2`
    const entry = manifest.fonts.find(item => item.asset === file)!
    return {file, family: `FluentRead ${family}`, weight, bytes: entry.bytes, sha256: entry.assetSha256}
  })
}

export function getInterfaceFontUrl(source: InterfaceFontSourceId, file: string): string {
  return `${interfaceFontSources.find(item => item.id === source)!.base}${encodeURIComponent(file)}`
}

/** 清除按钮的容量与实际删除使用相同规则，保留其他已下载字体需要的共享文件。 */
export function getClearableInterfaceFontAssets(font: InterfaceFont, cachedFonts: readonly InterfaceFont[]): InterfaceFontAsset[] {
  const protectedFiles = new Set(cachedFonts
    .filter(value => value !== 'system' && value !== font)
    .flatMap(value => getInterfaceFontAssets(value).map(asset => asset.file)))
  return getInterfaceFontAssets(font).filter(asset => !protectedFiles.has(asset.file))
}
