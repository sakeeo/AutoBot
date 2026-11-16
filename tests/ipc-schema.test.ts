import { describe, it, expect } from 'vitest'
import { CHANNELS, SettingsPatchSchema, ApiKeySchema, AuthSetupSchema, ChatIdSchema } from '../src/shared/ipc'

describe('SettingsPatchSchema', () => {
  it('accepts a valid partial patch', () => {
    expect(SettingsPatchSchema.safeParse({ threshold: 0.7 }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ theme: 'dark', allowGroups: true }).success).toBe(true)
    expect(
      SettingsPatchSchema.safeParse({ outOfContext: { action: 'escalate', replyText: 'hai' } }).success
    ).toBe(true)
  })
  it('rejects out-of-range or malformed values', () => {
    expect(SettingsPatchSchema.safeParse({ threshold: 2 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ threshold: -0.1 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ mode: 'x' }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ cooldownSec: -1 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ knowledgeFolders: [1] }).success).toBe(false)
  })
  it('rejects unknown properties', () => {
    expect(SettingsPatchSchema.safeParse({ threshold: 0.5, evil: true }).success).toBe(false)
  })
})

describe('ApiKeySchema', () => {
  it('rejects empty and absurdly long keys', () => {
    expect(ApiKeySchema.safeParse('').success).toBe(false)
    expect(ApiKeySchema.safeParse('x'.repeat(1000)).success).toBe(false)
    expect(ApiKeySchema.safeParse('sk-ant-' + 'a'.repeat(30)).success).toBe(true)
  })
})

describe('CHANNELS', () => {
  it('has no channel that returns the api key or session credentials', () => {
    const names = Object.keys(CHANNELS).join(' ').toLowerCase()
    expect(names).not.toContain('getapikey')
    expect(names).not.toContain('creds')
    expect(names).not.toContain('session')
  })
  it('exposes the expected channels', () => {
    for (const c of ['getStatus', 'connect', 'logout', 'getSettings', 'updateSettings', 'pickFolder',
      'listFiles', 'reindex', 'testQuestion', 'saveApiKey', 'hasApiKey', 'deleteApiKey', 'openConsole', 'getLog'])
      expect(CHANNELS).toHaveProperty(c)
  })
})

describe('brand channels', () => {
  it('exposes every brand and conversion channel and still no credential channel', () => {
    for (const c of ['getBrand', 'saveBrandDraft', 'applyBrand', 'listBrandVersions', 'restoreBrandVersion',
      'exportBrand', 'importBrand', 'previewChat', 'listPresets', 'loadPreset', 'evtHandoff'])
      expect(CHANNELS).toHaveProperty(c)
    const names = Object.keys(CHANNELS).join(' ').toLowerCase()
    expect(names).not.toContain('getapikey')
    expect(names).not.toContain('creds')
    expect(names).not.toContain('session')
  })
})

describe('SettingsPatchSchema ai provider', () => {
  const ai = (o: object) => ({ ai: { model: 'm', maxTokens: 100, ...o } })
  it('accepts known providers and rejects unknown ones', () => {
    expect(SettingsPatchSchema.safeParse(ai({ provider: 'deepseek' })).success).toBe(true)
    expect(SettingsPatchSchema.safeParse(ai({ provider: 'nope' })).success).toBe(false)
  })
  it('only accepts http(s) base URLs', () => {
    expect(SettingsPatchSchema.safeParse(ai({ provider: 'custom', baseUrl: 'http://localhost:11434/v1' })).success).toBe(true)
    expect(SettingsPatchSchema.safeParse(ai({ provider: 'custom', baseUrl: 'file:///etc/passwd' })).success).toBe(false)
  })
})

describe('AuthSetupSchema', () => {
  it('requires a username and an 8+ character password and rejects unknown fields', () => {
    expect(AuthSetupSchema.safeParse({ username: 'admin', password: '12345678' }).success).toBe(true)
    expect(AuthSetupSchema.safeParse({ username: 'admin', password: '1234567' }).success).toBe(false)
    expect(AuthSetupSchema.safeParse({ username: '  ', password: '12345678' }).success).toBe(false)
    expect(AuthSetupSchema.safeParse({ username: 'a', password: '12345678', admin: true }).success).toBe(false)
  })
})

describe('ChatIdSchema', () => {
  it('rejects an empty or oversized chat id', () => {
    expect(ChatIdSchema.safeParse('6281@s.whatsapp.net').success).toBe(true)
    expect(ChatIdSchema.safeParse('').success).toBe(false)
    expect(ChatIdSchema.safeParse('x'.repeat(201)).success).toBe(false)
    expect(ChatIdSchema.safeParse(42).success).toBe(false)
  })
})

