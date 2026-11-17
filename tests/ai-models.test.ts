import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveApiKey, listModels, API_KEY_SECRET } from '../src/main/ai-key'
import { chatModelIds } from '../src/main/answer/model-list'
import { OpenAiCompatProvider } from '../src/main/answer/openai-provider'
import { MemorySecretStore } from '../src/main/settings'
import type { AiProvider } from '../src/main/answer/ai-answerer'

afterEach(() => vi.unstubAllGlobals())
const KEY = 'sk-' + 'a'.repeat(24)
const status = (n: number) => Object.assign(new Error('x'), { status: n })

describe('chatModelIds', () => {
  it('drops non-chat models, strips the Gemini prefix, removes duplicates and sorts', () => {
    expect(chatModelIds(['models/gemini-2.0-flash', 'text-embedding-3-small', 'whisper-large-v3', 'gpt-4o', 'gpt-4o', 'dall-e-3', 'a-model']))
      .toEqual(['a-model', 'gemini-2.0-flash', 'gpt-4o'])
  })
})

describe('connect (saveApiKey) lists models instead of testing a model', () => {
  const cfg = { model: '', maxTokens: 5 }
  it('stores the key and returns the models, without needing a model name', async () => {
    const secrets = new MemorySecretStore()
    const complete = vi.fn()
    const p: AiProvider = { complete, listModels: async () => ['m1', 'm2'] }
    expect(await saveApiKey({ secrets, makeProvider: () => p, ai: cfg }, KEY)).toEqual({ ok: true, models: ['m1', 'm2'] })
    expect(secrets.get(API_KEY_SECRET)).toBe(KEY)
    expect(complete).not.toHaveBeenCalled()
  })
  it('does not store a key the provider rejects, and does not fall back to a test call', async () => {
    const secrets = new MemorySecretStore()
    const complete = vi.fn()
    const p: AiProvider = { complete, listModels: async () => { throw status(401) } }
    const r = await saveApiKey({ secrets, makeProvider: () => p, ai: { model: 'm', maxTokens: 5 } }, KEY)
    expect(r.ok).toBe(false)
    expect(secrets.has(API_KEY_SECRET)).toBe(false)
    expect(complete).not.toHaveBeenCalled()
  })
  it('falls back to a test call when the endpoint cannot list models, and asks for a name if there is none', async () => {
    const p: AiProvider = { complete: async () => 'pong', listModels: async () => { throw status(404) } }
    const secrets = new MemorySecretStore()
    expect(await saveApiKey({ secrets, makeProvider: () => p, ai: { model: 'local', maxTokens: 5 } }, KEY)).toEqual({ ok: true })
    expect(secrets.has(API_KEY_SECRET)).toBe(true)
    const none = new MemorySecretStore()
    const r = await saveApiKey({ secrets: none, makeProvider: () => p, ai: cfg }, KEY)
    expect(r.ok).toBe(false)
    expect(none.has(API_KEY_SECRET)).toBe(false)
  })
})

describe('listModels', () => {
  it('maps failures to a readable message and says so when the provider cannot list', async () => {
    expect(await listModels({ complete: async () => '', listModels: async () => { throw status(429) } })).toMatchObject({ ok: false, error: expect.stringMatching(/membatasi/i) })
    expect(await listModels({ complete: async () => '' })).toMatchObject({ ok: false })
  })
})

describe('OpenAiCompatProvider.listModels', () => {
  it('reads /models with the bearer key and filters the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'deepseek-chat' }, { id: 'text-embedding-x' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await new OpenAiCompatProvider(KEY, 'https://api.example.com/v1').listModels()).toEqual(['deepseek-chat'])
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/models')
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(`Bearer ${KEY}`)
  })
  it('throws with the HTTP status so it can be mapped', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(new OpenAiCompatProvider(KEY, 'https://x/v1').listModels()).rejects.toMatchObject({ status: 401 })
  })
})
