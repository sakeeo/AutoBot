import { describe, it, expect } from 'vitest'
import { askAi, buildPrompt, AiError, type AiProvider } from '../src/answer/ai-answerer'
import type { Hit } from '@autobot/contracts/types'

const hits: Hit[] = [
  { chunkId: 1, file: 'faq.md', text: 'Harga kopi susu Rp25.000', coverage: 1, rank: -1 }
]
const cfg = { model: 'm', maxTokens: 100 }
const fake = (out: string | Error): AiProvider => ({
  complete: async () => {
    if (out instanceof Error) throw out
    return out
  }
})

describe('askAi', () => {
  it('returns the answer for valid JSON with known sources', async () => {
    const r = await askAi(
      fake('{"answerable":true,"answer":"Rp25.000","sources":["faq.md"]}'),
      'harga kopi?',
      hits,
      cfg
    )
    expect(r).toEqual({ text: 'Rp25.000', sources: ['faq.md'] })
  })
  it('tolerates a markdown code fence around the JSON', async () => {
    const r = await askAi(
      fake('```json\n{"answerable":true,"answer":"ok","sources":["faq.md"]}\n```'),
      'q',
      hits,
      cfg
    )
    expect(r?.text).toBe('ok')
  })
  it('returns null when answerable is false', async () => {
    expect(await askAi(fake('{"answerable":false,"answer":"","sources":[]}'), 'q', hits, cfg)).toBeNull()
  })
  it('returns null for non-JSON output', async () => {
    expect(await askAi(fake('Tentu, harganya 25 ribu'), 'q', hits, cfg)).toBeNull()
  })
  it('returns null when sources are empty', async () => {
    expect(await askAi(fake('{"answerable":true,"answer":"x","sources":[]}'), 'q', hits, cfg)).toBeNull()
  })
  it('returns null when a cited source was not in the retrieved hits', async () => {
    expect(
      await askAi(fake('{"answerable":true,"answer":"x","sources":["rahasia.md"]}'), 'q', hits, cfg)
    ).toBeNull()
  })
  it('maps a 401 from the provider to AiError AUTH', async () => {
    const err: any = new Error('unauthorized')
    err.status = 401
    await expect(askAi(fake(err), 'q', hits, cfg)).rejects.toMatchObject({ code: 'AUTH' })
    await expect(askAi(fake(err), 'q', hits, cfg)).rejects.toBeInstanceOf(AiError)
  })
  it('maps a provider that never answers to AiError TIMEOUT', async () => {
    const hang: AiProvider = { complete: () => new Promise(() => undefined) }
    await expect(askAi(hang, 'q', hits, cfg, 30)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
  it('maps 429 to RATE_LIMIT', async () => {
    const err: any = new Error('slow down')
    err.status = 429
    await expect(askAi(fake(err), 'q', hits, cfg)).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })
})

describe('buildPrompt', () => {
  it('wraps the message in <pesan> and forbids general knowledge', () => {
    const p = buildPrompt('harga kopi?', hits)
    expect(p.user).toContain('<pesan>harga kopi?</pesan>')
    expect(p.user).toContain('Harga kopi susu Rp25.000')
    expect(p.system).toContain('pengetahuan umum')
  })
})
