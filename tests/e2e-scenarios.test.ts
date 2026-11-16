import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { openDb } from '../src/main/db'
import { IndexStore } from '../src/main/knowledge/index-store'
import { loadDocument } from '../src/main/knowledge/loaders'
import { chunkText } from '../src/main/knowledge/chunker'
import { CatalogStore, parseCatalog } from '../src/main/catalog/catalog-store'
import { ConversationStore } from '../src/main/conversation/store'
import { HandoffService } from '../src/main/conversation/handoff'
import { ConversationAgent } from '../src/main/pipeline/conversation-agent'
import { ReplyPipeline } from '../src/main/pipeline/reply-pipeline'
import { SettingsStore } from '../src/main/settings'
import type { AiProvider } from '../src/main/answer/ai-answerer'
import type { WaGateway } from '../src/main/wa/gateway'
import type { ConnStatus, IncomingMessage } from '../src/shared/types'
import { PRESETS, type BrandProfile } from '../src/shared/brand'

const KB = join(__dirname, '..', 'knowledge', 'kerabat-koding')
const BOT = '6285119308345'
const CUSTOMER = '6281999000111@s.whatsapp.net'
const ADMIN_JID = '6281234567890@s.whatsapp.net'
const HOUR = 3_600_000
const FORBIDDEN = /0851|8345|6285119308345|lewat whatsapp/i

class FakeGateway implements WaGateway {
  sent: { chatId: string; text: string }[] = []
  onMessage(_cb: (m: IncomingMessage) => void): void {}
  onStatus(_cb: (s: ConnStatus) => void): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return BOT }
  jidFor(n: string): string { return `${n.replace(/\D/g, '')}@s.whatsapp.net` }
  async sendText(chatId: string, text: string): Promise<string | null> {
    this.sent.push({ chatId, text })
    return `m${this.sent.length}`
  }
  toCustomers() { return this.sent.filter((s) => s.chatId === CUSTOMER).map((s) => s.text) }
}

const out = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    intent: 'tanya_produk', stage: 'gali', reply_parts: ['ok'], lead_updates: {}, product_id: null,
    suggested_action: 'none', confidence: 0.9, sources: ['01-paket-website-umkm.md'], ...o
  })

async function setup(businessType: 'produk' | 'jasa', replies: string[]) {
  const clock = { t: Date.UTC(2026, 10, 16, 2, 0), now() { return this.t } }
  const db = openDb(':memory:')
  const store = new IndexStore(db)
  const catalog = new CatalogStore(db)
  for (const name of readdirSync(KB)) {
    const file = join(KB, name)
    const ext = extname(name)
    const { text } = await loadDocument(file)
    store.replaceFile(file, 1, chunkText(text))
    if (name === 'katalog.csv') {
      const { products } = parseCatalog(readFileSync(file, 'utf8'), '.csv')
      // The real catalog has no checkout links (services); give the product shop scenario one.
      catalog.replaceFromFile(file, products.map((p) =>
        p.id === 'website-umkm' ? { ...p, checkoutUrl: 'https://toko.example/checkout/website-umkm' } : p))
    }
    void ext
  }
  const prompts: { system: string; user: string }[] = []
  let i = 0
  const provider: AiProvider = {
    complete: async (req) => {
      prompts.push({ system: req.system, user: req.user })
      return replies[Math.min(i++, replies.length - 1)]
    }
  }
  const gateway = new FakeGateway()
  const conv = new ConversationStore(db, clock)
  const handoff = new HandoffService({ gateway, conv, clock })
  const agent = new ConversationAgent({ store, catalog, conv, handoff, gateway, clock })
  const settings = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'wa-e2e-')), 's.json'))
  settings.update({ mode: 'ai' })

  const base = structuredClone(businessType === 'produk' ? PRESETS.toko_online : PRESETS.jasa_agensi)
  const brand: BrandProfile = {
    ...base,
    identity: { ...base.identity, businessName: 'Kerabat Koding', botName: 'Kebi' },
    admins: [{ id: 'a1', name: 'Budi', number: '0812-3456-7890', notifyWhatsapp: true }]
  }
  const pipeline = new ReplyPipeline({
    gateway, store, settings, db, ai: () => provider, clock, rand: () => 0.5, conv, brand: () => brand, agent
  })
  let n = 0
  const msg = (text: string, o: Partial<IncomingMessage> = {}): IncomingMessage => ({
    id: `c${++n}`, chatId: CUSTOMER, sender: CUSTOMER, isGroup: false, fromMe: false, text, timestamp: clock.now(), ...o
  })
  return { clock, gateway, pipeline, prompts, msg, conv }
}

describe('end to end: product shop', () => {
  it('answers a price question from the real knowledge files, then sends the checkout link once', async () => {
    const t = await setup('produk', [
      out({ intent: 'tanya_harga', stage: 'harga', product_id: 'website-umkm',
        reply_parts: ['Paket Website UMKM Rp1,5 juta per tahun ya Kak, sudah termasuk domain dan hosting.'] }),
      out({ intent: 'siap_beli', stage: 'cta', product_id: 'website-umkm', suggested_action: 'send_checkout', reply_parts: ['Siap Kak!'] })
    ])
    const r1 = await t.pipeline.handle(t.msg('berapa harga paket website umkm?'))
    expect(r1).toMatchObject({ kind: 'replied', via: 'ai' })
    expect(t.prompts[0].user).toContain('harga="1500000"')
    t.clock.t += 5000
    const r2 = await t.pipeline.handle(t.msg('oke saya mau pesan'))
    expect(r2).toMatchObject({ kind: 'replied', via: 'ai' })
    const texts = t.gateway.toCustomers()
    expect(texts.filter((s) => s.includes('https://toko.example/checkout/website-umkm'))).toHaveLength(1)
    expect(texts.join('\n')).toContain('utm_source=wa_bot')
  })
})

describe('end to end: service business', () => {
  it('qualifies the lead, hands off to the admin, then stays silent until the pause ends', async () => {
    const t = await setup('jasa', [
      out({ intent: 'tanya_produk', stage: 'gali', reply_parts: ['Bisa Kak, aplikasi kasir untuk toko ya. Boleh tahu nama Kakak?'],
        lead_updates: { kebutuhan: 'aplikasi kasir untuk toko' }, sources: ['05-aplikasi-custom-untuk-usaha.md'] }),
      out({ intent: 'siap_beli', stage: 'cta', reply_parts: ['Siap Pak Budi'], lead_updates: { nama: 'Budi' }, sources: [] }),
      out({ intent: 'sapaan', reply_parts: ['Halo lagi Kak!'], sources: [] })
    ])
    expect(await t.pipeline.handle(t.msg('mau bikin aplikasi kasir untuk toko saya'))).toMatchObject({ kind: 'replied' })
    t.clock.t += 5000
    expect(await t.pipeline.handle(t.msg('nama saya Budi, oke lanjut'))).toEqual({ kind: 'handoff', reason: 'aturan' })

    const adminMsgs = t.gateway.sent.filter((s) => s.chatId === ADMIN_JID)
    expect(adminMsgs).toHaveLength(1)
    expect(adminMsgs[0].text).toContain('Budi')
    expect(adminMsgs[0].text).toContain('aplikasi kasir untuk toko')

    // The bot stays quiet while the team handles the chat.
    t.clock.t += 5000
    expect(await t.pipeline.handle(t.msg('halo, ada kabar?'))).toEqual({ kind: 'ignored', why: 'human' })
    t.clock.t += 6 * HOUR + 60_000
    expect(await t.pipeline.handle(t.msg('halo lagi'))).toMatchObject({ kind: 'replied' })
  })

  it('pauses when the admin types from the phone and resumes six hours later', async () => {
    const t = await setup('jasa', [out({ intent: 'sapaan', reply_parts: ['Halo Kak!'], sources: [] })])
    await t.pipeline.handle(t.msg('halo'))
    t.clock.t += 5000
    await t.pipeline.handle(t.msg('saya admin, ada yang bisa dibantu', { fromMe: true, id: 'HP-ADMIN-1' }))
    t.clock.t += 5000
    expect(await t.pipeline.handle(t.msg('terima kasih admin'))).toEqual({ kind: 'ignored', why: 'human' })
    t.clock.t += 6 * HOUR + 60_000
    expect(await t.pipeline.handle(t.msg('halo kak'))).toMatchObject({ kind: 'replied' })
  })
})

describe('end to end: the bot never sends the customer to its own number', () => {
  const adversarial = [
    out({ intent: 'tanya_harga', reply_parts: [
      'Paket Website UMKM Rp1,5 juta per tahun.', 'Silakan hubungi kami lewat WhatsApp 0851-1930-8345 ya Kak.'] }),
    out({ intent: 'tanya_produk', reply_parts: ['Bisa Kak. Konsultasi gratis lewat WhatsApp.', 'Atau chat ke wa.me/6285119308345'] }),
    out({ intent: 'tanya_produk', reply_parts: ['Boleh Kak, untuk detail lain tanyakan lewat WhatsApp ke nomor +62 851 1930 8345.'] })
  ]
  it('filters numbers and "contact us on WhatsApp" calls to action from every reply', async () => {
    const t = await setup('produk', adversarial)
    for (const text of ['berapa harga website umkm?', 'info paket website umkm dong', 'ada layanan website lain?']) {
      await t.pipeline.handle(t.msg(text))
      t.clock.t += 5000
    }
    const texts = t.gateway.toCustomers()
    expect(texts.length).toBeGreaterThan(0)
    for (const s of texts) expect(s).not.toMatch(FORBIDDEN)
  })
  it('never shows the model the bot number or website-only calls to action', async () => {
    const t = await setup('produk', adversarial)
    for (const text of ['berapa harga website umkm?', 'bagaimana cara memesan website umkm?', 'info kontak kerabat koding?']) {
      await t.pipeline.handle(t.msg(text))
      t.clock.t += 5000
    }
    for (const p of t.prompts) expect(p.user).not.toMatch(FORBIDDEN)
    expect(t.prompts[0].user).toContain('harga="1500000"')
  })
})
