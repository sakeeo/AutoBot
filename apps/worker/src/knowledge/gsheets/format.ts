import { createHash } from 'node:crypto'
import { CATALOG_FIELDS, GS_LIMITS, type CatalogField } from '@autobot/contracts/sheets'
import type { Cell } from './client'
import { GsFailure } from './errors'

export interface Table { headers: string[]; rows: string[][] }

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f\\u2028\\u2029]', 'g')

/** One cell as text: no control characters, one line, capped. A cell is data; it is never run as anything. */
export function cleanCell(v: Cell | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[\r\n\t]+/g, ' ').replace(CONTROL, '').trim().slice(0, GS_LIMITS.maxCell)
}

/** The first row is the header. Rows that are completely empty are dropped; empty header columns are dropped. */
export function toTable(matrix: Cell[][]): Table {
  if (matrix.length === 0) return { headers: [], rows: [] }
  const width = Math.max(...matrix.map((r) => r.length))
  if (width > GS_LIMITS.maxCols) throw new GsFailure('TOO_LARGE')
  if (matrix.length - 1 > GS_LIMITS.maxRows) throw new GsFailure('TOO_LARGE')
  const head = Array.from({ length: width }, (_, i) => cleanCell(matrix[0][i]))
  const keep = head.map((h, i) => (h ? i : -1)).filter((i) => i >= 0)
  const seen = new Set<string>()
  const headers = keep.map((i) => {
    let h = head[i]
    for (let n = 2; seen.has(h.toLowerCase()); n++) h = `${head[i]} (${n})`
    seen.add(h.toLowerCase())
    return h
  })
  const rows = matrix.slice(1)
    .map((r) => keep.map((i) => cleanCell(r[i])))
    .filter((r) => r.some((c) => c !== ''))
  return { headers, rows }
}

export const colIndex = (t: Table, name: string): number => t.headers.findIndex((h) => h.toLowerCase() === name.trim().toLowerCase())

/** Knowledge role: one line per row, `Kolom: nilai; Kolom: nilai` (the same shape `rowsToLines` makes for spreadsheets). */
export function knowledgeText(t: Table, columns: string[]): { text: string; rowCount: number } {
  const idx = columns.length === 0 ? t.headers.map((_, i) => i) : columns.map((c) => colIndex(t, c))
  if (idx.some((i) => i < 0)) throw new GsFailure('COLUMN_MISSING')
  const lines = t.rows
    .map((r) => idx.filter((i) => r[i] !== '').map((i) => `${t.headers[i]}: ${r[i]}`).join('; '))
    .filter(Boolean)
  const text = lines.join('\n') + (lines.length ? '\n' : '')
  if (Buffer.byteLength(text) > GS_LIMITS.maxBytes) throw new GsFailure('TOO_LARGE')
  return { text, rowCount: lines.length }
}

export interface CatalogRow { id: string; nama: string; harga?: number | string; deskripsi_singkat?: string; checkout_url?: string; cocok_untuk?: string; stok?: string }

export interface CatalogBuild {
  json: string
  rowCount: number
  /** Row problems (by sheet line number); valid rows are kept. */
  problems: string[]
  /** Checkout hosts that are not approved: their links were dropped. */
  unapprovedDomains: string[]
  items: CatalogRow[]
}

const ALIASES: Record<CatalogField, string[]> = {
  id: ['id', 'kode', 'sku', 'kode produk'],
  nama: ['nama', 'name', 'produk', 'nama produk'],
  harga: ['harga', 'price'],
  deskripsi_singkat: ['deskripsi_singkat', 'deskripsi singkat', 'deskripsi', 'description', 'keterangan'],
  checkout_url: ['checkout_url', 'checkout url', 'checkout', 'link checkout', 'link', 'url'],
  cocok_untuk: ['cocok_untuk', 'cocok untuk', 'untuk'],
  stok: ['stok', 'stock']
}

/** A guess at which column feeds which product field, from the header names. */
export function suggestMapping(headers: string[]): Partial<Record<CatalogField, string>> {
  const out: Partial<Record<CatalogField, string>> = {}
  for (const f of CATALOG_FIELDS) {
    const hit = headers.find((h) => ALIASES[f].includes(h.trim().toLowerCase()))
    if (hit) out[f] = hit
  }
  return out
}

const hostOf = (url: string): string | null => {
  try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname.toLowerCase() : null } catch { return null }
}
export const isApproved = (host: string, approved: Set<string>): boolean =>
  [...approved].some((d) => host === d || host.endsWith(`.${d}`))

/**
 * Catalog role. `formatted` supplies the text columns (so "007" stays "007"); `raw` (optional) supplies the price column
 * as a number, so the price does not depend on the sheet's locale. Columns that are not mapped are dropped.
 */
export function catalogJson(formatted: Table, raw: Table | null, mapping: Partial<Record<CatalogField, string>>, approved: Set<string>): CatalogBuild {
  if (!mapping.id || !mapping.nama) throw new GsFailure('COLUMN_MISSING', 'Kolom id dan nama wajib dipetakan.')
  const col = new Map<CatalogField, number>()
  for (const [f, name] of Object.entries(mapping) as [CatalogField, string][]) {
    const i = colIndex(formatted, name)
    if (i < 0) throw new GsFailure('COLUMN_MISSING')
    col.set(f, i)
  }
  const problems: string[] = []
  const unapproved = new Set<string>()
  const items: CatalogRow[] = []
  const seen = new Set<string>()
  formatted.rows.forEach((r, n) => {
    const line = n + 2
    const get = (f: CatalogField): string => (col.has(f) ? r[col.get(f)!] : '')
    const id = get('id'), nama = get('nama')
    if (!id || !nama) { problems.push(`Baris ${line}: id dan nama wajib diisi.`); return }
    if (seen.has(id)) problems.push(`Baris ${line}: id "${id}" muncul lebih dari sekali; baris terakhir dipakai.`)
    seen.add(id)
    const item: CatalogRow = { id, nama }
    if (col.has('harga')) {
      const rv = raw && raw.rows[n] ? raw.rows[n][colIndex(raw, mapping.harga!)] : undefined
      const num = rv !== undefined && rv !== '' ? Number(rv) : NaN
      item.harga = Number.isFinite(num) ? num : get('harga')
    }
    for (const f of ['deskripsi_singkat', 'cocok_untuk', 'stok'] as const) if (col.has(f)) item[f] = get(f)
    const url = get('checkout_url')
    if (url) {
      const host = hostOf(url)
      if (!host) problems.push(`Baris ${line}: checkout_url harus berupa alamat https:// (${id}).`)
      else if (!isApproved(host, approved)) unapproved.add(host)
      else item.checkout_url = url
    }
    items.push(item)
  })
  if (items.length === 0) throw new GsFailure('EMPTY')
  const byId = new Map(items.map((i) => [i.id, i]))
  const final = [...byId.values()]
  const json = JSON.stringify(final, null, 1) + '\n'
  if (Buffer.byteLength(json) > GS_LIMITS.maxBytes) throw new GsFailure('TOO_LARGE')
  return { json, rowCount: final.length, problems, unapprovedDomains: [...unapproved].sort(), items: final }
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/** A file-name-safe slug of a source name. */
export function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return s || 'sumber'
}

/** A short plain-language account of what a catalog sync changed (prices and links matter most). */
export function catalogDiff(before: CatalogRow[], after: CatalogRow[]): string {
  const b = new Map(before.map((i) => [i.id, i]))
  const a = new Map(after.map((i) => [i.id, i]))
  const added = [...a.keys()].filter((k) => !b.has(k)).length
  const removed = [...b.keys()].filter((k) => !a.has(k)).length
  const price: string[] = [], links: string[] = []
  for (const [k, n] of a) {
    const o = b.get(k)
    if (!o) continue
    if (String(o.harga ?? '') !== String(n.harga ?? '')) price.push(`${k}: ${o.harga ?? '-'} → ${n.harga ?? '-'}`)
    if ((o.checkout_url ?? '') !== (n.checkout_url ?? '')) links.push(k)
  }
  const parts = [`${after.length} produk`, `+${added}`, `−${removed}`]
  if (price.length) parts.push(`harga berubah: ${price.slice(0, 5).join(', ')}${price.length > 5 ? ` (+${price.length - 5})` : ''}`)
  if (links.length) parts.push(`tautan checkout berubah: ${links.slice(0, 5).join(', ')}${links.length > 5 ? ` (+${links.length - 5})` : ''}`)
  return parts.join(' · ')
}
