import { describe, expect, it } from 'vitest'
import { defaultOption } from '@/src/core/config/catalog'
import {
  isConfigImportValid,
  prepareConfigForExport,
  prepareConfigForImport,
  sanitizeConfigForExport,
} from '@/src/core/config/transfer'
import { Config, normalizeConfig } from '@/src/core/config/model'

const validConfig = {
  on: true,
  service: 'openai',
  display: 1,
  from: 'auto',
  to: 'zh-Hans',
}

describe('configuration transfer helpers', () => {
  it('accepts the minimum import shape and rejects malformed values', () => {
    expect(isConfigImportValid(validConfig)).toBe(true)
    expect(isConfigImportValid({...validConfig, on: false, display: 0, service: 'freeTranslation'})).toBe(true)
    expect(isConfigImportValid({ ...validConfig, service: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, service: 'not-a-real-service' })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, on: null })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, display: {} })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, display: 2 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, from: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, from: '  ' })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: [] })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: '' })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, customBody: { openai: '{}' } })).toBe(true)
    expect(isConfigImportValid({ ...validConfig, customBody: { openai: null } })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: undefined })).toBe(false)
    expect(isConfigImportValid({ service: 'openai' })).toBe(false)
    expect(isConfigImportValid(null)).toBe(false)
    expect(() => prepareConfigForImport({...validConfig, on: null}, validConfig))
      .toThrow('缺少有效的基础字段')
  })

  it('removes default-only fields without mutating the source', () => {
    const source = {
      ...validConfig,
      system_role: {
        openai: defaultOption.system_role,
        deepseek: 'Translate with a concise tone.',
      },
      user_role: {
        openai: defaultOption.user_role,
      },
      customBody: {
        openai: '   ',
        deepseek: '{"thinking":{"type":"disabled"}}',
      },
    }

    const sanitized = sanitizeConfigForExport(source)

    expect(sanitized).toEqual({
      ...validConfig,
      system_role: { deepseek: 'Translate with a concise tone.' },
      customBody: { deepseek: '{"thinking":{"type":"disabled"}}' },
    })
    expect(source.system_role).toHaveProperty('openai')
    expect(source.user_role).toHaveProperty('openai')
    expect(source.customBody).toHaveProperty('openai')
  })

  it('removes empty maps after cleaning their entries', () => {
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      system_role: { openai: defaultOption.system_role },
      user_role: { openai: defaultOption.user_role },
      customBody: { openai: '' },
    })

    expect(sanitized).toEqual(validConfig)
  })

  it('导出时移除所有凭据字段和内部 revision', () => {
    const secret = 'export-secret-sentinel'
    const structuredSecret = 'nested-export-secret-sentinel'
    const customBody = `{"apiToken":"${secret}"}`
    const proxy = `https://user:${secret}@proxy.example`
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      token: {openai: secret},
      ak: secret,
      sk: secret,
      appid: secret,
      key: secret,
      youdaoAppKey: secret,
      youdaoAppSecret: secret,
      tencentSecretId: secret,
      tencentSecretKey: secret,
      extra: {jwt: secret},
      apiToken: secret,
      accountPassword: secret,
      authorizationHeader: `Bearer ${secret}`,
      futureSafeSetting: 'keep-me',
      futureProvider: {
        endpoint: 'https://future.example',
        apiToken: structuredSecret,
        nested: {
          password: structuredSecret,
          region: 'cn',
        },
        candidates: [{token: structuredSecret, name: 'primary'}, 'literal-value'],
      },
      customBody: {openai: customBody},
      proxy: {openai: proxy},
      count: 99,
      persistCredentials: true,
      __fluentConfigRevision: 42,
    })

    expect(JSON.stringify(sanitized)).not.toContain(structuredSecret)
    for (const field of [
      'token', 'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
      'tencentSecretId', 'tencentSecretKey', 'extra', '__fluentConfigRevision',
      'apiToken', 'accountPassword', 'authorizationHeader',
      'count', 'persistCredentials',
    ]) {
      expect(sanitized).not.toHaveProperty(field)
    }
    expect(sanitized.futureSafeSetting).toBe('keep-me')
    expect(sanitized.futureProvider).toEqual({
      endpoint: 'https://future.example',
      nested: {region: 'cn'},
      candidates: [{name: 'primary'}, 'literal-value'],
    })
    expect(sanitized.customBody).toEqual({openai: customBody})
    expect(sanitized.proxy).toEqual({openai: proxy})
  })

  it('用户主动导出时保留全部设置、提示词和专用 API 凭据', () => {
    const source = normalizeConfig({
      ...validConfig,
      token: {openai: 'openai-key', deepseek: 'deepseek-key'},
      ak: 'access-key',
      sk: 'secret-key',
      appid: 'baidu-app-id',
      key: 'baidu-secret-key',
      youdaoAppKey: 'youdao-app-key',
      youdaoAppSecret: 'youdao-app-secret',
      tencentSecretId: 'tencent-secret-id',
      tencentSecretKey: 'tencent-secret-key',
      extra: {providerCredential: 'extra-secret'},
      model: {openai: 'custom-model'},
      customModel: {openai: 'private-deployment'},
      customBody: {openai: '{"reasoning":{"effort":"low"}}'},
      proxy: {openai: 'https://proxy.example/v1'},
      system_role: {openai: 'Custom system prompt'},
      user_role: {openai: 'Custom user prompt: {{text}}'},
      alwaysTranslateDomains: ['example.com'],
      count: 99,
      persistCredentials: true,
      __fluentConfigRevision: 42,
    })

    const exported = prepareConfigForExport(source)

    expect(exported.token).toEqual(source.token)
    expect(exported.ak).toBe(source.ak)
    expect(exported.sk).toBe(source.sk)
    expect(exported.appid).toBe(source.appid)
    expect(exported.key).toBe(source.key)
    expect(exported.youdaoAppKey).toBe(source.youdaoAppKey)
    expect(exported.youdaoAppSecret).toBe(source.youdaoAppSecret)
    expect(exported.tencentSecretId).toBe(source.tencentSecretId)
    expect(exported.tencentSecretKey).toBe(source.tencentSecretKey)
    expect(exported.extra).toEqual(source.extra)
    expect(exported.model).toEqual(source.model)
    expect(exported.customModel).toEqual(source.customModel)
    expect(exported.customBody).toEqual(source.customBody)
    expect(exported.proxy).toEqual(source.proxy)
    expect(exported.system_role).toEqual(source.system_role)
    expect(exported.user_role).toEqual(source.user_role)
    expect(exported.alwaysTranslateDomains).toEqual(['example.com'])
    expect(exported).not.toHaveProperty('persistCredentials')
    expect(exported).not.toHaveProperty('count')
    expect(exported).not.toHaveProperty('__fluentConfigRevision')
  })

  it('完整迁移配置动态覆盖 Config 全字段，并按统一持久化契约往返导入', () => {
    const source = normalizeConfig({
      ...new Config(),
      on: false,
      autoTranslate: true,
      from: 'en',
      to: 'ja',
      service: 'openai',
      documentService: 'openai',
      documentModel: {openai: 'document-model-sentinel'},
      documentCustomModel: {openai: 'document-custom-model-sentinel'},
      videoTranslationEnabled: true,
      videoService: 'openai',
      token: {openai: 'schema-token-sentinel'},
      requireApiKey: {openai: true},
      appid: 'schema-appid-sentinel',
      key: 'schema-key-sentinel',
      model: {openai: 'schema-model-sentinel'},
      customModel: {openai: 'schema-custom-model-sentinel'},
      customBody: {openai: '{"schema":"custom-body-sentinel"}'},
      proxy: {openai: 'https://schema-proxy.invalid/v1'},
      extra: {schema: 'extra-sentinel'},
      system_role: {openai: 'schema-system-role-sentinel'},
      user_role: {openai: 'schema-user-role-sentinel {{text}}'},
      alwaysTranslateDomains: ['schema.example'],
      disabledExtensionDomains: ['disabled.example'],
      theme: 'dark',
      translationCenterServices: ['openai'],
      translationCenterSourceLanguage: 'en',
      translationCenterTargetLanguage: 'ja',
      count: 73,
      persistCredentials: true,
    })
    const exported = prepareConfigForExport(source)
    const expectedExportKeys = Object.keys(source)
      .filter(key => key !== 'count')
      .sort()
    expect(Object.keys(exported).sort()).toEqual(expectedExportKeys)

    const target = normalizeConfig({...new Config(), count: 911, persistCredentials: false})
    const imported = prepareConfigForImport(exported, target)
    for (const key of Object.keys(source) as Array<keyof Config>) {
      if (key === 'count' || key === 'videoServiceDefaultMigrated') continue
      expect(imported[key], `字段 ${key} 未完成完整导出/导入往返`).toEqual(source[key])
    }
    expect(imported.count).toBe(target.count)
    expect(imported).not.toHaveProperty('persistCredentials')
    expect(imported.videoServiceDefaultMigrated).toBe(target.videoServiceDefaultMigrated)
  })

  it('完整用户导出拒绝非对象', () => {
    expect(() => prepareConfigForExport(null)).toThrow('配置必须是 JSON 对象')
  })

  it('导入新版公开配置时保留当前已保存凭据并忽略旧策略字段', () => {
    const currentSecret = 'current-saved-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, to: 'ja', count: 1, persistCredentials: true, videoServiceDefaultMigrated: false},
      {...validConfig, token: {openai: currentSecret}, count: 42, persistCredentials: false, videoServiceDefaultMigrated: true},
    )

    expect(prepared.to).toBe('ja')
    expect(prepared.token.openai).toBe(currentSecret)
    expect(prepared.count).toBe(42)
    expect(prepared).not.toHaveProperty('persistCredentials')
    expect(prepared.videoServiceDefaultMigrated).toBe(true)
  })

  it('导入旧文件时迁移其中凭据，并忽略已废弃的持久化开关', () => {
    const legacySecret = 'legacy-import-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, token: {openai: legacySecret}, extra: {jwt: legacySecret}, persistCredentials: true},
      {
        ...validConfig,
        token: {openai: 'current-secret', deepseek: 'keep-deepseek'},
        sk: 'keep-sk',
        youdaoAppSecret: 'keep-youdao-secret',
        extra: {keep: 'current-extra'},
        persistCredentials: false,
      },
    )

    expect(prepared.token.openai).toBe(legacySecret)
    expect(prepared.token.deepseek).toBe('keep-deepseek')
    expect(prepared.sk).toBe('keep-sk')
    expect(prepared.youdaoAppSecret).toBe('keep-youdao-secret')
    expect(prepared.extra).toEqual({keep: 'current-extra', jwt: legacySecret})
    expect(prepared).not.toHaveProperty('persistCredentials')
  })

  it('旧文件中的无效凭据映射不清空当前映射，只更新合法的显式字段', () => {
    const prepared = prepareConfigForImport(
      {...validConfig, ak: 'legacy-ak', token: null, extra: null},
      {...validConfig, ak: 'current-ak', token: {openai: 'keep-token'}, extra: {keep: true}},
    )

    expect(prepared.ak).toBe('legacy-ak')
    expect(prepared.token.openai).toBe('keep-token')
    expect(prepared.extra).toEqual({keep: true})
  })

  it('导入时递归丢弃未知敏感字段，但保留普通前向兼容字段和原始字符串', () => {
    const customBody = '{"nested":{"password":"body-value"}}'
    const proxy = 'https://user:proxy-password@proxy.example'
    const prepared = prepareConfigForImport(
      {
        ...validConfig,
        apiToken: 'unknown-secret',
        accountPassword: 'hidden',
        futureSafeSetting: 'keep-me',
        futureProvider: {
          apiToken: 'nested-secret',
          endpoint: 'https://future.example',
          nested: {password: 'hidden', label: 'keep-label'},
          candidates: [{token: 'hidden', model: 'keep-model'}],
        },
        customBody: {openai: customBody},
        proxy: {openai: proxy},
      },
      validConfig,
    ) as unknown as Record<string, unknown>

    expect(prepared.apiToken).toBeUndefined()
    expect(prepared.accountPassword).toBeUndefined()
    expect(prepared.futureSafeSetting).toBe('keep-me')
    expect(prepared.futureProvider).toEqual({
      endpoint: 'https://future.example',
      nested: {label: 'keep-label'},
      candidates: [{model: 'keep-model'}],
    })
    expect(prepared.customBody).toEqual({openai: customBody})
    expect(prepared.proxy).toEqual({openai: proxy})
  })

  it('preserves always-translate site rules through export and normalized import', () => {
    const exported = sanitizeConfigForExport({
      ...validConfig,
      alwaysTranslateDomains: ['https://docs.example.com/guide', 'EXAMPLE.COM', 'news.bbc.co.uk'],
      disabledExtensionDomains: ['https://app.example.net/settings', 'EXAMPLE.NET'],
    })

    expect(exported.alwaysTranslateDomains).toEqual([
      'https://docs.example.com/guide',
      'EXAMPLE.COM',
      'news.bbc.co.uk',
    ])
    expect(isConfigImportValid(exported)).toBe(true)
    expect(normalizeConfig(exported).alwaysTranslateDomains).toEqual(['example.com', 'bbc.co.uk'])
    expect(normalizeConfig(exported).disabledExtensionDomains).toEqual(['example.net'])
  })

  it('DeepLX 视频服务可以经过新版导出与导入往返而不触发旧默认迁移', () => {
    const exported = sanitizeConfigForExport(normalizeConfig({
      ...validConfig,
      videoService: 'deeplx',
      videoServiceDefaultMigrated: true,
    }))
    const prepared = prepareConfigForImport(exported, normalizeConfig(validConfig))

    expect(exported.videoServiceDefaultMigrated).toBe(true)
    expect(prepared.videoService).toBe('deeplx')
  })
})
