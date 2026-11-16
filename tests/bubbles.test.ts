import { describe, it, expect } from 'vitest'
import { splitBubbles, typingMsFor } from '../src/main/conversation/bubbles'

describe('splitBubbles', () => {
  it('keeps up to three bubbles and merges the rest into the last one', () => {
    expect(splitBubbles(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c d'])
    expect(splitBubbles(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('respects a custom maximum', () => {
    expect(splitBubbles(['a', 'b', 'c'], 2)).toEqual(['a', 'b c'])
  })
  it('drops empty parts', () => {
    expect(splitBubbles(['  ', 'halo', ''])).toEqual(['halo'])
    expect(splitBubbles([])).toEqual([])
  })
  it('strips Markdown that does not render in WhatsApp chat bubbles', () => {
    const [b] = splitBubbles(['**Halo** Kak\n- satu\n* dua\n# Judul\n`kode` __tebal__'])
    expect(b).not.toMatch(/\*\*|__|`/)
    expect(b).not.toMatch(/^[-*#] /m)
    expect(b).toContain('Halo Kak')
    expect(b).toContain('satu')
    expect(b).toContain('Judul')
  })
})

describe('typingMsFor', () => {
  it('is clamped to between 1 and 6 seconds', () => {
    expect(typingMsFor('x'.repeat(10), () => 0)).toBe(1000)
    expect(typingMsFor('x'.repeat(200), () => 1)).toBe(6000)
  })
  it('scales with length at 40-60 ms per character', () => {
    expect(typingMsFor('x'.repeat(50), () => 0.5)).toBe(2500)
    expect(typingMsFor('x'.repeat(50), () => 0)).toBe(2000)
    expect(typingMsFor('x'.repeat(50), () => 1)).toBe(3000)
  })
})
