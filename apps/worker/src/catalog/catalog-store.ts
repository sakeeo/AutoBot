import { csvToObjects } from '../knowledge/tabular'
import type { Db } from '../db'
import type { BrandProfile } from '@autobot/contracts/brand'
import { normalizeTokens, tokenize } from '../answer/tokenize'
import { parseRupiah } from '../policy/guards'

export interface Product {
  id: string
  name: string
  price: number | null
  description: string
  checkoutUrl: string | null
  suitableFor: string
  stock: string
}

type Row = Record<string, unknown>

const pick = (row: Row, ...keys: string[]): string => {
  for (const k of keys) {
    const hit = Object.keys(row).find((x) => x.trim().toLowerCase() === k)
    if (hit !== undefined && row[hit] != null) return String(row[hit]).trim()
  }
  return ''
}

/** Parses katalog.csv / katalog.json into products; invalid rows are reported, never thrown. */
export function parseCatalog(text: string, ext: '.csv' | '.json'): { products: Product[]; errors: string[] } {
  const errors: string[] = []
  let rows: Row[]
  try {
    if (ext === '.json') {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('JSON katalog harus berupa array.')
      rows = parsed as Row[]
    } else {
      rows = csvToObjects(text)
    }
  } catch (e) {
    return { products: [], errors: [`Katalog tidak bisa dibaca: ${(e as Error).message}`] }
  }

  const products: Product[] = []
  rows.forEach((row, i) => {
    const line = i + 2 // header is line 1
    const id = pick(row, 'id')
    const name = pick(row, 'nama', 'name')
    if (!id || !name) {
      errors.push(`Baris ${line}: id dan nama wajib diisi.`)
      return
    }
    const rawPrice = row['harga'] ?? row['price'] ?? ''
    const price = typeof rawPrice === 'number' ? rawPrice : parseRupiah(String(rawPrice))
    let checkoutUrl: string | null = pick(row, 'checkout_url', 'checkouturl') || null
    if (checkoutUrl && !/^https:\/\/[^\s/]+/i.test(checkoutUrl)) {
      errors.push(`Baris ${line}: checkout_url harus diawali https:// (${id}).`)
      checkoutUrl = null
    }
    products.push({
      id,
      name,
      price,
      description: pick(row, 'deskripsi_singkat', 'deskripsi', 'description'),
      checkoutUrl,
      suitableFor: pick(row, 'cocok_untuk', 'suitablefor'),
      stock: pick(row, 'stok', 'stock')
    })
  })
  return { products, errors }
}

interface ProductRow {
  id: string
  name: string
  price: number | null
  description: string
  checkout_url: string | null
  suitable_for: string
  stock: string
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  name: r.name,
  price: r.price,
  description: r.description,
  checkoutUrl: r.checkout_url,
  suitableFor: r.suitable_for,
  stock: r.stock
})

export class CatalogStore {
  constructor(private db: Db) {}

  replaceFromFile(file: string, products: Product[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM products WHERE file = ?').run(file)
      const ins = this.db.prepare(
        `INSERT OR REPLACE INTO products(id, file, name, price, description, checkout_url, suitable_for, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const p of products)
        ins.run(p.id, file, p.name, p.price, p.description, p.checkoutUrl, p.suitableFor, p.stock)
    })()
  }

  removeFile(file: string): void {
    this.db.prepare('DELETE FROM products WHERE file = ?').run(file)
  }

  list(): Product[] {
    return (this.db.prepare('SELECT * FROM products ORDER BY name').all() as ProductRow[]).map(toProduct)
  }

  byId(id: string): Product | null {
    const r = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined
    return r ? toProduct(r) : null
  }

  /** Products whose name/description/audience share the most words with the query (partial words allowed). */
  find(query: string, k: number): Product[] {
    const tokens = tokenize(query)
    if (tokens.length === 0) return []
    return this.list()
      .map((p) => {
        const words = normalizeTokens(`${p.name} ${p.description} ${p.suitableFor} ${p.id}`)
        const score = tokens.filter((t) => words.some((w) => w === t || (t.length >= 3 && w.startsWith(t)))).length
        return { p, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.p)
  }
}

export function buildLinkAllowlist(profile: BrandProfile, products: Product[]): string[] {
  const urls = [...profile.links.map((l) => l.url), ...products.map((p) => p.checkoutUrl).filter((u): u is string => !!u)]
  return [...new Set(urls)]
}
