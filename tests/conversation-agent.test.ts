import { describe, it, expect } from 'vitest'
import { openDb } from '../src/main/db'
import { IndexStore } from '../src/main/knowledge/index-store'
import { CatalogStore, type Product } from '../src/main/catalog/catalog-store'
import { ConversationStore } from '../src/main/conversation/store'
import { HandoffService } from '../src/main/conversation/handoff'
import { ConversationAgent } from '../src/main/pipeline/conversation-agent'
import type { AiProvider } from '../src/main/answer/ai-answerer'
import type { WaGateway } from '../src/main/wa/gateway'
import type { ConnStatus, IncomingMessage } from '../src/shared/types'
import { PRESETS, type BrandProfile } from '../src/shared/brand'

const MONDAY_10_WITA = Date.UTC(2026, 10, 16, 2, 0)
const C = '6281999000111@s.whatsapp.net'
const cfg = { model: 'm', maxTokens: 300 }
const UNKNOWN = 'Untuk hal itu saya kurang tahu, Kak. Boleh saya bantu seputar produk atau layanan kami?'

class FakeGateway implements WaGateway {
  sent: { chatId: string; text: string }[] = []
  onMessage(_cb: (m: IncomingMessage) => void): void {}
  onStatus(_cb: (s: ConnStatus) => void): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return '6285119308345' }
  async onWhatsApp(numbers: string[]): Promise<{ number: string; jid: string | null; exists: boolean }[]> {
    return numbers.map((number) => ({ number, jid: `${number}@s.whatsapp.net`, exists: true }))
  }
  jidFor(n: string): string { return `${n.replace(/\D/g, '')}@s.whatsapp.net` }
  async sendText(chatId: string, text: string): Promise<string | null> {
    this.sent.push({ chatId, text })
    return `m${this.sent.length}`
  }
}

const out = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    intent: 'tanya_produk', stage: 'gali', reply_parts: ['ok'], lead_updates: {}, product_id: null,
    suggested_action: 'none', confidence: 0.9, sources: ['faq.md'], ...o
  })

function scripted(outs: (string | Error)[]) {
  const calls: { system: string; user: string }[] = []
  let i = 0
  const provider: AiProvider = {
    complete: async (req) => {
      calls.push({ system: req.system, user: req.user })
      const o = outs[Math.min(i++, outs.length - 1)]
      if (o instanceof Error) throw o
      return o
    }
  }
  return { provider, calls }
}

const PRODUCTS: Product[] = [
  { id: 'website-umkm', name: 'Paket Website UMKM', price: 1500000, description: 'domain hosting desain konten',
    checkoutUrl: 'https://toko.example/checkout/website-umkm', suitableFor: 'kuliner toko', stock: '' },
  { id: 'aplikasi-kasir', name: 'Aplikasi Kasir', price: null, description: 'kasir stok pembukuan',
    checkoutUrl: null, suitableFor: '', stock: '' }
]

function setup(opts: { empty?: boolean } = {}) {
  const clock = { t: MONDAY_10_WITA, now() { return this.t } }
  const db = openDb(':memory:')
  const store = new IndexStore(db)
  const catalog = new CatalogStore(db)
  if (!opts.empty) {
    store.replaceFile('/k/faq.md', 1, [
      'Paket Website UMKM Rp1.500.000 per tahun, sudah termasuk domain dan hosting.',
      'Tanya lewat WhatsApp 0851-1930-8345 untuk info lebih lanjut'
    ])
    catalog.replaceFromFile('/k/katalog.csv', PRODUCTS)
  }
  const conv = new ConversationStore(db, clock)
  const gateway = new FakeGateway()
  const handoff = new HandoffService({ gateway, conv, clock })
  const agent = new ConversationAgent({ store, catalog, conv, handoff, gateway, clock })
  return { clock, db, store, catalog, conv, gateway, handoff, agent }
}

const toko = (): BrandProfile => {
  const p = structuredClone(PRESETS.toko_online)
  p.identity = { ...p.identity, businessName: 'Kopi Sudut', botName: 'Sudi' }
  return p
}
const jasa = (): BrandProfile => {
  const p = structuredClone(PRESETS.jasa_agensi)
  p.identity = { ...p.identity, businessName: 'Kerabat Koding', botName: 'Kebi' }
  p.admins = [{ id: 'a1', name: 'Budi', number: '0812-3456-7890', notifyWhatsapp: true }]
  return p
}
const turn = (t: ReturnType<typeof setup>, profile: BrandProfile, provider: AiProvider, text: string, extra: object = {}) =>
  t.agent.handleTurn({ chatId: C, text, profile, provider, cfg, dryRun: false, ...extra })

describe('product mode: checkout', () => {
  it('sends the product checkout link with tracking once, then not again within 24h', async () => {
    const t = setup()
    const p = scripted([
      out({ intent: 'siap_beli', stage: 'cta', reply_parts: ['Siap Kak, saya kirim linknya ya'], product_id: 'website-umkm', suggested_action: 'send_checkout' })
    ])
    const r = await turn(t, toko(), p.provider, 'mau beli website umkm')
    expect(r.action).toMatchObject({ kind: 'send_checkout', ruleId: 'r3' })
    const last = r.replyParts[r.replyParts.length - 1]
    expect(last).toContain('https://toko.example/checkout/website-umkm')
    expect(last).toContain('utm_source=wa_bot')
    expect(last).toMatch(/ref=[0-9a-f]{8}/)
    expect(r.linkSent).toContain('https://toko.example/checkout/website-umkm')
    expect(t.conv.countEvents(C, 'checkout_sent', 'website-umkm')).toBe(1)

    const r2 = await turn(t, toko(), p.provider, 'oke saya mau')
    expect(r2.linkSent).toBeNull()
    expect(r2.replyParts.join(' ')).not.toContain('https://')
  })
  it('hands off with reason tanpa_tautan when the product has no checkout link', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'siap_beli', product_id: 'aplikasi-kasir', suggested_action: 'send_checkout' })])
    const r = await turn(t, toko(), p.provider, 'mau beli aplikasi kasir')
    expect(r.handoff).toEqual({ reason: 'tanpa_tautan' })
    expect(r.linkSent).toBeNull()
  })
})

describe('service mode: lead then handoff', () => {
  it('collects the lead, then hands off to the admin and pauses the bot', async () => {
    const t = setup()
    const p = scripted([
      out({ intent: 'tanya_produk', stage: 'gali', reply_parts: ['Boleh, ceritakan lebih lanjut ya Kak'], lead_updates: { nama: 'Budi', kebutuhan: 'aplikasi kasir' }, suggested_action: 'ask_more' }),
      out({ intent: 'siap_beli', stage: 'cta', reply_parts: ['Siap Kak'], suggested_action: 'handoff' })
    ])
    const r1 = await turn(t, jasa(), p.provider, 'saya butuh aplikasi kasir, nama saya Budi')
    expect(r1.handoff).toBeNull()
    expect(t.conv.getState(C).lead).toEqual({ nama: 'Budi', kebutuhan: 'aplikasi kasir' })
    expect(t.conv.getState(C).stage).toBe('gali')

    const r2 = await turn(t, jasa(), p.provider, 'oke lanjut')
    expect(r2.action).toMatchObject({ kind: 'handoff', ruleId: 'r4' })
    expect(r2.handoff).toEqual({ reason: 'aturan' })
    expect(r2.replyParts).toHaveLength(1)
    expect(r2.replyParts[0]).toContain('Senin–Jumat')
    expect(t.gateway.sent).toHaveLength(1)
    expect(t.gateway.sent[0].chatId).toBe('6281234567890@s.whatsapp.net')
    expect(t.gateway.sent[0].text).toContain('Budi')
    expect(t.gateway.sent[0].text).toContain('aplikasi kasir')
    expect(t.conv.getState(C).status).toBe('menunggu_admin')
  })
  it('asks the next missing lead question when the customer is ready but data is incomplete', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'siap_beli', reply_parts: ['Baik Kak'], lead_updates: { nama: 'Budi' } })])
    const r = await turn(t, jasa(), p.provider, 'saya mau pesan, nama Budi')
    expect(r.action).toMatchObject({ kind: 'ask_lead', ruleId: 'r5' })
    expect(r.replyParts[r.replyParts.length - 1]).toBe('Kakak butuh apa dan untuk usaha apa?')
  })
})

describe('forced handoff', () => {
  it('hands off on a complaint whatever the model suggests', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'komplain', reply_parts: ['Maaf ya Kak'], suggested_action: 'none' })])
    const r = await turn(t, jasa(), p.provider, 'barang saya rusak')
    expect(r.action).toMatchObject({ kind: 'handoff', forced: true, reason: 'komplain' })
    expect(t.gateway.sent).toHaveLength(1)
  })
  it('hands off on the second consecutive low-confidence turn', async () => {
    const t = setup()
    const p = scripted([out({ confidence: 0.3 })])
    const r1 = await turn(t, toko(), p.provider, 'hmm apa ya')
    expect(r1.handoff).toBeNull()
    expect(t.conv.getState(C).lowConfidenceStreak).toBe(1)
    const r2 = await turn(t, toko(), p.provider, 'itu lho yang kemarin')
    expect(r2.action).toMatchObject({ kind: 'handoff', forced: true, reason: 'keyakinan_rendah' })
  })
})

describe('output guards', () => {
  it('never lets the bot number reach the customer', async () => {
    const t = setup()
    const p = scripted([out({ reply_parts: ['Harga Rp1,5 juta per tahun.', 'Hubungi WhatsApp 0851-1930-8345 ya Kak.'] })])
    const r = await turn(t, toko(), p.provider, 'berapa harga website umkm?')
    const all = r.replyParts.join(' ')
    expect(all).not.toMatch(/0851|8345|85119308345/)
    expect(all).toContain('Rp1,5 juta')
    expect(r.removed.numbers).toBe(true)
  })
  it('removes urls that are not on the allowlist and keeps allowlisted ones', async () => {
    const t = setup()
    const p = scripted([out({ reply_parts: ['Bayar di http://evil.test/pay ya.', 'Detail di https://toko.example/checkout/website-umkm'] })])
    const r = await turn(t, toko(), p.provider, 'info paket website umkm dong')
    const all = r.replyParts.join(' ')
    expect(all).not.toContain('evil.test')
    expect(all).toContain('https://toko.example/checkout/website-umkm')
    expect(r.removed.urls).toEqual(['http://evil.test/pay'])
  })
  it('replaces an answer with an invented price by the unknown template', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'tanya_harga', reply_parts: ['Harganya Rp2.000.000 per tahun Kak'] })])
    const r = await turn(t, toko(), p.provider, 'berapa harga website umkm?')
    expect(r.replyParts).toEqual([UNKNOWN])
    expect(r.removed.numbersUnknown).toEqual(['2000000'])
  })
  it('hands off instead when a service business answer contains an invented price', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'tanya_harga', reply_parts: ['Harganya Rp2.000.000 Kak'] })])
    const r = await turn(t, jasa(), p.provider, 'berapa harga website umkm?')
    expect(r.action).toMatchObject({ kind: 'handoff', forced: true, reason: 'angka_tak_dikenal' })
    expect(r.replyParts.join(' ')).not.toContain('2.000.000')
  })
  it('does not trust the model text for out-of-context questions', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'di_luar_konteks', reply_parts: ['Presiden RI adalah Pak Anu'], sources: [], confidence: 0.8 })])
    const r = await turn(t, toko(), p.provider, 'siapa presiden indonesia?')
    expect(r.replyParts).toEqual([UNKNOWN])
  })
  it('answers greetings and thanks naturally instead of staying silent', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'sapaan', reply_parts: ['Halo Kak! Ada yang bisa dibantu?'], sources: [] })])
    const r = await turn(t, toko(), p.provider, 'halo')
    expect(r.replyParts).toEqual(['Halo Kak! Ada yang bisa dibantu?'])
  })
  it('falls back to the unknown template when a factual answer has nothing to be grounded on', async () => {
    const t = setup({ empty: true })
    const p = scripted([out({ intent: 'tanya_harga', reply_parts: ['Harganya Rp50.000 Kak'], sources: [] })])
    const r = await turn(t, toko(), p.provider, 'berapa harga kopi?')
    expect(r.replyParts).toEqual([UNKNOWN])
  })
})

describe('prompt content', () => {
  it('never shows the model the bot number or website-only calls to action', async () => {
    const t = setup()
    const p = scripted([out()])
    await turn(t, toko(), p.provider, 'berapa harga website umkm?')
    const user = p.calls[0].user
    expect(user).toContain('Paket Website UMKM')
    expect(user).not.toMatch(/0851|8345/)
    expect(user).not.toContain('Tanya lewat WhatsApp')
  })
  it('passes earlier turns of the conversation as history', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'sapaan', reply_parts: ['Halo Kak! Ada yang bisa dibantu?'], sources: [] }), out()])
    await turn(t, toko(), p.provider, 'halo')
    await turn(t, toko(), p.provider, 'yang paket umkm berapa?')
    expect(p.calls[1].user).toContain('pelanggan: halo')
    expect(p.calls[1].user).toContain('bot: Halo Kak! Ada yang bisa dibantu?')
  })
})

describe('failures never reach the customer', () => {
  const e401 = Object.assign(new Error('unauthorized'), { status: 401 })
  for (const [name, o] of [['non-json output', 'bukan json sama sekali'], ['truncated json', '{"intent":"tanya_pro'], ['provider auth error', e401]] as const) {
    it(`service mode hands off with ai_gagal on ${name}`, async () => {
      const t = setup()
      const r = await turn(t, jasa(), scripted([o]).provider, 'halo mau tanya')
      expect(r.fallback).toBe(true)
      expect(r.handoff).toEqual({ reason: 'ai_gagal' })
      expect(r.replyParts.join(' ')).not.toMatch(/\{|json|error/i)
      expect(t.gateway.sent).toHaveLength(1)
    })
    it(`product mode answers with the unknown template on ${name}`, async () => {
      const t = setup()
      const r = await turn(t, toko(), scripted([o]).provider, 'halo mau tanya')
      expect(r.fallback).toBe(true)
      expect(r.replyParts).toEqual([UNKNOWN])
      expect(r.handoff).toBeNull()
    })
  }
  it('times out cleanly when the provider never answers', async () => {
    const t = setup()
    const hang: AiProvider = { complete: () => new Promise(() => undefined) }
    const r = await turn(t, toko(), hang, 'halo', { timeoutMs: 30 })
    expect(r.fallback).toBe(true)
    expect(r.replyParts).toEqual([UNKNOWN])
  })
})

describe('dry run', () => {
  it('shows the handoff without any side effect', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'komplain', reply_parts: ['Maaf ya Kak'], lead_updates: { nama: 'Budi' } })])
    const r = await turn(t, jasa(), p.provider, 'barang rusak', { dryRun: true })
    expect(r.handoff).toEqual({ reason: 'komplain' })
    expect(r.replyParts[0]).toContain('Senin')
    expect(t.gateway.sent).toEqual([])
    expect(t.conv.getState(C).status).toBe('bot')
    expect(t.conv.getState(C).lead).toEqual({})
    expect(t.conv.recentTurns(C, 10)).toEqual([])
    expect(t.conv.countEvents(C, 'handoff')).toBe(0)
  })
  it('does not record checkout events or turns', async () => {
    const t = setup()
    const p = scripted([out({ intent: 'siap_beli', product_id: 'website-umkm', suggested_action: 'send_checkout' })])
    const r = await turn(t, toko(), p.provider, 'mau beli', { dryRun: true })
    expect(r.linkSent).toContain('https://toko.example/checkout/website-umkm')
    expect(t.conv.countEvents(C, 'checkout_sent')).toBe(0)
    expect(t.conv.recentTurns(C, 10)).toEqual([])
  })
})
