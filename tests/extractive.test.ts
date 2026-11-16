import { describe, it, expect } from 'vitest'
import { buildExtractiveAnswer } from '../src/main/answer/extractive'
import type { Hit } from '../src/shared/types'

const hit = (text: string, file = 'faq.md'): Hit => ({ chunkId: 1, file, text, coverage: 1, rank: -1 })

describe('buildExtractiveAnswer', () => {
  it('quotes the sentence that matches the query and cites the source', () => {
    const a = buildExtractiveAnswer('harga kopi', [hit('Harga kopi susu Rp25.000. Jam buka 08.00.')])
    expect(a.text).toContain('Rp25.000')
    expect(a.text).toContain('Sumber: faq.md')
    expect(a.sources).toEqual(['faq.md'])
  })
  it('limits the quoted body to 600 characters', () => {
    const long = Array.from({ length: 200 }, () => 'harga kopi sangat murah sekali').join('. ')
    const a = buildExtractiveAnswer('harga kopi', [hit(long)])
    expect(a.text.split('\n\nSumber:')[0].length).toBeLessThanOrEqual(600)
  })
  it('lists each distinct source once', () => {
    const a = buildExtractiveAnswer('harga', [hit('Harga A', 'a.md'), hit('Harga B', 'a.md'), hit('Harga C', 'b.md')])
    expect(a.sources).toEqual(['a.md', 'b.md'])
  })
})
