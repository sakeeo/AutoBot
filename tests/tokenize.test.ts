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
})
