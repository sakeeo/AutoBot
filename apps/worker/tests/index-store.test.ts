import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../src/db'
import { IndexStore } from '../src/knowledge/index-store'

let store: IndexStore
beforeEach(() => {
  store = new IndexStore(openDb(':memory:'))
  store.replaceFile('faq.md', 1, ['Harga kopi susu Rp25.000', 'Jam buka 08.00 sampai 17.00'])
  store.replaceFile('lokasi.md', 1, ['Alamat toko di Jl. Merdeka nomor 1 Bandung'])
})

describe('IndexStore.search', () => {
  it('finds the relevant chunk with full coverage', () => {
    const hits = store.search('berapa harga kopi?', 3)
    expect(hits[0].text).toContain('Harga kopi')
    expect(hits[0].coverage).toBe(1)
    expect(hits[0].file).toBe('faq.md')
  })
  it('matches Indonesian -nya forms', () => {
    expect(store.search('harganya kopi', 3)[0].text).toContain('Harga kopi')
  })
  it('returns nothing useful for off-topic questions', () => {
    const hits = store.search('siapa presiden indonesia', 3)
    expect(hits.length === 0 || hits[0].coverage < 0.5).toBe(true)
  })
  it('does not throw on FTS5 special characters', () => {
    expect(() => store.search('"; DROP TABLE -- NEAR(a b) *', 3)).not.toThrow()
    expect(() => store.search('kopi AND OR NOT "', 3)).not.toThrow()
  })
  it('returns [] when the query has no content tokens', () => {
    expect(store.search('oke', 3)).toEqual([])
  })
})

describe('IndexStore.search typo tolerance', () => {
  beforeEach(() => {
    store.replaceFile('umkm.md', 1, [
      'Cocok untuk usaha laundry, kuliner dan toko. Desain template tersedia, pelanggan cukup kirim logo dan foto dari HP.'
    ])
  })
  it('finds laundry for the misspelling loundry', () => {
    const hits = store.search('Loundry', 3)
    expect(hits[0]?.file).toBe('umkm.md')
    expect(hits[0].coverage).toBe(1)
  })
  it('finds design and photos despite typos, English spelling and foto2', () => {
    const hits = store.search('Bagiamana dwngan design dan foto2nya... ?', 3)
    expect(hits[0]?.file).toBe('umkm.md')
    expect(hits[0].coverage).toBeGreaterThanOrEqual(0.5)
  })
  it('does not fuzzy-match unrelated words', () => {
    const hits = store.search('presiden', 3)
    expect(hits.length === 0 || hits[0].coverage === 0).toBe(true)
  })
  it('does not match short tokens fuzzily', () => {
    expect(store.search('logi', 3).every((h) => h.coverage === 1 || h.coverage === 0)).toBe(true)
  })
  it('sees words from files added later', () => {
    store.replaceFile('baru.md', 2, ['Layanan konsultasi gratis'])
    expect(store.search('konsultsi', 3)[0]?.file).toBe('baru.md')
  })
})

describe('IndexStore file management', () => {
  it('replaceFile does not duplicate chunks', () => {
    store.replaceFile('faq.md', 2, ['Harga kopi susu Rp25.000', 'Jam buka 08.00 sampai 17.00'])
    expect(store.search('harga kopi', 10).filter((h) => h.file === 'faq.md')).toHaveLength(1)
    expect(store.listFiles().find((f) => f.file === 'faq.md')?.chunks).toBe(2)
  })
  it('removeFile deletes chunks and the file entry', () => {
    store.removeFile('faq.md')
    expect(store.search('harga kopi', 5)).toEqual([])
    expect(store.listFiles().map((f) => f.file)).toEqual(['lokasi.md'])
  })
  it('markFailed lists the reason and removes stale chunks', () => {
    store.markFailed('faq.md', 'EMPTY')
    expect(store.search('harga kopi', 5)).toEqual([])
    expect(store.listFiles().find((f) => f.file === 'faq.md')).toMatchObject({ status: 'failed', reason: 'EMPTY', chunks: 0 })
  })
  it('lists indexed files with chunk counts', () => {
    expect(store.listFiles().find((f) => f.file === 'faq.md')).toMatchObject({ status: 'indexed', chunks: 2 })
  })
  it('getMtime returns stored mtime or null', () => {
    expect(store.getMtime('faq.md')).toBe(1)
    expect(store.getMtime('nope.md')).toBeNull()
  })
})
