import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'
import { IndexStore } from '../src/knowledge/index-store'
import { CatalogStore } from '../src/catalog/catalog-store'
import { BrandStore } from '../src/brand-store'
import { createBrandHandlers } from '../src/brand-ipc'
import type { AiProvider } from '../src/answer/ai-answerer'
import type { WaGateway } from '../src/wa/gateway'
import type { ConnStatus, IncomingMessage } from '@autobot/contracts/types'
import { PRESETS, type BrandProfile } from '@autobot/contracts/brand'

const MONDAY_10_WITA = Date.UTC(2026, 10, 16, 2, 0)
const BOT = '6285119308345'

class FakeGateway implements WaGateway {
  sent: { chatId: string; text: string }[] = []
  onMessage(_cb: (m: IncomingMessage) => void): void {}
  onStatus(_cb: (s: ConnStatus) => void): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return BOT }
  async onWhatsApp(numbers: string[]): Promise<{ number: string; jid: string | null; exists: boolean }[]> {
    return numbers.map((number) => ({ number, jid: `${number}@s.whatsapp.net`, exists: true }))
  }
  jidFor(n: string): string { return `${n.replace(/\D/g, '')}@s.whatsapp.net` }
  async sendText(chatId: string, text: string): Promise<string | null> {
    this.sent.push({ chatId, text })
    return 'x'
  }
}

const agentOut = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    intent: 'tanya_produk', stage: 'gali', reply_parts: ['Paket Website UMKM Rp1.500.000 per tahun ya Kak'],
    lead_updates: {}, product_id: null, suggested_action: 'none', confidence: 0.9, sources: ['faq.md'], ...o
  })

function setup(opts: { provider?: boolean } = {}) {
  const clock = { t: MONDAY_10_WITA, now() { return this.t } }
  const db = openDb(':memory:')
  const store = new IndexStore(db)
  store.replaceFile('/k/faq.md', 1, ['Paket Website UMKM Rp1.500.000 per tahun sudah termasuk domain dan hosting.'])
  const catalog = new CatalogStore(db)
  const gateway = new FakeGateway()
  const brand = new BrandStore(db, clock, () => ({ botNumber: gateway.selfNumber(), productCount: catalog.list().length }))
  const calls: { system: string; user: string }[] = []
  const provider: AiProvider = {
    complete: async (req) => { calls.push({ system: req.system, user: req.user }); return replies.shift() ?? agentOut() }
  }
  const replies: string[] = []
  const handlers = createBrandHandlers({
    brand, catalog, store, gateway, clock,
    getProvider: () => (opts.provider === false ? null : { provider, cfg: { model: 'm', maxTokens: 300 } })
  })
  return { db, brand, catalog, gateway, handlers, calls, replies }
}

const named = (name: string, over: Partial<BrandProfile> = {}): BrandProfile => {
  const p = structuredClone(PRESETS.jasa_agensi)
  p.identity = { ...p.identity, businessName: name, botName: 'Kebi' }
  return { ...p, ...over }
}

describe('getBrand / saveBrandDraft / applyBrand', () => {
  it('returns active and draft profiles with the bot number and product count', async () => {
    const t = setup()
    const r = await t.handlers.getBrand()
    expect(r.botNumber).toBe(BOT)
    expect(r.productCount).toBe(0)
    expect(r.active.version).toBe(0)
    expect(r.draft.preset).toBe('kustom')
  })
  it('rejects unknown properties and oversized payloads', async () => {
    const t = setup()
    expect((await t.handlers.saveBrandDraft({ ...named('X'), evil: 1 })).ok).toBe(false)
    const huge = named('X'); huge.identity.about = 'a'.repeat(400); huge.objections = Array.from({ length: 20 }, () => ({ trigger: 't', answer: 'a'.repeat(600) }))
    huge.style.examples = Array.from({ length: 10 }, () => ({ q: 'q'.repeat(300), a: 'a'.repeat(600) }))
    expect((await t.handlers.saveBrandDraft({ ...huge, pad: 'x'.repeat(250_000) })).ok).toBe(false)
  })
  it('apply fails when an admin number is the bot number', async () => {
    const t = setup()
    const p = named('Kerabat Koding')
    p.admins = [{ id: 'a', name: 'Bot', number: '0851-1930-8345', notifyWhatsapp: true }]
    await t.handlers.saveBrandDraft(p)
    const r = await t.handlers.applyBrand()
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.field === 'admins[0].number')).toBe(true)
  })
  it('apply succeeds for a valid draft and lists versions; restore of an unknown version reports an error', async () => {
    const t = setup()
    await t.handlers.saveBrandDraft(named('Kerabat Koding'))
    expect(await t.handlers.applyBrand()).toMatchObject({ ok: true, version: 1 })
    expect((await t.handlers.listBrandVersions())[0].version).toBe(1)
    expect(await t.handlers.restoreBrandVersion(99)).toMatchObject({ ok: false })
    expect(await t.handlers.restoreBrandVersion(1)).toMatchObject({ ok: true })
  })
  it('export then import round-trips, and oversized or broken imports are rejected', async () => {
    const t = setup()
    await t.handlers.saveBrandDraft(named('Kerabat Koding'))
    await t.handlers.applyBrand()
    const json = await t.handlers.exportBrand()
    expect((await t.handlers.importBrand(json)).ok).toBe(true)
    expect((await t.handlers.importBrand('{bad')).ok).toBe(false)
    expect((await t.handlers.importBrand('x'.repeat(300_000))).ok).toBe(false)
  })
})

describe('presets', () => {
  it('lists every preset', async () => {
    const t = setup()
    const ids = (await t.handlers.listPresets()).map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['toko_online', 'jasa_agensi', 'kustom']))
    expect(ids).toHaveLength(7)
  })
  it('loading a preset swaps rules and goal but keeps the user identity, admins and links', async () => {
    const t = setup()
    const mine = named('Kopi Sudut')
    mine.admins = [{ id: 'a1', name: 'Budi', number: '0812-3456-7890', notifyWhatsapp: true }]
    mine.links = [{ id: 'l1', name: 'Checkout', kind: 'checkout', url: 'https://toko.example/c', tracking: true }]
    await t.handlers.saveBrandDraft(mine)
    const r = await t.handlers.loadPreset('toko_online')
    expect(r.ok).toBe(true)
    const draft = (await t.handlers.getBrand()).draft
    expect(draft.goal).toBe('checkout')
    expect(draft.businessType).toBe('produk')
    expect(draft.preset).toBe('toko_online')
    expect(draft.identity.businessName).toBe('Kopi Sudut')
    expect(draft.admins).toHaveLength(1)
    expect(draft.links).toHaveLength(1)
  })
  it('rejects an unknown preset id', async () => {
    expect(await setup().handlers.loadPreset('nope')).toMatchObject({ ok: false })
  })
})

describe('previewChat', () => {
  it('runs the draft profile when asked and the active profile otherwise', async () => {
    const t = setup()
    await t.handlers.saveBrandDraft(named('Nama Draf'))
    await t.handlers.previewChat({ draft: true, messages: ['halo'] })
    await t.handlers.previewChat({ draft: false, messages: ['halo'] })
    expect(t.calls[0].system).toContain('Nama Draf')
    expect(t.calls[1].system).not.toContain('Nama Draf')
  })
  it('keeps a temporary memory across the messages of one simulation only', async () => {
    const t = setup()
    t.replies.push(agentOut({ intent: 'sapaan', reply_parts: ['Halo Kak'], sources: [] }))
    const r = await t.handlers.previewChat({ draft: true, messages: ['halo', 'info paket website umkm'] })
    expect(r.ok).toBe(true)
    expect(t.calls[1].user).toContain('pelanggan: halo')
    await t.handlers.previewChat({ draft: true, messages: ['info paket website umkm'] })
    expect(t.calls[2].user).not.toContain('pelanggan: halo')
  })
  it('never touches real conversation data or notifies real admins', async () => {
    const t = setup()
    const p = named('Kerabat Koding')
    p.admins = [{ id: 'a1', name: 'Budi', number: '0812-3456-7890', notifyWhatsapp: true }]
    await t.handlers.saveBrandDraft(p)
    t.replies.push(agentOut({ intent: 'komplain', reply_parts: ['Maaf'], sources: [] }))
    const r = await t.handlers.previewChat({ draft: true, messages: ['barang rusak'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.turns[0].handoff).toEqual({ reason: 'komplain' })
    for (const table of ['turns', 'handoffs', 'events', 'message_log', 'contacts'])
      expect((t.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c, table).toBe(0)
    expect(t.gateway.sent).toEqual([])
  })
  it('shows what the guards removed', async () => {
    const t = setup()
    t.replies.push(agentOut({ reply_parts: ['Harga Rp1,5 juta.', 'Hubungi 0851-1930-8345 ya.'] }))
    const r = await t.handlers.previewChat({ draft: true, messages: ['info paket website umkm'] })
    if (!r.ok) throw new Error('expected ok')
    expect(r.turns[0].removed.numbers).toBe(true)
    expect(r.turns[0].replyParts.join(' ')).not.toMatch(/0851/)
  })
  it('explains when no AI provider is configured', async () => {
    const r = await setup({ provider: false }).handlers.previewChat({ draft: true, messages: ['halo'] })
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/AI/)
  })
  it('rejects empty or oversized message lists', async () => {
    const t = setup()
    expect(await t.handlers.previewChat({ draft: true, messages: [] })).toMatchObject({ ok: false })
    expect(await t.handlers.previewChat({ draft: true, messages: Array.from({ length: 11 }, () => 'halo') })).toMatchObject({ ok: false })
  })
})
