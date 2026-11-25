import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadDocument, LoaderError, SUPPORTED_EXTENSIONS } from '../src/knowledge/loaders'
import { makeDir, writeDocx, writeXlsx } from './helpers/fixtures'

let dir: string
beforeAll(async () => {
  dir = makeDir()
  writeFileSync(join(dir, 'faq.md'), '# FAQ\n\nJam buka 08.00 sampai 17.00.')
  writeFileSync(join(dir, 'harga.csv'), 'produk,harga\nKopi,25000\nTeh,15000\n')
  writeFileSync(join(dir, 'kosong.txt'), '   \n')
  writeFileSync(join(dir, 'rusak.pdf'), 'bukan pdf sungguhan')
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ alamat: 'Jl. Merdeka 1' }))
  writeFileSync(join(dir, 'gambar.png'), 'x')
  await writeDocx(join(dir, 'sample.docx'), ['Garansi satu tahun', 'Servis gratis'])
  await writeXlsx(join(dir, 'sample.xlsx'), [{ produk: 'Kopi', stok: 10 }])
})

describe('loadDocument', () => {
  it('reads markdown text', async () => {
    expect((await loadDocument(join(dir, 'faq.md'))).text).toContain('Jam buka 08.00')
  })
  it('turns csv rows into "kolom: nilai" lines', async () => {
    const { text } = await loadDocument(join(dir, 'harga.csv'))
    expect(text).toContain('produk: Kopi; harga: 25000')
    expect(text).toContain('produk: Teh; harga: 15000')
  })
  it('turns xlsx rows into "kolom: nilai" lines', async () => {
    expect((await loadDocument(join(dir, 'sample.xlsx'))).text).toContain('produk: Kopi; stok: 10')
  })
  it('extracts docx text', async () => {
    expect((await loadDocument(join(dir, 'sample.docx'))).text).toContain('Garansi satu tahun')
  })
  it('reads json as text', async () => {
    expect((await loadDocument(join(dir, 'data.json'))).text).toContain('Jl. Merdeka 1')
  })
  it('rejects empty files with EMPTY', async () => {
    await expect(loadDocument(join(dir, 'kosong.txt'))).rejects.toMatchObject({ code: 'EMPTY' })
  })
  it('rejects a corrupt pdf with PARSE_FAILED', async () => {
    await expect(loadDocument(join(dir, 'rusak.pdf'))).rejects.toMatchObject({ code: 'PARSE_FAILED' })
  })
  it('rejects unsupported extensions with UNSUPPORTED', async () => {
    const err = await loadDocument(join(dir, 'gambar.png')).catch((e) => e)
    expect(err).toBeInstanceOf(LoaderError)
    expect(err.code).toBe('UNSUPPORTED')
  })
  it('exposes the supported extensions', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining(['.md', '.txt', '.pdf', '.docx', '.csv', '.xlsx', '.json'])
    )
  })
})
