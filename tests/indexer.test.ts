import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDb } from '../src/main/db'
import { IndexStore } from '../src/main/knowledge/index-store'
import { Indexer } from '../src/main/knowledge/indexer'
import { makeDir } from './helpers/fixtures'

let indexer: Indexer | null = null
afterEach(async () => {
  await indexer?.stop()
  indexer = null
})

async function waitFor(fn: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor timed out')
}

function setup() {
  const dir = makeDir('wa-idx-')
  const store = new IndexStore(openDb(':memory:'))
  indexer = new Indexer(store, { debounceMs: 100 })
  return { dir, store }
}

describe('Indexer', () => {
  it('indexes supported files, flags failures, skips secrets', async () => {
    const { dir, store } = setup()
    writeFileSync(join(dir, 'a.md'), 'Harga kopi susu Rp25.000')
    writeFileSync(join(dir, 'b.txt'), 'Jam buka 08.00')
    writeFileSync(join(dir, '.env'), 'RAHASIA=supersecretvalue')
    writeFileSync(join(dir, 'kosong.txt'), '  ')
    writeFileSync(join(dir, 'foto.png'), 'x')
    await indexer!.start([dir], [])
    const files = store.listFiles()
    const byName = Object.fromEntries(files.map((f) => [f.file.split('/').pop(), f]))
    expect(byName['a.md'].status).toBe('indexed')
    expect(byName['b.txt'].status).toBe('indexed')
    expect(byName['kosong.txt']).toMatchObject({ status: 'failed', reason: 'EMPTY' })
    expect(byName['.env']).toBeUndefined()
    expect(byName['foto.png']).toBeUndefined()
    expect(store.search('supersecretvalue rahasia', 5)).toEqual([])
  })

  it('honours exclude patterns', async () => {
    const { dir, store } = setup()
    mkdirSync(join(dir, 'privat'))
    writeFileSync(join(dir, 'privat', 'gaji.md'), 'Gaji karyawan rahasia')
    writeFileSync(join(dir, 'umum.md'), 'Informasi umum toko')
    await indexer!.start([dir], ['privat/'])
    expect(store.listFiles().map((f) => f.file.split('/').pop())).toEqual(['umum.md'])
  })

  it('re-indexes a changed file and drops a deleted one', async () => {
    const { dir, store } = setup()
    const a = join(dir, 'a.md')
    const b = join(dir, 'b.txt')
    writeFileSync(a, 'Harga kopi susu Rp25.000')
    writeFileSync(b, 'Jam buka 08.00')
    await indexer!.start([dir], [])
    writeFileSync(a, 'Harga kopi susu naik menjadi Rp30.000')
    await waitFor(() => store.search('harga kopi', 3)[0]?.text.includes('Rp30.000') ?? false)
    rmSync(b)
    await waitFor(() => !store.listFiles().some((f) => f.file.endsWith('b.txt')))
  })

  it('indexes a file added after start', async () => {
    const { dir, store } = setup()
    await indexer!.start([dir], [])
    writeFileSync(join(dir, 'baru.md'), 'Promo diskon akhir tahun')
    await waitFor(() => store.search('promo diskon', 3).length > 0)
  })

  it('emits status events', async () => {
    const { dir } = setup()
    writeFileSync(join(dir, 'a.md'), 'isi dokumen')
    const seen: string[] = []
    indexer!.on('status', (e) => seen.push(`${e.file.split('/').pop()}:${e.status}`))
    await indexer!.start([dir], [])
    expect(seen).toContain('a.md:indexed')
  })
})
