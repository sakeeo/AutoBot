import { describe, it, expect } from 'vitest'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { openDb } from '../src/db'
import { IndexStore } from '../src/knowledge/index-store'
import { Indexer } from '../src/knowledge/indexer'
import { makeDir } from './helpers/fixtures'

function setup(opts: { exclude?: string[] } = {}) {
  const dir = makeDir('wa-idx-')
  const store = new IndexStore(openDb(':memory:'))
  const indexer = new Indexer(store, { root: dir, ...opts })
  return { dir, store, indexer }
}

describe('Indexer', () => {
  it('indexes supported files, flags failures, skips secrets', async () => {
    const { dir, store, indexer } = setup()
    writeFileSync(join(dir, 'a.md'), 'Harga kopi susu Rp25.000')
    writeFileSync(join(dir, 'b.txt'), 'Jam buka 08.00')
    writeFileSync(join(dir, '.env'), 'RAHASIA=supersecretvalue')
    writeFileSync(join(dir, 'kosong.txt'), '  ')
    writeFileSync(join(dir, 'foto.png'), 'x')
    await indexer.start()
    const byName = Object.fromEntries(store.listFiles().map((f) => [basename(f.file), f]))
    expect(byName['a.md'].status).toBe('indexed')
    expect(byName['b.txt'].status).toBe('indexed')
    expect(byName['kosong.txt']).toMatchObject({ status: 'failed', reason: 'EMPTY' })
    expect(byName['.env']).toBeUndefined()
    expect(byName['foto.png']).toBeUndefined()
    expect(store.search('supersecretvalue rahasia', 5)).toEqual([])
  })

  it('creates the folder when it does not exist yet', async () => {
    const { dir, indexer } = setup()
    rmSync(dir, { recursive: true })
    await expect(indexer.start()).resolves.toBeUndefined()
  })

  it('honours exclude patterns and indexes sub-folders', async () => {
    const { dir, store, indexer } = setup({ exclude: ['privat/'] })
    mkdirSync(join(dir, 'privat'))
    mkdirSync(join(dir, '_sheets'))
    writeFileSync(join(dir, 'privat', 'gaji.md'), 'Gaji karyawan rahasia')
    writeFileSync(join(dir, '_sheets', 'faq.txt'), 'Pertanyaan: jam buka')
    writeFileSync(join(dir, 'umum.md'), 'Informasi umum toko')
    await indexer.start()
    expect(store.listFiles().map((f) => basename(f.file)).sort()).toEqual(['faq.txt', 'umum.md'])
  })

  it('does not index a path outside its folder', async () => {
    const { store, indexer } = setup()
    const other = makeDir('wa-other-')
    writeFileSync(join(other, 'luar.md'), 'Di luar folder')
    await indexer.indexFile(join(other, 'luar.md'))
    expect(store.listFiles()).toEqual([])
  })

  it('re-indexes a changed file when told to, and drops a removed one', async () => {
    const { dir, store, indexer } = setup()
    const a = join(dir, 'a.md')
    const b = join(dir, 'b.txt')
    writeFileSync(a, 'Harga kopi susu Rp25.000')
    writeFileSync(b, 'Jam buka 08.00')
    await indexer.start()
    writeFileSync(a, 'Harga kopi susu naik menjadi Rp30.000')
    await indexer.indexFile(a, true)
    expect(store.search('harga kopi', 3)[0].text).toContain('Rp30.000')
    rmSync(b)
    await indexer.removeFile(b)
    expect(store.listFiles().some((f) => f.file.endsWith('b.txt'))).toBe(false)
  })

  it('skips an unchanged file but indexes it again with force', async () => {
    const { dir, store, indexer } = setup()
    const a = join(dir, 'a.md')
    writeFileSync(a, 'Harga kopi susu Rp25.000')
    await indexer.start()
    const seen: string[] = []
    indexer.on('status', (e) => seen.push(e.status))
    await indexer.indexFile(a)
    expect(seen).toEqual([])
    await indexer.indexFile(a, true)
    expect(seen).toEqual(['indexed'])
    expect(store.listFiles()).toHaveLength(1)
  })

  it('calls onDocument with the raw csv/json text and onRemove when the file is removed', async () => {
    const dir = makeDir('wa-idx-')
    const store = new IndexStore(openDb(':memory:'))
    const docs: { file: string; raw: string; ext: string }[] = []
    const removed: string[] = []
    const indexer = new Indexer(store, {
      root: dir,
      onDocument: (file, raw, ext) => docs.push({ file, raw, ext }),
      onRemove: (file) => removed.push(file)
    })
    const csv = 'id,nama,harga\na,Produk A,1000\n'
    writeFileSync(join(dir, 'katalog.csv'), csv)
    writeFileSync(join(dir, 'faq.md'), 'isi dokumen biasa')
    await indexer.start()
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ raw: csv, ext: '.csv' })
    await indexer.removeFile(join(dir, 'katalog.csv'))
    expect(removed).toHaveLength(1)
    expect(removed[0].endsWith('katalog.csv')).toBe(true)
  })

  it('emits status events', async () => {
    const { dir, indexer } = setup()
    writeFileSync(join(dir, 'a.md'), 'isi dokumen')
    const seen: string[] = []
    indexer.on('status', (e) => seen.push(`${basename(e.file)}:${e.status}`))
    await indexer.start()
    expect(seen).toContain('a.md:indexed')
  })
})
