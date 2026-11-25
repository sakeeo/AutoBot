import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'
import { parseCatalog, CatalogStore, buildLinkAllowlist, type Product } from '../src/catalog/catalog-store'
import { PRESETS } from '@autobot/contracts/brand'

const CSV = [
  'id,nama,harga,deskripsi_singkat,checkout_url,cocok_untuk,stok',
  'website-umkm,Paket Website UMKM,Rp1.500.000,domain hosting desain konten,https://toko.example/checkout/website-umkm,kuliner toko jasa,tersedia',
  ',Tanpa Id,1000,x,,,',
  'audit-seo,Audit Kenalan SEO,2500000,audit dasar,http://toko.example/insecure,pemula,tersedia'
].join('\n')

describe('parseCatalog', () => {
  it('parses csv rows, reports invalid rows and keeps valid products', () => {
    const { products, errors } = parseCatalog(CSV, '.csv')
    expect(products.map((p) => p.id)).toEqual(['website-umkm', 'audit-seo'])
    expect(errors.some((e) => /id/i.test(e) && /baris 3/i.test(e))).toBe(true)
  })
  it('normalises rupiah prices', () => {
    const { products } = parseCatalog(CSV, '.csv')
    expect(products[0].price).toBe(1500000)
    expect(products[1].price).toBe(2500000)
  })
  it('nulls and reports a non-https checkout url but keeps the product', () => {
    const { products, errors } = parseCatalog(CSV, '.csv')
    expect(products[1].checkoutUrl).toBeNull()
    expect(errors.some((e) => /https/i.test(e))).toBe(true)
    expect(products[0].checkoutUrl).toBe('https://toko.example/checkout/website-umkm')
  })
  it('parses a json array', () => {
    const { products } = parseCatalog(
      JSON.stringify([{ id: 'a', nama: 'Produk A', harga: 15000, checkout_url: 'https://x.example/a' }]), '.json'
    )
    expect(products).toEqual([
      { id: 'a', name: 'Produk A', price: 15000, description: '', checkoutUrl: 'https://x.example/a', suitableFor: '', stock: '' }
    ])
  })
  it('returns an error for broken json instead of throwing', () => {
    const r = parseCatalog('{bad', '.json')
    expect(r.products).toEqual([])
    expect(r.errors.length).toBeGreaterThan(0)
  })
})

describe('CatalogStore', () => {
  const sample = (): Product[] => [
    { id: 'website-umkm', name: 'Paket Website UMKM', price: 1500000, description: 'domain hosting desain', checkoutUrl: 'https://toko.example/checkout/website-umkm', suitableFor: 'kuliner toko', stock: '' },
    { id: 'website-custom', name: 'Website Profesional Custom', price: 3500000, description: 'desain khusus blog', checkoutUrl: null, suitableFor: '', stock: '' },
    { id: 'audit-seo', name: 'Audit SEO', price: 1500000, description: 'audit google', checkoutUrl: null, suitableFor: '', stock: '' }
  ]
  it('replaceFromFile does not duplicate and removeFile deletes', () => {
    const s = new CatalogStore(openDb(':memory:'))
    s.replaceFromFile('/k/katalog.csv', sample())
    s.replaceFromFile('/k/katalog.csv', sample())
    expect(s.list()).toHaveLength(3)
    s.removeFile('/k/katalog.csv')
    expect(s.list()).toEqual([])
  })
  it('byId returns the product or null', () => {
    const s = new CatalogStore(openDb(':memory:'))
    s.replaceFromFile('/k/katalog.csv', sample())
    expect(s.byId('audit-seo')?.name).toBe('Audit SEO')
    expect(s.byId('nope')).toBeNull()
  })
  it('find ranks the best match first, including partial words', () => {
    const s = new CatalogStore(openDb(':memory:'))
    s.replaceFromFile('/k/katalog.csv', sample())
    const r = s.find('harga web umkm', 2)
    expect(r[0].id).toBe('website-umkm')
    expect(r.length).toBeLessThanOrEqual(2)
  })
  it('find returns nothing for unrelated queries', () => {
    const s = new CatalogStore(openDb(':memory:'))
    s.replaceFromFile('/k/katalog.csv', sample())
    expect(s.find('resep nasi goreng', 3)).toEqual([])
  })
})

describe('buildLinkAllowlist', () => {
  it('merges profile links and product checkout urls without duplicates', () => {
    const p = structuredClone(PRESETS.toko_online)
    p.links = [{ id: 'l1', name: 'Checkout', kind: 'checkout', url: 'https://toko.example/checkout/website-umkm', tracking: true }]
    const products: Product[] = [
      { id: 'a', name: 'A', price: 1, description: '', checkoutUrl: 'https://toko.example/checkout/website-umkm', suitableFor: '', stock: '' },
      { id: 'b', name: 'B', price: 1, description: '', checkoutUrl: 'https://toko.example/checkout/b', suitableFor: '', stock: '' },
      { id: 'c', name: 'C', price: 1, description: '', checkoutUrl: null, suitableFor: '', stock: '' }
    ]
    expect(buildLinkAllowlist(p, products).sort()).toEqual([
      'https://toko.example/checkout/b', 'https://toko.example/checkout/website-umkm'
    ])
  })
})
