import * as XLSX from 'xlsx'
import type { WaGateway } from '../wa/gateway'
import type { BroadcastStore } from './store'
import { normalizePhone } from './identity'

export const MAX_IMPORT_ROWS = 20_000
const GROUP_SIZE = 25
const GROUP_PAUSE_MS = 1_500
const MAX_NOT_ON_WHATSAPP = 0.3
const NUMBER_HEADERS = ['nomor', 'number', 'phone', 'hp', 'no hp', 'no_hp', 'telepon', 'whatsapp']
const NAME_HEADERS = ['nama', 'name']

export interface ImportPreview {
  total: number
  valid: { number: string; name: string; vars: Record<string, string> }[]
  invalid: { row: number; value: string; reason: string }[]
  duplicates: number
}

/** A phone cell as exact digits: spreadsheets store numbers as floats and print big ones as 6.28E+12, which is garbage. */
function numberCell(v: unknown): string {
  const s = typeof v === 'number'
    ? (Number.isInteger(v) && v > 0 && v < Number.MAX_SAFE_INTEGER ? BigInt(v).toString() : String(v))
    : String(v ?? '').trim()
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) return '#exponen'
  // 6.28123E+12 read back as a number is 6281230000000: precision is already lost, and no real number ends in 6+ zeros.
  if (/^\d{11,}$/.test(s) && /0{6}$/.test(s)) return '#rusak'
  return s
}

const headerKey = (h: string): string => h.trim().toLowerCase().replace(/\s+/g, ' ')

/** Reads a CSV or XLSX list: column "nomor" is required, "nama" is optional, every other column becomes a variable. */
export function parseImport(file: { name: string; data: Uint8Array | string }): ImportPreview {
  const wb = typeof file.data === 'string' ? XLSX.read(file.data, { type: 'string' }) : XLSX.read(file.data, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
  if (rows.length > MAX_IMPORT_ROWS) throw new Error('TOO_MANY_ROWS')
  const keys = rows.length > 0 ? Object.keys(rows[0]) : (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []).map(String)
  const numberKey = keys.find((k) => NUMBER_HEADERS.includes(headerKey(k)))
  if (!numberKey) throw new Error('NO_NUMBER_COLUMN')
  const nameKey = keys.find((k) => NAME_HEADERS.includes(headerKey(k)))

  const out: ImportPreview = { total: rows.length, valid: [], invalid: [], duplicates: 0 }
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    const raw = numberCell(row[numberKey])
    const rowNo = i + 2 // the header is row 1
    if (!raw) { out.invalid.push({ row: rowNo, value: '', reason: 'Nomor kosong.' }); return }
    const number = normalizePhone(raw)
    if (!number) { out.invalid.push({ row: rowNo, value: raw, reason: 'Nomor tidak valid.' }); return }
    if (seen.has(number)) { out.duplicates++; return }
    seen.add(number)
    const vars: Record<string, string> = {}
    for (const k of keys) {
      if (k === numberKey || k === nameKey) continue
      const v = String(row[k] ?? '').trim()
      if (v) vars[headerKey(k).replace(/\s+/g, '_')] = v
    }
    out.valid.push({ number, name: nameKey ? String(row[nameKey] ?? '').trim() : '', vars })
  })
  return out
}

export interface ImportDeps {
  store: BroadcastStore
  gateway: WaGateway
  clock: { now(): number }
  sleep(ms: number): Promise<void>
}

export class ImportService {
  constructor(private d: ImportDeps) {}

  /**
   * Imported people start as "menunggu_persetujuan": they receive one confirmation and only count as reachable
   * after replying. Nothing is written until the consent statement is made and the list looks like a real one.
   */
  async commit(
    preview: ImportPreview,
    attest: { accepted: boolean; sourceNote: string }
  ): Promise<{ importId: number; added: number; notOnWhatsApp: number; blockedBySuppression: number; aborted: boolean }> {
    if (!attest.accepted || attest.sourceNote.trim().length < 10) throw new Error('ATTEST_REQUIRED')
    const { store, gateway } = this.d

    let blocked = 0
    const candidates = preview.valid.filter((v) => {
      if (store.isSuppressed({ number: v.number })) { blocked++; return false }
      return true
    })

    const checked: { number: string; jid: string | null; exists: boolean }[] = []
    for (let i = 0; i < candidates.length; i += GROUP_SIZE) {
      if (i > 0) await this.d.sleep(GROUP_PAUSE_MS)
      checked.push(...(await gateway.onWhatsApp(candidates.slice(i, i + GROUP_SIZE).map((c) => c.number))))
    }
    const missing = checked.filter((c) => !c.exists)
    if (candidates.length > 0 && missing.length / candidates.length > MAX_NOT_ON_WHATSAPP)
      return { importId: 0, added: 0, notOnWhatsApp: missing.length, blockedBySuppression: blocked, aborted: true }

    const found = checked.filter((c) => c.exists)
    const importId = store.createImport({ sourceNote: attest.sourceNote.trim(), total: preview.total, valid: found.length })
    const byNumber = new Map(candidates.map((c) => [c.number, c]))
    for (const c of found) {
      const row = byNumber.get(c.number)!
      store.upsertContact({
        number: c.number, jid: c.jid, name: row.name, vars: row.vars, source: 'impor', status: 'menunggu_persetujuan', importId
      })
    }
    for (const c of missing) store.suppress({ number: c.number, reason: 'tidak_terdaftar' })
    return { importId, added: found.length, notOnWhatsApp: missing.length, blockedBySuppression: blocked, aborted: false }
  }
}
