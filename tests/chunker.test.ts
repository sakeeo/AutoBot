import { describe, it, expect } from 'vitest'
import { chunkText } from '../src/main/knowledge/chunker'

const words = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ')

describe('chunkText', () => {
  it('returns [] for empty text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n  ')).toEqual([])
  })
  it('keeps a short text as a single chunk', () => {
    expect(chunkText(words(10))).toHaveLength(1)
  })
  it('splits 1200 words into at least 3 chunks', () => {
    expect(chunkText(words(1200)).length).toBeGreaterThanOrEqual(3)
  })
  it('overlaps consecutive chunks by 80 words', () => {
    const chunks = chunkText(words(1200))
    const a = chunks[0].split(/\s+/)
    const b = chunks[1].split(/\s+/)
    expect(a.slice(-80)).toEqual(b.slice(0, 80))
  })
  it('never returns empty chunks', () => {
    for (const c of chunkText(words(1200))) expect(c.trim().length).toBeGreaterThan(0)
  })
})
