import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { openDb } from '../../src/main/db'
import { BroadcastStore } from '../../src/main/broadcast/store'
import { ImportService, MAX_IMPORT_ROWS, parseImport } from '../../src/main/broadcast/import'
import { mapOnWhatsApp } from '../../src/main/wa/baileys-gateway'
import type { WaGateway } from '../../src/main/wa/gateway'

const csv = (rows: string[]) => ({ name: 'daftar.csv', data: rows.join('\n') })

describe('parseImport', () => {
  it('splits valid numbers, invalid rows (with the row number and reason) and duplicates', () => {
    const p = parseImport(csv([
      'nomor,nama,paket',
      '0812-3456-7890,Budi,Gold',
      '+62 812 3456 7890,Budi lagi,Silver',
      '123,Pendek,Gold',
      ',Kosong,Gold',
      '081298765432,Sari,Silver'
    ]))
    expect(p.total).toBe(5)
    expect(p.valid).toEqual([
      { number: '6281234567890', name: 'Budi', vars: { paket: 'Gold' } },
      { number: '6281298765432', name: 'Sari', vars: { paket: 'Silver' } }
    ])
    expect(p.duplicates).toBe(1)
    expect(p.invalid.map((r) => r.row)).toEqual([4, 5])
    expect(p.invalid[0].reason).toMatch(/tidak valid/i)
    expect(p.invalid[1].reason).toMatch(/kosong/i)
  })
  it('recognises headers regardless of case and spacing', () => {
    const p = parseImport(csv([' Nomor , NAMA ', '081234567890,Budi']))
    expect(p.valid).toHaveLength(1)
    expect(p.valid[0].name).toBe('Budi')
  })
  it('refuses a file without a number column, with a clear error', () => {
    expect(() => parseImport(csv(['nama,paket', 'Budi,Gold']))).toThrow('NO_NUMBER_COLUMN')
  })
  it('reads XLSX the same way', () => {
    const ws = XLSX.utils.aoa_to_sheet([['nomor', 'nama'], ['081234567890', 'Budi'], ['6281298765432', 'Sari']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const p = parseImport({ name: 'daftar.xlsx', data: new Uint8Array(data) })
    expect(p.valid.map((v) => v.number)).toEqual(['6281234567890', '6281298765432'])
  })
  it('reads numeric XLSX phone cells exactly, instead of turning them into exponent text', () => {
    const ws = XLSX.utils.aoa_to_sheet([['nomor', 'nama'], [6281234567890, 'Budi'], [81298765432, 'Sari']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const p = parseImport({ name: 'daftar.xlsx', data: new Uint8Array(data) })
    expect(p.valid.map((v) => v.number)).toEqual(['6281234567890', '6281298765432'])
  })
  it('refuses a number that a spreadsheet already mangled into exponent notation', () => {
    const p = parseImport(csv(['nomor,nama', '6.28123E+12,Rusak', '081234567890,Budi']))
    expect(p.valid.map((v) => v.number)).toEqual(['6281234567890'])
    expect(p.invalid).toHaveLength(1)
    expect(p.invalid[0].reason).toMatch(/tidak valid/i)
  })
  it('rejects a file with more than 20,000 rows', () => {
    expect(MAX_IMPORT_ROWS).toBe(20_000)
    const rows = ['nomor', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `08123${String(i).padStart(8, '0')}`)]
    expect(() => parseImport(csv(rows))).toThrow('TOO_MANY_ROWS')
  })
})

describe('mapOnWhatsApp', () => {
  it('matches Baileys results to the numbers asked for, marking missing ones as not registered', () => {
    const r = mapOnWhatsApp(['6281', '6282', '6283'], [
      { jid: '6281@s.whatsapp.net', exists: true }, { jid: '6282@s.whatsapp.net', exists: false }
    ])
    expect(r).toEqual([
      { number: '6281', jid: '6281@s.whatsapp.net', exists: true },
      { number: '6282', jid: null, exists: false },
      { number: '6283', jid: null, exists: false }
    ])
  })
})

class Gw implements WaGateway {
  asked: string[][] = []
  constructor(private registered: (n: string) => boolean = () => true) {}
  onMessage(): void {}
  onStatus(): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return '6285119308345' }
  jidFor(n: string): string { return `${n}@s.whatsapp.net` }
  async sendText(): Promise<string | null> { return null }
  async onWhatsApp(numbers: string[]) {
    this.asked.push(numbers)
    return numbers.map((number) => ({ number, jid: this.registered(number) ? `${number}@s.whatsapp.net` : null, exists: this.registered(number) }))
  }
}
const attest = { accepted: true, sourceNote: 'Formulir pendaftaran website Okt 2026' }
function setup(registered?: (n: string) => boolean) {
  const db = openDb(':memory:')
  const clock = { now: () => 1_700_000_000_000 }
  const store = new BroadcastStore(db, clock)
  const gateway = new Gw(registered)
  const sleeps: number[] = []
  const svc = new ImportService({ store, gateway, clock, sleep: async (ms) => { sleeps.push(ms) } })
  return { db, store, gateway, svc, sleeps }
}
const preview = (nums: string[]) => ({
  total: nums.length, valid: nums.map((number, i) => ({ number, name: `N${i}`, vars: {} })), invalid: [], duplicates: 0
})

describe('ImportService.commit', () => {
  it('needs the consent statement and a real source note, and writes nothing without them', async () => {
    const t = setup()
    await expect(t.svc.commit(preview(['6281234567890']), { accepted: false, sourceNote: 'Formulir pendaftaran website' })).rejects.toThrow('ATTEST_REQUIRED')
    await expect(t.svc.commit(preview(['6281234567890']), { accepted: true, sourceNote: 'singkat' })).rejects.toThrow('ATTEST_REQUIRED')
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM broadcast_contacts').get()).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM broadcast_imports').get()).toEqual({ n: 0 })
    expect(t.gateway.asked).toEqual([])
  })
  it('saves registered numbers as pending contacts with their jid and records the import with its source', async () => {
    const t = setup()
    const r = await t.svc.commit(preview(['6281234567890', '6281298765432']), attest)
    expect(r).toMatchObject({ added: 2, notOnWhatsApp: 0, blockedBySuppression: 0, aborted: false })
    const c = t.store.findContact({ number: '6281234567890' })!
    expect(c).toMatchObject({ source: 'impor', status: 'menunggu_persetujuan', jid: '6281234567890@s.whatsapp.net', importId: r.importId })
    expect(t.db.prepare('SELECT source_note, valid FROM broadcast_imports').get()).toEqual({ source_note: attest.sourceNote, valid: 2 })
  })
  it('drops numbers on the suppression list without asking WhatsApp about them', async () => {
    const t = setup()
    t.store.suppress({ number: '6281234567890', reason: 'berhenti' })
    const r = await t.svc.commit(preview(['6281234567890', '6281298765432']), attest)
    expect(r.blockedBySuppression).toBe(1)
    expect(t.gateway.asked.flat()).toEqual(['6281298765432'])
    expect(t.store.findContact({ number: '6281234567890' })).toBeNull()
  })
  it('puts numbers that are not on WhatsApp on the suppression list instead of saving them', async () => {
    const nums = Array.from({ length: 10 }, (_, i) => `62812000000${String(i).padStart(2, '0')}`)
    const t = setup((n) => n !== nums[0])
    const r = await t.svc.commit(preview(nums), attest)
    expect(r).toMatchObject({ added: 9, notOnWhatsApp: 1, aborted: false })
    expect(t.store.findContact({ number: nums[0] })).toBeNull()
    expect(t.store.isSuppressed({ number: nums[0] })?.reason).toBe('tidak_terdaftar')
  })
  it('stops and saves nothing when more than 30% of the list is not on WhatsApp', async () => {
    const nums = Array.from({ length: 10 }, (_, i) => `62812000000${String(i).padStart(2, '0')}`)
    const t = setup((n) => nums.indexOf(n) >= 4)
    const r = await t.svc.commit(preview(nums), attest)
    expect(r).toMatchObject({ aborted: true, added: 0, notOnWhatsApp: 4 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM broadcast_contacts').get()).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM broadcast_suppress').get()).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM broadcast_imports').get()).toEqual({ n: 0 })
  })
  it('checks in groups of 25 with a pause between groups, but not before the first', async () => {
    const nums = Array.from({ length: 60 }, (_, i) => `6281200000${String(i).padStart(3, '0')}`)
    const t = setup()
    await t.svc.commit(preview(nums), attest)
    expect(t.gateway.asked.map((g) => g.length)).toEqual([25, 25, 10])
    expect(t.sleeps).toHaveLength(2)
    for (const ms of t.sleeps) expect(ms).toBeGreaterThanOrEqual(1000)
  })
  it('does not demote someone who already chatted with the bot', async () => {
    const t = setup()
    t.store.upsertContact({ number: '6281234567890', jid: '6281234567890@s.whatsapp.net', source: 'chat', status: 'aktif' })
    await t.svc.commit(preview(['6281234567890']), attest)
    expect(t.store.findContact({ number: '6281234567890' })).toMatchObject({ status: 'aktif', source: 'chat' })
  })
})
