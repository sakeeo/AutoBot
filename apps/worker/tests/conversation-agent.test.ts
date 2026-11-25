import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'
import { IndexStore } from '../src/knowledge/index-store'
import { CatalogStore, type Product } from '../src/catalog/catalog-store'
import { ConversationStore } from '../src/conversation/store'
import { HandoffService } from '../src/conversation/handoff'
import { ConversationAgent } from '../src/pipeline/conversation-agent'
import type { AiProvider } from '../src/answer/ai-answerer'
import type { WaGateway } from '../src/wa/gateway'
import type { ConnStatus, IncomingMessage } from '@autobot/contracts/types'
import { PRESETS, type BrandProfile } from '@autobot/contracts/brand'

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
  const agent = new ConversationAgent({ store, catalog, conv, handoff, gateway, clock, retryDelaysMs: [0, 0] })
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

describe('retrieval uses the conversation so far', () => {
  it('finds documents for a follow-up that has no topic words of its own', async () => {
    const t = setup()
    t.conv.appendTurn(C, 'user', 'berapa harga paket website umkm')
    t.conv.appendTurn(C, 'bot', 'Paket Website UMKM ada ya Kak, mau saya jelaskan?')
    const p = scripted([out({ reply_parts: ['ok'] })])
    await turn(t, toko(), p.provider, 'yang itu berapa ya')
    expect(p.calls[0].user).toContain('Rp1.500.000 per tahun')
  })
  it('keeps the message own hits first when it already matches the documents', async () => {
    const t = setup()
    t.conv.appendTurn(C, 'user', 'halo')
    const p = scripted([out({ reply_parts: ['ok'] })])
    await turn(t, toko(), p.provider, 'domain dan hosting')
    expect(p.calls[0].user).toContain('sudah termasuk domain dan hosting')
  })
})

describe('memory', () => {
  const upd = (u: unknown) => out({ reply_parts: ['ok'], intent: 'sapaan', sources: [], memory_updates: u })
  it('stores new facts after a turn, replaces changed ones and forgets with null', async () => {
    const t = setup()
    await turn(t, toko(), scripted([upd({ budget: 'sekitar 5 juta', kota: 'Palu' })]).provider, 'halo')
    expect(t.conv.getMemory(C).facts).toEqual({ budget: 'sekitar 5 juta', kota: 'Palu' })
    await turn(t, toko(), scripted([upd({ budget: 'sekitar 7 juta', kota: null })]).provider, 'budget saya naik')
    expect(t.conv.getMemory(C).facts).toEqual({ budget: 'sekitar 7 juta' })
  })
  it('ignores a malformed memory_updates and still replies', async () => {
    const t = setup()
    const r = await turn(t, toko(), scripted([upd('rusak')]).provider, 'halo')
    expect(r.fallback).toBe(false)
    expect(r.replyParts).toEqual(['ok'])
    expect(t.conv.getMemory(C).facts).toEqual({})
  })
  it('writes nothing on a dry run, and nothing is read or written when memory is off', async () => {
    const t = setup()
    t.conv.setFacts(C, { budget: '5 juta' })
    const dry = scripted([upd({ kota: 'Palu' })])
    await turn(t, toko(), dry.provider, 'halo', { dryRun: true })
    expect(t.conv.getMemory(C).facts).toEqual({ budget: '5 juta' })
    expect(dry.calls[0].user).toContain('budget: 5 juta')
    const off = scripted([upd({ kota: 'Palu' })])
    await turn(t, toko(), off.provider, 'halo', { memory: false })
    expect(off.calls[0].user).not.toContain('<memori>')
    expect(t.conv.getMemory(C).facts).toEqual({ budget: '5 juta' })
  })
  it('shows the saved summary and facts, and only turns after the fold, each trimmed to 400 characters', async () => {
    const t = setup()
    for (let i = 1; i <= 14; i++) t.conv.appendTurn(C, i % 2 ? 'user' : 'bot', i === 14 ? 'z'.repeat(900) : `pesan ke-${i}`)
    const ids = t.conv.unsummarizedTurns(C)
    t.conv.setSummary(C, 'Pelanggan tanya paket website UMKM.', ids[3].id)
    t.conv.setFacts(C, { budget: 'sekitar 5 juta' })
    const p = scripted([upd({})])
    await turn(t, toko(), p.provider, 'lanjut ya')
    const u = p.calls[0].user
    expect(u).toContain('<ringkasan>Pelanggan tanya paket website UMKM.</ringkasan>')
    expect(u).toContain('budget: sekitar 5 juta')
    expect(u).not.toContain('pesan ke-4')
    expect(u).toContain('pesan ke-5')
    expect(u).toContain('z'.repeat(400))
    expect(u).not.toContain('z'.repeat(401))
  })
})

describe('memory: folding old turns into the summary', () => {
  const fill = (t: ReturnType<typeof setup>, n: number, step = 1000) => {
    for (let i = 1; i <= n; i++) { t.conv.appendTurn(C, i % 2 ? 'user' : 'bot', `pesan ${i}`); t.clock.t += step }
  }
  const summarizer = (reply: string | Error) => scripted([reply])
  const cfgM = { model: 'm' }
  const HOUR = 3_600_000

  it('writes a summary when there are more than sixteen unsummarised turns, keeping the newest ten', async () => {
    const t = setup()
    fill(t, 20)
    const s = summarizer('Pelanggan tanya paket website.')
    expect(await t.agent.maybeFold({ chatId: C, provider: s.provider, cfg: cfgM })).toBe(true)
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].user).toContain('pesan 10')
    expect(s.calls[0].user).not.toContain('pesan 11')
    const m = t.conv.getMemory(C)
    expect(m.summary).toBe('Pelanggan tanya paket website.')
    expect(t.conv.unsummarizedTurns(C).map((x) => x.text)).toEqual(Array.from({ length: 10 }, (_, i) => `pesan ${i + 11}`))
  })
  it('does not call the provider for a normal-length chat', async () => {
    const t = setup()
    fill(t, 12)
    const s = summarizer('x')
    expect(await t.agent.maybeFold({ chatId: C, provider: s.provider, cfg: cfgM })).toBe(false)
    expect(s.calls).toHaveLength(0)
  })
  it('folds the earlier visit after a silence of six hours or more', async () => {
    const t = setup()
    fill(t, 4)
    t.clock.t += 7 * HOUR
    fill(t, 2)
    const s = summarizer('Kunjungan lama: tanya harga.')
    expect(await t.agent.maybeFold({ chatId: C, provider: s.provider, cfg: cfgM })).toBe(true)
    expect(t.conv.unsummarizedTurns(C).map((x) => x.text)).toEqual(['pesan 1', 'pesan 2'])
  })
  it('on failure changes nothing, never throws, and the next call can succeed', async () => {
    const t = setup()
    fill(t, 20)
    expect(await t.agent.maybeFold({ chatId: C, provider: summarizer(new Error('down')).provider, cfg: cfgM })).toBe(false)
    expect(await t.agent.maybeFold({ chatId: C, provider: summarizer('   ').provider, cfg: cfgM })).toBe(false)
    expect(t.conv.getMemory(C)).toEqual({ summary: '', facts: {}, summarizedUpTo: 0 })
    expect(t.conv.unsummarizedTurns(C)).toHaveLength(20)
    expect(await t.agent.maybeFold({ chatId: C, provider: summarizer('ok').provider, cfg: cfgM })).toBe(true)
  })
  it('runs one summary at a time per chat', async () => {
    const t = setup()
    fill(t, 20)
    let release!: (v: string) => void
    let calls = 0
    const slow: AiProvider = { complete: () => { calls++; return new Promise<string>((r) => { release = r }) } }
    const first = t.agent.maybeFold({ chatId: C, provider: slow, cfg: cfgM })
    expect(await t.agent.maybeFold({ chatId: C, provider: slow, cfg: cfgM })).toBe(false)
    release('selesai')
    expect(await first).toBe(true)
    expect(calls).toBe(1)
  })
})

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
    it(`product mode hands off too, after the same retries, on ${name}`, async () => {
      const t = setup()
      const r = await turn(t, toko(), scripted([o]).provider, 'halo mau tanya')
      expect(r.fallback).toBe(true)
      expect(r.handoff).toEqual({ reason: 'ai_gagal' })
      expect(r.replyParts).not.toEqual([UNKNOWN])
    })
  }
  it('times out cleanly when the provider never answers', async () => {
    const t = setup()
    const hang: AiProvider = { complete: () => new Promise(() => undefined) }
    const r = await turn(t, toko(), hang, 'halo', { timeoutMs: 30 })
    expect(r.fallback).toBe(true)
    expect(r.fallbackReason).toBe('timeout')
    expect(r.attempts).toBe(3)
    expect(r.handoff).toEqual({ reason: 'ai_gagal' })
  })
  it('tries three times with a pause between, and a later success is used without any handoff', async () => {
    const t = setup()
    const s = scripted([new Error('network down'), 'bukan json', out({ reply_parts: ['Halo Kak, ada yang bisa dibantu?'], intent: 'sapaan', sources: [] })])
    const r = await turn(t, toko(), s.provider, 'halo')
    expect(s.calls).toHaveLength(3)
    expect(r.fallback).toBe(false)
    expect(r.handoff).toBeNull()
    expect(r.replyParts).toEqual(['Halo Kak, ada yang bisa dibantu?'])
  })
  it('hands off to the admin only after three failed attempts in a row', async () => {
    const t = setup()
    const s = scripted([new Error('network down')])
    const r = await turn(t, jasa(), s.provider, 'halo')
    expect(s.calls).toHaveLength(3)
    expect(r.attempts).toBe(3)
    expect(r.handoff).toEqual({ reason: 'ai_gagal' })
    expect(t.gateway.sent.length).toBeGreaterThan(0)
  })
  it('does not retry a rejected key', async () => {
    const t = setup()
    const s = scripted([e401])
    const r = await turn(t, toko(), s.provider, 'halo')
    expect(s.calls).toHaveLength(1)
    expect(r.attempts).toBe(1)
    expect(r.fallbackReason).toBe('auth')
  })
  it('waits the configured pause between attempts', async () => {
    const t = setup()
    const slow = new ConversationAgent({
      store: t.store, catalog: t.catalog, conv: t.conv, handoff: t.handoff, gateway: t.gateway, clock: t.clock, retryDelaysMs: [40, 40]
    })
    const s = scripted([new Error('network down')])
    const started = Date.now()
    await slow.handleTurn({ chatId: 'c1', text: 'halo', profile: toko(), provider: s.provider, cfg: { model: 'm', maxTokens: 100 }, dryRun: true })
    expect(Date.now() - started).toBeGreaterThanOrEqual(70)
    expect(s.calls).toHaveLength(3)
  })
  it('says why the fallback was used: unusable output vs rejected key', async () => {
    const t = setup()
    expect((await turn(t, toko(), scripted(['{"intent":"tanya_pro']).provider, 'halo')).fallbackReason).toBe('unusable')
    expect((await turn(t, toko(), scripted([e401]).provider, 'halo')).fallbackReason).toBe('auth')
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
