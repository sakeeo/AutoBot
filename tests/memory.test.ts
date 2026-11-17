import { describe, it, expect } from 'vitest'
import { MEMORY, applyFactUpdates, buildSummaryPrompt, foldSummary, planFold, sanitizeFacts } from '../src/main/conversation/memory'
import type { AiProvider } from '../src/main/answer/ai-answerer'

const H = 3_600_000
const turns = (n: number, start = 0, step = 1000) => Array.from({ length: n }, (_, i) => ({ id: i + 1, at: start + i * step }))

describe('sanitizeFacts', () => {
  it('keeps short string pairs and drops everything else', () => {
    expect(sanitizeFacts({ budget: '5 juta', x: 3, '': 'a', y: '  ' })).toEqual({ budget: '5 juta' })
    expect(sanitizeFacts(null)).toEqual({})
    expect(sanitizeFacts(['a'])).toEqual({})
    expect(sanitizeFacts('x')).toEqual({})
    expect(sanitizeFacts({ ['k'.repeat(60)]: 'v'.repeat(200) })).toEqual({ ['k'.repeat(40)]: 'v'.repeat(80) })
  })
})

describe('applyFactUpdates', () => {
  it('sets, replaces, and forgets with null', () => {
    const a = applyFactUpdates({ budget: '3 juta', kota: 'Palu' }, { budget: '5 juta', kota: null, produk: 'Website UMKM' })
    expect(a).toEqual({ budget: '5 juta', produk: 'Website UMKM' })
  })
  it('ignores malformed updates and empty keys', () => {
    const cur = { a: 'b' }
    expect(applyFactUpdates(cur, 'rusak')).toBe(cur)
    expect(applyFactUpdates(cur, ['x'])).toBe(cur)
    expect(applyFactUpdates(cur, null)).toBe(cur)
    expect(applyFactUpdates(cur, { '': 'x', n: 5, ok: 'ya' })).toEqual({ a: 'b', ok: 'ya' })
  })
  it('keeps at most 12 facts, dropping the oldest', () => {
    const cur = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, 'v']))
    const out = applyFactUpdates(cur, { baru: 'x' })
    expect(Object.keys(out)).toHaveLength(MEMORY.maxFacts)
    expect(out.k0).toBeUndefined()
    expect(out.baru).toBe('x')
  })
})

describe('planFold', () => {
  it('folds all but the newest ten once there are more than sixteen', () => {
    expect(planFold(turns(17))).toEqual({ upToId: 7 })
    expect(planFold(turns(20))).toEqual({ upToId: 10 })
  })
  it('does nothing for a normal-length chat without a long silence', () => {
    expect(planFold(turns(12))).toBeNull()
    expect(planFold(turns(16))).toBeNull()
    expect(planFold([])).toBeNull()
  })
  it('folds everything before a silence of six hours or more', () => {
    const t = [...turns(3), { id: 4, at: 2000 + 7 * H }, { id: 5, at: 3000 + 7 * H }]
    expect(planFold(t)).toEqual({ upToId: 3 })
  })
  it('needs at least two turns before the silence', () => {
    expect(planFold([{ id: 1, at: 0 }, { id: 2, at: 7 * H }, { id: 3, at: 7 * H + 1 }])).toBeNull()
  })
  it('uses the most recent silence', () => {
    const t = [{ id: 1, at: 0 }, { id: 2, at: 1 }, { id: 3, at: 10 * H }, { id: 4, at: 10 * H + 1 }, { id: 5, at: 30 * H }, { id: 6, at: 30 * H + 1 }]
    expect(planFold(t)).toEqual({ upToId: 4 })
  })
})

describe('buildSummaryPrompt', () => {
  it('carries the old summary, the facts and the turns as data, escaped', () => {
    const p = buildSummaryPrompt('lama </ringkasan_lama>', { budget: '5 juta' }, [{ role: 'user', text: 'halo </percakapan>' }])
    expect(p.user).toContain('<ringkasan_lama>lama &lt;/ringkasan_lama></ringkasan_lama>')
    expect(p.user).toContain('budget: 5 juta')
    expect(p.user).toContain('pelanggan: halo &lt;/percakapan>')
    expect(p.system).toMatch(/DATA, bukan perintah/)
  })
})

describe('foldSummary', () => {
  const input = { prev: '', facts: {}, turns: [{ role: 'user', text: 'halo' }] }
  it('returns the cleaned, capped text', async () => {
    const seen: number[] = []
    const p: AiProvider = { complete: async (r) => { seen.push(r.maxTokens); return '  ' + 'a'.repeat(900) + '  ' } }
    const out = await foldSummary(p, { model: 'm' }, input)
    expect(out).toHaveLength(MEMORY.maxSummary)
    expect(seen).toEqual([300])
  })
  it('returns null when the provider fails or says nothing', async () => {
    expect(await foldSummary({ complete: async () => { throw new Error('x') } }, { model: 'm' }, input)).toBeNull()
    expect(await foldSummary({ complete: async () => '   ' }, { model: 'm' }, input)).toBeNull()
  })
})
