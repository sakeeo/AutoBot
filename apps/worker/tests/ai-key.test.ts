import { describe, it, expect } from 'vitest'
import { saveApiKey, API_KEY_SECRET } from '../src/ai-key'
import { MemorySecretStore } from '../src/settings'
import type { AiProvider } from '../src/answer/ai-answerer'

const cfg = { model: 'm', maxTokens: 5 }
const ok: AiProvider = { complete: async () => 'pong' }
const status = (n: number): AiProvider => ({
  complete: async () => { throw Object.assign(new Error('x'), { status: n }) }
})

describe('saveApiKey', () => {
  it('stores the key after a successful test call', async () => {
    const secrets = new MemorySecretStore()
    expect(await saveApiKey({ secrets, makeProvider: () => ok, ai: cfg }, 'sk-ant-' + 'a'.repeat(20))).toEqual({ ok: true })
    expect(secrets.get(API_KEY_SECRET)).toBe('sk-ant-' + 'a'.repeat(20))
  })
  it('does not store a key the provider rejects', async () => {
    const secrets = new MemorySecretStore()
    const r = await saveApiKey({ secrets, makeProvider: () => status(401), ai: cfg }, 'sk-ant-' + 'b'.repeat(20))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/key/i)
    expect(secrets.has(API_KEY_SECRET)).toBe(false)
  })
  it('rejects a malformed key without calling the provider', async () => {
    let called = false
    const secrets = new MemorySecretStore()
    const r = await saveApiKey({ secrets, makeProvider: () => ({ complete: async () => { called = true; return '' } }), ai: cfg }, '')
    expect(r.ok).toBe(false)
    expect(called).toBe(false)
  })
  it('never echoes the key in the error message', async () => {
    const key = 'sk-ant-' + 'c'.repeat(20)
    const r = await saveApiKey({ secrets: new MemorySecretStore(), makeProvider: () => status(429), ai: cfg }, key)
    expect(JSON.stringify(r)).not.toContain(key)
  })
})
