import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/main/answer/tokenize'

describe('tokenize', () => {
  it('drops stopwords and punctuation', () => {
    expect(tokenize('Berapa harga kopi?')).toEqual(['harga', 'kopi'])
  })
  it('lowercases and deduplicates', () => {
    expect(tokenize('Kopi KOPI kopi')).toEqual(['kopi'])
  })
  it('strips the Indonesian clitic -nya', () => {
    expect(tokenize('harganya')).toEqual(['harga'])
  })
  it('drops one-character tokens', () => {
    expect(tokenize('a b kopi')).toEqual(['kopi'])
  })
  it('returns [] for chatter and emoji', () => {
    expect(tokenize('oke 👍')).toEqual([])
    expect(tokenize('')).toEqual([])
  })
  it('keeps digits', () => {
    expect(tokenize('promo 2024')).toEqual(['promo', '2024'])
  })
  it('reads digit reduplication as the word (foto2 -> foto)', () => {
    expect(tokenize('foto2nya')).toEqual(['foto'])
    expect(tokenize('foto2')).toEqual(['foto'])
  })
  it('maps common English spellings to Indonesian (design -> desain)', () => {
    expect(tokenize('design')).toEqual(['desain'])
  })
})
