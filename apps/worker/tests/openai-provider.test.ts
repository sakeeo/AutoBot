import { describe, it, expect, vi, afterEach } from 'vitest'
import { OpenAiCompatProvider } from '../src/answer/openai-provider'
import { makeProvider } from '../src/answer/make-provider'
import { ClaudeProvider, toAiError } from '../src/answer/ai-answerer'
import { resolveBaseUrl, secretNameFor } from '@autobot/contracts/providers'

const req = { system: 's', user: 'u', model: 'deepseek-chat', maxTokens: 50 }
afterEach(() => vi.unstubAllGlobals())

describe('OpenAiCompatProvider', () => {
  it('posts to /chat/completions with bearer auth and returns the message text', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'hai' } }] }) })
    vi.stubGlobal('fetch', f)
    const out = await new OpenAiCompatProvider('KEY', 'https://api.deepseek.com').complete(req)
    expect(out).toBe('hai')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.headers.authorization).toBe('Bearer KEY')
    const body = JSON.parse(init.body)
    expect(body.max_tokens).toBe(50)
    expect(body.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }])
  })
  it('uses max_completion_tokens when configured', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) })
    vi.stubGlobal('fetch', f)
    await new OpenAiCompatProvider('K', 'https://x/v1', 'max_completion_tokens').complete(req)
    expect(JSON.parse(f.mock.calls[0][1].body).max_completion_tokens).toBe(50)
  })
  it('maps HTTP status to AiError codes without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const e = await new OpenAiCompatProvider('SECRET-KEY', 'https://x').complete(req).catch((x) => x)
    expect(toAiError(e).code).toBe('AUTH')
    expect(String(e.message)).not.toContain('SECRET-KEY')
  })
})

describe('provider registry', () => {
  it('builds the right adapter per provider', () => {
    expect(makeProvider({ provider: 'claude' }, 'k')).toBeInstanceOf(ClaudeProvider)
    expect(makeProvider({ provider: 'deepseek' }, 'k')).toBeInstanceOf(OpenAiCompatProvider)
  })
  it('keeps the legacy Claude secret name and separates others', () => {
    expect(secretNameFor('claude')).toBe('anthropic_api_key')
    expect(secretNameFor('deepseek')).toBe('ai_key_deepseek')
  })
  it('uses the custom base URL only for the custom provider', () => {
    expect(resolveBaseUrl('custom', 'http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
    expect(resolveBaseUrl('deepseek', 'http://evil')).toBe('https://api.deepseek.com')
  })
})
