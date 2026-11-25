import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'
import { allowedFor, STEP_UP_METHODS } from '@autobot/contracts/rpc-policy'
import type { GsSource, GsInspectResult, GsPreviewResult } from '@autobot/contracts/sheets'
import { createEngine, type Engine } from '../src/engine'
import { FakeGateway } from './helpers/fake-gateway'
import { makeDir } from './helpers/fixtures'
import type { Cell, Render, SheetsSource } from '../src/knowledge/gsheets/client'
import { SheetsClient } from '../src/knowledge/gsheets/client'
import { GoogleAuth, TOKEN_URL } from '../src/knowledge/gsheets/auth'
import { GsFailure } from '../src/knowledge/gsheets/errors'
import { catalogJson, cleanCell, knowledgeText, toTable } from '../src/knowledge/gsheets/format'
import { parseSpreadsheetRef } from '../src/knowledge/gsheets/ids'

const SID = 'sheet-id-0123456789'
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const keyJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'service_account', client_email: 'bot@proj.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://evil.example/token', ...over })

class FakeSheets implements SheetsSource {
  data = new Map<string, Cell[][]>()
  raw = new Map<string, Cell[][]>()
  fail: GsFailure | null = null
  reads = 0
  delayMs = 0
  set(tab: string, rows: Cell[][], raw?: Cell[][]) { this.data.set(tab, rows); if (raw) this.raw.set(tab, raw) }
  async inspect() {
    if (this.fail) throw this.fail
    return { title: 'Toko', tabs: [...this.data.keys()].map((t, i) => ({ gid: i, title: t, rows: 100, cols: 10 })) }
  }
  async read(_id: string, tab: string, _range: string | null, render: Render) {
    this.reads++
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (this.fail) throw this.fail
    const rows = (render === 'UNFORMATTED_VALUE' ? this.raw.get(tab) : undefined) ?? this.data.get(tab)
    if (!rows) throw new GsFailure('NOT_FOUND')
    return rows
  }
}

const open: Engine[] = []
afterEach(async () => { for (const e of open.splice(0)) await e.shutdown().catch(() => undefined) })
async function boot(sheets = new FakeSheets()) {
  const dataDir = makeDir('wa-gs-')
  const engine = await createEngine({
    dataDir, secretKey: randomBytes(32), gateway: new FakeGateway(), logger: pino({ level: 'silent' }),
    sheetsSource: sheets, disableSheetsSchedule: true
  })
  open.push(engine)
  await engine.ready
  const rpc = engine.rpc as Record<string, (...a: any[]) => any>
  await rpc.gsSaveCredential(keyJson())
  return { engine, rpc, sheets, dataDir, sync: engine.internals.sheetSync }
}
const sources = (rpc: Record<string, any>): GsSource[] => rpc.gsListSources()
const faq = (n: number, tail = ''): Cell[][] => [['Pertanyaan', 'Jawaban'], ...Array.from({ length: n }, (_, i) => [`Q${i}`, `Jawaban ke-${i}${tail}`])]

describe('spreadsheet reference', () => {
  it('takes the id from a Google Sheets address or a bare id and refuses anything else', () => {
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${SID}/edit#gid=0`)).toBe(SID)
    expect(parseSpreadsheetRef(SID)).toBe(SID)
    expect(parseSpreadsheetRef('https://evil.example/spreadsheets/d/abcdefghijk')).toBeNull()
    expect(parseSpreadsheetRef('http://docs.google.com/spreadsheets/d/abcdefghijk')).toBeNull()
    expect(parseSpreadsheetRef('../../etc/passwd')).toBeNull()
  })
})

describe('turning cells into knowledge', () => {
  it('keeps leading zeros and drops control characters', () => {
    const t = toTable([['Nama', 'Telepon'], ['Budi', '08123456789'], ['', ''], ['Sari\u0007', '007']])
    expect(t.rows).toHaveLength(2)
    const { text } = knowledgeText(t, [])
    expect(text).toContain('Telepon: 08123456789')
    expect(text).toContain('Telepon: 007')
    expect(text).not.toContain('\u0007')
    expect(cleanCell('a\nb')).toBe('a b')
  })
  it('keeps only the chosen columns, and refuses when one has vanished', () => {
    const t = toTable([['Produk', 'Harga modal', 'Info'], ['A', '1000', 'bagus']])
    const { text } = knowledgeText(t, ['Produk', 'Info'])
    expect(text).not.toContain('modal')
    expect(() => knowledgeText(t, ['Tidak ada'])).toThrow(GsFailure)
  })
})

describe('turning cells into a catalog', () => {
  const table = toTable([['Kode', 'Nama', 'Harga', 'Link', 'Harga modal'], ['007', 'Paket A', 'Rp 150.000', 'https://toko.contoh.id/a', '90000'], ['008', 'Paket B', '99000', 'https://evil.example/b', '1']])
  const raw = toTable([['Kode', 'Nama', 'Harga', 'Link', 'Harga modal'], ['007', 'Paket A', 150000, 'x', 1], ['008', 'Paket B', 99000, 'x', 1]])
  const mapping = { id: 'Kode', nama: 'Nama', harga: 'Harga', checkout_url: 'Link' }

  it('keeps ids as text, reads prices as numbers, drops unmapped columns and unapproved links', () => {
    const b = catalogJson(table, raw, mapping, new Set(['toko.contoh.id']))
    const rows = JSON.parse(b.json)
    expect(rows[0]).toEqual({ id: '007', nama: 'Paket A', harga: 150000, checkout_url: 'https://toko.contoh.id/a' })
    expect(rows[1].checkout_url).toBeUndefined()
    expect(b.json).not.toContain('modal')
    expect(b.unapprovedDomains).toEqual(['evil.example'])
  })
  it('requires id and name, and a mapped column that exists', () => {
    expect(() => catalogJson(table, null, { nama: 'Nama' }, new Set())).toThrow(GsFailure)
    expect(() => catalogJson(table, null, { id: 'Kode', nama: 'Hilang' }, new Set())).toThrow(GsFailure)
  })
  it('reports invalid rows by line and fails when none is valid', () => {
    const t = toTable([['Kode', 'Nama'], ['1', 'A'], ['', 'B']])
    expect(catalogJson(t, null, { id: 'Kode', nama: 'Nama' }, new Set()).problems[0]).toMatch(/Baris 3/)
    expect(() => catalogJson(toTable([['Kode', 'Nama'], ['', '']]), null, { id: 'Kode', nama: 'Nama' }, new Set())).toThrow(GsFailure)
  })
})

describe('google calls', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  const auth = (f: (u: string, i?: RequestInit) => Promise<Response>) => new GoogleAuth(() => JSON.parse(keyJson()), f)

  it('asks only the pinned token address, whatever token_uri says, and signs a read-only request', async () => {
    const urls: string[] = []
    const bodies: string[] = []
    const a = auth(async (u, i) => { urls.push(u); bodies.push(String(i?.body)); return json(200, { access_token: 't', expires_in: 3600 }) })
    expect(await a.token()).toBe('t')
    expect(urls).toEqual([TOKEN_URL])
    const jwt = new URLSearchParams(bodies[0]).get('assertion')!
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
    expect(claims.scope).toBe('https://www.googleapis.com/auth/spreadsheets.readonly')
    expect(claims.aud).toBe(TOKEN_URL)
    await a.token()
    expect(urls).toHaveLength(1) // cached
  })
  it('maps Google answers to errors the owner can act on', async () => {
    const answer = (status: number, body: unknown) => {
      const calls: string[] = []
      const client = new SheetsClient(
        { token: async () => 'x', forget: () => undefined } as unknown as GoogleAuth,
        async (u) => { calls.push(u); return json(status, body) }
      )
      return { client, calls }
    }
    const code = async (status: number, body: unknown) => {
      const { client, calls } = answer(status, body)
      const err = await client.read(SID, "Tab 'x'", 'A1:B2', 'FORMATTED_VALUE').catch((e) => e)
      expect(calls[0].startsWith('https://sheets.googleapis.com/v4/spreadsheets/')).toBe(true)
      return (err as GsFailure).code
    }
    expect(await code(403, { error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } })).toBe('NOT_SHARED')
    expect(await code(403, { error: { status: 'PERMISSION_DENIED', message: 'Google Sheets API has not been used in project 1 before or it is disabled.' } })).toBe('API_DISABLED')
    expect(await code(404, {})).toBe('NOT_FOUND')
    expect(await code(400, { error: { message: 'Unable to parse range: X' } })).toBe('RANGE_INVALID')
    expect(await code(429, {})).toBe('RATE_LIMIT')
    expect(await code(503, {})).toBe('UPSTREAM')
    expect(await code(401, {})).toBe('CREDENTIAL_INVALID')
  })
  it('puts the tab name in quotes and doubles a quote inside it', async () => {
    let seen = ''
    const client = new SheetsClient({ token: async () => 'x', forget: () => undefined } as unknown as GoogleAuth, async (u) => { seen = decodeURIComponent(u); return json(200, { valueRanges: [{ values: [] }] }) })
    await client.read(SID, "Bob's", 'A1:C9', 'FORMATTED_VALUE')
    expect(seen).toContain("ranges='Bob''s'!A1:C9")
  })
})

describe('Google Sheets connector', () => {
  it('rejects a file that is not a service account key, and never hands the key back', async () => {
    const { rpc } = await boot()
    expect((await rpc.gsSaveCredential('not json')).ok).toBe(false)
    expect((await rpc.gsSaveCredential(JSON.stringify({ type: 'authorized_user' }))).ok).toBe(false)
    expect((await rpc.gsSaveCredential('x'.repeat(11_000))).ok).toBe(false)
    const status = await rpc.gsCredentialStatus()
    expect(status).toMatchObject({ configured: true, clientEmail: 'bot@proj.iam.gserviceaccount.com' })
    expect(JSON.stringify([status, await rpc.gsListSources()])).not.toContain('PRIVATE KEY')
  })

  it('is owner-only and asks for the password before risky changes', () => {
    for (const m of ['gsSaveCredential', 'gsInspect', 'gsListSources', 'gsRemoveSource']) {
      expect(allowedFor(m, 'owner'), m).toBe(true)
      expect(allowedFor(m, 'setup'), m).toBe(false)
    }
    for (const m of ['gsSaveCredential', 'gsDeleteCredential', 'gsRemoveSource', 'gsApproveDomain']) expect(STEP_UP_METHODS.has(m), m).toBe(true)
  })

  it('inspects a sheet, and says which email to share with when it is not shared', async () => {
    const { rpc, sheets } = await boot()
    sheets.set('FAQ', faq(2))
    const ok: GsInspectResult = await rpc.gsInspect(`https://docs.google.com/spreadsheets/d/${SID}/edit`)
    expect(ok).toMatchObject({ ok: true, spreadsheetId: SID, tabs: [{ title: 'FAQ' }] })
    sheets.fail = new GsFailure('NOT_SHARED')
    expect(await rpc.gsInspect(SID)).toMatchObject({ ok: false, error: 'NOT_SHARED', clientEmail: 'bot@proj.iam.gserviceaccount.com' })
    expect(await rpc.gsInspect('https://evil.example/x')).toMatchObject({ ok: false, error: 'INVALID_URL' })
  })

  it('previews 20 rows with a suggested mapping and problems', async () => {
    const { rpc, sheets } = await boot()
    sheets.set('Katalog', [['Kode', 'Nama Produk', 'Harga', 'Link checkout'], ...Array.from({ length: 30 }, (_, i) => [`P${i}`, `Produk ${i}`, 1000 + i, 'https://baru.example/x'])])
    const p: GsPreviewResult = await rpc.gsPreview({ spreadsheetId: SID, gid: 0, role: 'catalog' })
    expect(p).toMatchObject({ ok: true, totalRows: 30, suggestedMapping: { id: 'Kode', nama: 'Nama Produk', harga: 'Harga', checkout_url: 'Link checkout' } })
    if (p.ok) { expect(p.rows).toHaveLength(20); expect(p.problems.join(' ')).toMatch(/baru\.example/) }
  })

  it('syncs a knowledge tab into the index, and an edit reaches the bot', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    sheets.set('FAQ', [['Pertanyaan', 'Jawaban'], ['Jam buka?', 'Kami buka pukul 09.00 sampai 17.00']])
    const { id } = rpc.gsAddSource({ name: 'Daftar FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    const s = sources(rpc)[0]
    expect(s).toMatchObject({ lastStatus: 'ok', rowCount: 1, file: '_gsheets/daftar-faq.txt' })
    const files = (rpc.listFiles() as { file: string; status: string }[])
    expect(files.find((f) => f.file === '_gsheets/daftar-faq.txt')?.status).toBe('indexed')
    expect(readFileSync(join(engine.internals.knowledgeDir, s.file), 'utf8')).toContain('Pertanyaan: Jam buka?; Jawaban: Kami buka pukul 09.00')

    sheets.set('FAQ', [['Pertanyaan', 'Jawaban'], ['Jam buka?', 'Kami buka pukul 10.00 sampai 18.00']])
    await sync.syncNow(id)
    expect(readFileSync(join(engine.internals.knowledgeDir, s.file), 'utf8')).toContain('pukul 10.00')
  })

  it('does not re-index when nothing changed', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    sheets.set('FAQ', faq(3))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    const file = join(engine.internals.knowledgeDir, sources(rpc)[0].file)
    const before = statSync(file).mtimeMs
    await new Promise((r) => setTimeout(r, 15))
    await sync.syncNow(id)
    expect(statSync(file).mtimeMs).toBe(before)
    expect(sources(rpc)[0].lastStatus).toBe('ok')
  })

  it('keeps the old knowledge when Google refuses, and shows the cause', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    sheets.set('FAQ', faq(3))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    const file = join(engine.internals.knowledgeDir, sources(rpc)[0].file)
    const text = readFileSync(file, 'utf8')
    sheets.fail = new GsFailure('NOT_SHARED')
    await sync.syncNow(id)
    expect(sources(rpc)[0]).toMatchObject({ lastStatus: 'error', lastError: 'NOT_SHARED', consecutiveFailures: 1 })
    expect(readFileSync(file, 'utf8')).toBe(text)
  })

  it('holds a change that deletes most of the rows until the owner confirms', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    sheets.set('FAQ', faq(12))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    const file = join(engine.internals.knowledgeDir, sources(rpc)[0].file)
    const full = readFileSync(file, 'utf8')
    sheets.set('FAQ', faq(3))
    await sync.syncNow(id)
    expect(sources(rpc)[0]).toMatchObject({ lastStatus: 'needs_confirm', rowCount: 12 })
    expect(sources(rpc)[0].pending?.reason).toBe('shrink')
    expect(readFileSync(file, 'utf8')).toBe(full)
    await rpc.gsConfirmChange(id)
    expect(sources(rpc)[0]).toMatchObject({ lastStatus: 'ok', rowCount: 3, pending: null })
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(3)
  })

  it('refuses a sheet that is too large without touching the snapshot', async () => {
    const { rpc, sheets, sync } = await boot()
    sheets.set('FAQ', faq(2))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    sheets.set('FAQ', faq(5100))
    await sync.syncNow(id)
    expect(sources(rpc)[0]).toMatchObject({ lastStatus: 'error', lastError: 'TOO_LARGE', rowCount: 2 })
  })

  it('fills the product catalog, and a link on an unapproved domain is not used until it is approved', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    sheets.set('Katalog', [['Kode', 'Nama', 'Harga', 'Link', 'Harga modal'], ['007', 'Paket A', 'Rp 150.000', 'https://toko.contoh.id/a', '90.000']], [['Kode', 'Nama', 'Harga', 'Link', 'Harga modal'], ['007', 'Paket A', 150000, 'https://toko.contoh.id/a', 90000]])
    const { id } = rpc.gsAddSource({
      name: 'Katalog', spreadsheetId: SID, gid: 0, tabTitle: 'Katalog', role: 'catalog',
      mapping: { id: 'Kode', nama: 'Nama', harga: 'Harga', checkout_url: 'Link' }
    })
    await sync.syncNow(id)
    const db = engine.internals.db
    const product = () => db.prepare('SELECT id, name, price, checkout_url FROM products').all()
    expect(product()).toEqual([{ id: '007', name: 'Paket A', price: 150000, checkout_url: null }])
    expect(sources(rpc)[0].pending?.reason).toBe('domain')

    await rpc.gsApproveDomain('toko.contoh.id')
    await sync.syncNow(id)
    expect(product()).toEqual([{ id: '007', name: 'Paket A', price: 150000, checkout_url: 'https://toko.contoh.id/a' }])
    expect(sources(rpc)[0].pending).toBeNull()
    expect(await rpc.gsListApprovedDomains()).toEqual(['toko.contoh.id'])
    expect(readFileSync(join(engine.internals.knowledgeDir, sources(rpc)[0].file), 'utf8')).not.toContain('modal')
  })

  it('runs one sync at a time per source', async () => {
    const { rpc, sheets, sync } = await boot()
    sheets.set('FAQ', faq(2))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    const before = sheets.reads
    sheets.delayMs = 20
    sheets.set('FAQ', faq(3))
    await Promise.all([sync.syncNow(id), sync.syncNow(id), sync.syncNow(id)])
    expect(sheets.reads - before).toBe(1)
  })

  it('removing a source removes its file, its chunks and its products', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    sheets.set('FAQ', faq(2))
    sheets.set('Katalog', [['Kode', 'Nama'], ['1', 'A']])
    const a = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' }).id
    const b = rpc.gsAddSource({ name: 'Katalog', spreadsheetId: SID, gid: 1, tabTitle: 'Katalog', role: 'catalog', mapping: { id: 'Kode', nama: 'Nama' } }).id
    await sync.syncNow(a); await sync.syncNow(b)
    const files = sources(rpc).map((s) => join(engine.internals.knowledgeDir, s.file))
    expect(files.every(existsSync)).toBe(true)
    expect(engine.internals.db.prepare('SELECT COUNT(*) n FROM products').get()).toEqual({ n: 1 })
    await rpc.gsRemoveSource(a); await rpc.gsRemoveSource(b)
    expect(files.some(existsSync)).toBe(false)
    expect(engine.internals.db.prepare('SELECT COUNT(*) n FROM products').get()).toEqual({ n: 0 })
    expect(rpc.listFiles()).toEqual([])
    expect(sources(rpc)).toEqual([])
  })

  it('does not let a synced file be deleted by hand, or the same tab be linked twice', async () => {
    const { rpc, sheets, sync } = await boot()
    sheets.set('FAQ', faq(2))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    await expect(Promise.resolve().then(() => rpc.kbDelete('_gsheets/faq.txt'))).rejects.toThrow(/Google Sheets/)
    expect(() => rpc.gsAddSource({ name: 'FAQ 2', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })).toThrow(/sudah ditautkan/)
  })

  it('stops for lack of a key, and carries on once one is saved', async () => {
    const { rpc, sheets, sync } = await boot()
    sheets.set('FAQ', faq(2))
    await rpc.gsDeleteCredential()
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    expect(sources(rpc)[0]).toMatchObject({ lastStatus: 'error', lastError: 'NO_CREDENTIAL' })
    expect(sync.isDue(sources(rpc)[0], Date.now() + 3_600_000)).toBe(false)
    await rpc.gsSaveCredential(keyJson())
    await sync.syncAll()
    expect(sources(rpc)[0].lastStatus).toBe('ok')
  })

  it('schedules by interval, backing off after failures', async () => {
    const { rpc, sheets, sync } = await boot()
    sheets.set('FAQ', faq(2))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge', intervalMin: 15 })
    await sync.syncNow(id)
    const s = sources(rpc)[0]
    expect(sync.isDue(s, s.lastSyncAt! + 14 * 60_000)).toBe(false)
    expect(sync.isDue(s, s.lastSyncAt! + 15 * 60_000)).toBe(true)
    expect(sync.isDue({ ...s, enabled: false }, s.lastSyncAt! + 99 * 60_000)).toBe(false)
    expect(sync.isDue({ ...s, consecutiveFailures: 1, lastStatus: 'error', lastError: 'UPSTREAM' }, s.lastSyncAt! + 60_000)).toBe(false)
    expect(sync.isDue({ ...s, consecutiveFailures: 1, lastStatus: 'error', lastError: 'UPSTREAM' }, s.lastSyncAt! + 2 * 60_000)).toBe(true)
  })

  it('sends sync events to the stream', async () => {
    const { rpc, sheets, sync, engine } = await boot()
    const seen: { id: string; status: string }[] = []
    engine.events.on('evt:knowledge-sync', (e) => seen.push(e))
    sheets.set('FAQ', faq(2))
    const { id } = rpc.gsAddSource({ name: 'FAQ', spreadsheetId: SID, gid: 0, tabTitle: 'FAQ', role: 'knowledge' })
    await sync.syncNow(id)
    expect(seen.map((e) => e.status)).toContain('ok')
  })
})
