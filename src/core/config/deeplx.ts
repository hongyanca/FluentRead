/**
 * @file src/core/config/deeplx.ts
 *
 * 文件职责：维护 DeepLX 端点预设及多端点解析规则，为请求适配器提供确定、有序且可替换令牌的候选地址。
 * 主要内容：声明 DEFAULT_DEEPLX_ENDPOINT 与预设列表，解析换行或逗号分隔的自定义地址，并在 getDeepLXEndpoints 中合并配置 URL、代理和 token 占位符。 可核对的公开符号包括 DEFAULT_DEEPLX_ENDPOINT、DEEPLX_ENDPOINT_PRESETS、parseDeepLXEndpoints、getDeepLXEndpoints。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

/**
 * 公共 endpoint 是非官方 DeepLX 部署，因此保持显式配置，方便用户随时替换为
 * 本地或自行托管的 endpoint。
 */
export const DEFAULT_DEEPLX_ENDPOINT = "https://deeplx.1stg.me/translate"

export const DEEPLX_ENDPOINT_PRESETS = [
  {
    label: "1stG 公共站点（免 Key，已验证）",
    url: DEFAULT_DEEPLX_ENDPOINT,
  },
  {
    label: "Fanyimao 公共站点（需站点 Token，已验证）",
    url: "https://freeapi.fanyimao.cn/translate?token={{apiKey}}",
  },
  {
    label: "DeepLX 社区站点（需个人 Token）",
    url: "https://api.deeplx.org/{{apiKey}}/translate",
  },
  {
    label: "本地 DeepLX（需自行运行）",
    url: "http://localhost:1188/translate",
  },
] as const

const DEEPLX_TOKEN_PLACEHOLDER = /\{\{(?:apiKey|token)\}\}/g

const DEEPLX_ENDPOINT_SEPARATOR = /[\n,]+/

export function parseDeepLXEndpoints(value: unknown): string[] {
  if (typeof value !== "string") {
    return []
  }

  return [...new Set(value.split(DEEPLX_ENDPOINT_SEPARATOR).map((endpoint) => endpoint.trim()).filter(Boolean))]
}

function resolveDeepLXEndpoint(endpoint: string, token: string): string | null {
  if (DEEPLX_TOKEN_PLACEHOLDER.test(endpoint) && !token) {
    DEEPLX_TOKEN_PLACEHOLDER.lastIndex = 0
    return null
  }

  DEEPLX_TOKEN_PLACEHOLDER.lastIndex = 0
  return endpoint.replace(DEEPLX_TOKEN_PLACEHOLDER, encodeURIComponent(token))
}

export function getDeepLXEndpoints(configuredURL: unknown, proxyURL: unknown, token = ""): string[] {
  const proxyEndpoints = parseDeepLXEndpoints(proxyURL)
  if (proxyEndpoints.length > 0) {
    const resolvedProxyEndpoints = proxyEndpoints.map((endpoint) => resolveDeepLXEndpoint(endpoint, token)).filter((endpoint): endpoint is string => endpoint !== null)
    return resolvedProxyEndpoints.length > 0 ? resolvedProxyEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
  }

  const configuredEndpoints = parseDeepLXEndpoints(configuredURL)
  const endpoints = configuredEndpoints.length > 0 ? configuredEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
  const resolvedEndpoints = endpoints.map((endpoint) => resolveDeepLXEndpoint(endpoint, token)).filter((endpoint): endpoint is string => endpoint !== null)
  return resolvedEndpoints.length > 0 ? resolvedEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
}
