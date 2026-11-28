import { describe, it, expect } from 'vitest'
import {
  containsNumber, removeSelfNumber, extractUrls, stripDisallowedUrls, unknownNumbers, sanitizeChunk,
  removeCtaSentences
} from '../src/policy/guards'

const BOT = '6281200009999'

describe('containsNumber', () => {
  it('matches the number in every common format', () => {
    for (const t of [
      'hubungi 0812-0000-9999 ya', 'wa +62 812 0000 9999', 'chat 6281200009999', 'https://wa.me/6281200009999'
    ]) expect(containsNumber(t, BOT), t).toBe(true)
  })
  it('does not match other numbers or prices', () => {
    expect(containsNumber('hubungi 0812-3456-7890', BOT)).toBe(false)
    expect(containsNumber('harga Rp1.500.000 per tahun', BOT)).toBe(false)
  })
})

describe('removeSelfNumber', () => {
  it('removes the whole sentence that carries the number', () => {
    const r = removeSelfNumber('Boleh. Hubungi WhatsApp 0812-0000-9999 ya. Terima kasih', BOT)
    expect(r).toEqual({ text: 'Boleh. Terima kasih', removed: true })
  })
  it('leaves clean text untouched', () => {
    expect(removeSelfNumber('Harga Rp1,5 juta.', BOT)).toEqual({ text: 'Harga Rp1,5 juta.', removed: false })
  })
})

describe('urls', () => {
  const allowed = ['https://toko.example/checkout/a']
  it('extracts urls without trailing punctuation', () => {
    expect(extractUrls('klik https://toko.example/x, lalu http://a.test/y.')).toEqual([
      'https://toko.example/x', 'http://a.test/y'
    ])
  })
  it('keeps allowlisted urls (query strings allowed) and removes the rest', () => {
    const r = stripDisallowedUrls(
      'Pesan di sini https://toko.example/checkout/a?utm_source=wa_bot. Atau bayar ke http://evil.test/pay ya.',
      allowed
    )
    expect(r.text).toContain('https://toko.example/checkout/a?utm_source=wa_bot')
    expect(r.text).not.toContain('evil.test')
    expect(r.removed).toEqual(['http://evil.test/pay'])
  })
  it('rejects look-alike hosts and plain http', () => {
    const r = stripDisallowedUrls(
      'a https://toko.example.evil.test/checkout/a b. http://toko.example/checkout/a c.', allowed
    )
    expect(r.removed).toHaveLength(2)
  })
  it('drops the sentence when no url survives', () => {
    expect(stripDisallowedUrls('Halo. Buka http://evil.test sekarang.', allowed).text).toBe('Halo.')
  })
})

describe('unknownNumbers', () => {
  it('flags a price that is not in the context', () => {
    expect(unknownNumbers('Harganya Rp2.000.000', 'Harga Rp1.500.000')).toEqual(['2000000'])
  })
  it('accepts the same price written differently', () => {
    expect(unknownNumbers('Rp1,5 juta per tahun', 'Harga Rp1.500.000 per tahun')).toEqual([])
    expect(unknownNumbers('Rp25rb', 'produk: Kopi; harga: 25000')).toEqual([])
  })
  it('ignores small numbers, years and hours', () => {
    expect(unknownNumbers('Tersedia 3 paket, buka jam 09.00 sampai 17.00 tahun 2026', 'Harga Rp1.500.000')).toEqual([])
  })
})

describe('removeCtaSentences', () => {
  it('drops sentences that send the customer to contact us elsewhere', () => {
    for (const s of [
      'Silakan hubungi kami lewat WhatsApp ya.',
      'Konsultasi gratis via WhatsApp.',
      'Chat kami melalui WhatsApp untuk estimasi.',
      'Klik tombol Pesan untuk memesan.',
      'Isi formulir di halaman ini.',
      'Simpan nomor WhatsApp kami.'
    ]) {
      const r = removeCtaSentences(`Harga Rp1,5 juta. ${s} Terima kasih.`)
      expect(r.removed, s).toBe(true)
      expect(r.text, s).toBe('Harga Rp1,5 juta. Terima kasih.')
    }
  })
  it('keeps normal sentences, including ones that mention WhatsApp as a feature or say the team will contact them', () => {
    for (const s of [
      'Kami menyediakan integrasi WhatsApp dan email.',
      'Admin kami akan menghubungi Kakak ya.',
      'Tim akan menghubungi lewat WhatsApp ini.',
      'Harga Rp1,5 juta per tahun.'
    ]) expect(removeCtaSentences(s), s).toEqual({ text: s, removed: false })
  })
})

describe('sanitizeChunk', () => {
  it('drops lines with the bot number and website call-to-actions, keeps facts', () => {
    const out = sanitizeChunk(
      'Harga Rp1.500.000 per tahun\nTanya lewat WhatsApp 0812-0000-9999\nKlik tombol Pesan\nIsi formulir di halaman ini',
      BOT
    )
    expect(out).toBe('Harga Rp1.500.000 per tahun')
  })
  it('drops "hanya untuk manusia" blocks until the next heading', () => {
    const out = sanitizeChunk('# A\nfakta satu\n<!-- hanya untuk manusia -->\nWA 0851\nbaris rahasia\n# B\nfakta dua', null)
    expect(out).toContain('fakta satu')
    expect(out).toContain('fakta dua')
    expect(out).not.toContain('baris rahasia')
    expect(out).not.toContain('manusia')
  })
  it('keeps everything when there is nothing to remove', () => {
    expect(sanitizeChunk('Jam buka 09.00 sampai 17.00', BOT)).toBe('Jam buka 09.00 sampai 17.00')
  })
})
