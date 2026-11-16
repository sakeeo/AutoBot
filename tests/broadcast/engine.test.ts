import { describe, it, expect } from 'vitest'
import { openDb } from '../../src/main/db'
import { BroadcastStore } from '../../src/main/broadcast/store'
import { BroadcastEngine, type SafetySettings } from '../../src/main/broadcast/engine'
import { MessageFeed } from '../../src/main/messages/message-feed'
import { ConversationStore } from '../../src/main/conversation/store'
import { OPTOUT_FOOTER } from '../../src/main/broadcast/lint'
import type { WaGateway } from '../../src/main/wa/gateway'
import type { Db } from '../../src/main/db'

const W = { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }
const DAY = 86_400_000
const at = (h: number, m = 0, day = 16) => Date.UTC(2026, 10, day, h - 8, m) // Monday, UTC+8

class Gw implements WaGateway {
  sent: { chatId: string; text: string; typingMs?: number }[] = []
  fail = false
  onMessage(): void {}
  onStatus(): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return '6285119308345' }
  jidFor(n: string): string { return `${n}@s.whatsapp.net` }
  async onWhatsApp(ns: string[]) { return ns.map((number) => ({ number, jid: `${number}@s.whatsapp.net`, exists: true })) }
  async sendText(chatId: string, text: string, opts?: { typingMs?: number }): Promise<string | null> {
    if (this.fail) throw new Error('send failed')
    this.sent.push({ chatId, text, typingMs: opts?.typingMs })
    return `W${this.sent.length}`
  }
}

function setup(over: { age?: number; start?: number; db?: Db } = {}) {
  const db = over.db ?? openDb(':memory:')
  const clock = { t: over.start ?? at(12), now() { return this.t } }
  const store = new BroadcastStore(db, clock)
  const gateway = new Gw()
  const feed = new MessageFeed(db, clock)
  const conv = new ConversationStore(db, clock)
  const flags = { busy: false, connected: true }
  const settings: SafetySettings = { enabled: true, ageDays: over.age ?? 365, declaredAt: clock.t, window: W, minGapDays: 7 }
  const engine = new BroadcastEngine({
    store, gateway, feed, conv, clock, rand: () => 0,
    isBusy: () => flags.busy, connected: () => flags.connected, settings: () => settings, businessName: () => 'Kopi Sudut'
  })
  const people = (count: number, o: { source?: 'chat' | 'impor'; status?: 'aktif' | 'menunggu_persetujuan' } = {}) =>
    Array.from({ length: count }, (_, i) => {
      const number = `62812${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}${String(i).padStart(5, '0')}`
      return store.upsertContact({ number, jid: `${number}@s.whatsapp.net`, name: `Nama${i}`, source: o.source ?? 'chat', status: o.status ?? 'aktif' })
    })
  const campaign = (o: { kind?: 'broadcast' | 'konfirmasi'; audience?: 'chat' | 'impor' | 'semua'; template?: string } = {}) =>
    store.createCampaign({ name: 'Uji', kind: o.kind ?? 'broadcast', template: o.template ?? 'Halo {nama}, ini {bisnis}: ada menu baru.', audience: o.audience ?? 'semua' })
  /** Tick once a second until `ms` of fake time has passed (or nothing more can happen). */
  const run = async (ms: number, step = 2000, e: BroadcastEngine = engine) => {
    const end = clock.t + ms
    while (clock.t < end) { await e.tick(); clock.t += step }
  }
  /** Pretend the number was already used for `days` earlier days, so the warm-up cap has grown. */
  const warmedUp = (days: number) => {
    const other = store.upsertContact({ number: '628999999999', jid: '628999999999@s.whatsapp.net', source: 'chat', status: 'aktif' })
    for (let d = 1; d <= days; d++)
      db.prepare("INSERT INTO broadcast_sends(campaign_id, contact_id, status, sent_at, created_at) VALUES (999, ?, 'terkirim', ?, ?)")
        .run(other.id, at(12, 0, 16 - d), at(12, 0, 16 - d))
  }
  return { db, clock, store, gateway, feed, conv, flags, settings, engine, people, campaign, run, warmedUp }
}

describe('BroadcastEngine pacing and content', () => {
  it('sends one message at a time with a 20–60 s gap, typing first, and records each send', async () => {
    const t = setup()
    t.people(3)
    const c = t.campaign()
    t.engine.start(c.id)
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(1)
    expect(t.gateway.sent[0].typingMs).toBeGreaterThanOrEqual(2000)
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(1)
    t.clock.t += 19_000
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(1)
    t.clock.t += 1_000
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(2)
  })
  it('renders the template, always ends with the opt-out sentence, and names the business', async () => {
    const t = setup()
    t.people(1)
    t.engine.start(t.campaign().id)
    await t.engine.tick()
    const text = t.gateway.sent[0].text
    expect(text).toMatch(/^Halo Nama0, ini Kopi Sudut/)
    expect(text.endsWith(OPTOUT_FOOTER)).toBe(true)
  })
  it('records the send in the feed and remembers its id so the echo is not mistaken for a human', async () => {
    const t = setup()
    const [p] = t.people(1)
    t.engine.start(t.campaign().id)
    await t.engine.tick()
    expect(t.feed.thread(p.jid!).map((m) => m.direction)).toEqual(['out'])
    expect(t.conv.isSentId('W1')).toBe(true)
  })
  it('pauses for 3–8 minutes after every 10 messages', async () => {
    const t = setup()
    t.warmedUp(4) // day 5: the warm-up cap is no longer the limit
    t.people(14)
    t.engine.start(t.campaign().id)
    await t.run(260_000)
    expect(t.gateway.sent).toHaveLength(10)
    await t.run(60_000) // still inside the 3-minute batch pause
    expect(t.gateway.sent).toHaveLength(10)
    await t.run(100_000)
    expect(t.gateway.sent.length).toBeGreaterThan(10)
  })
})

describe('BroadcastEngine: who is messaged', () => {
  it('never messages someone who opted out after the campaign was created', async () => {
    const t = setup()
    const [a, b] = t.people(2)
    const c = t.campaign()
    t.engine.start(c.id)
    t.store.suppress({ number: a.number, jid: a.jid, reason: 'berhenti' })
    await t.run(120_000)
    expect(t.gateway.sent.map((s) => s.chatId)).toEqual([b.jid])
    expect(t.db.prepare("SELECT reason FROM broadcast_sends WHERE status = 'dilewati'").all()).toEqual([{ reason: 'tolak' }])
  })
  it('a broadcast never queues people who have not confirmed; a confirmation campaign does', async () => {
    const t = setup()
    t.people(2, { source: 'impor', status: 'menunggu_persetujuan' })
    t.people(1)
    const b = t.campaign({ kind: 'broadcast' })
    expect(t.store.enqueue(b.id)).toBe(1)
    const k = t.campaign({ kind: 'konfirmasi', template: 'Halo {nama}, ini {bisnis}. Nomor Anda terdaftar di formulir kami. Balas YA untuk menerima info.' })
    expect(t.store.enqueue(k.id)).toBe(2)
  })
  it('sends a confirmation to a pending contact', async () => {
    const t = setup()
    const [p] = t.people(1, { source: 'impor', status: 'menunggu_persetujuan' })
    t.engine.start(t.campaign({ kind: 'konfirmasi', audience: 'impor' }).id)
    await t.engine.tick()
    expect(t.gateway.sent.map((s) => s.chatId)).toEqual([p.jid])
  })
  it('skips someone messaged less than the minimum gap ago', async () => {
    const t = setup()
    const [p] = t.people(1)
    const first = t.campaign()
    t.engine.start(first.id)
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(1)
    t.clock.t += 2 * DAY
    const second = t.campaign()
    t.engine.start(second.id)
    await t.run(5_000)
    expect(t.gateway.sent).toHaveLength(1)
    expect(t.db.prepare("SELECT reason FROM broadcast_sends WHERE status = 'dilewati'").all()).toEqual([{ reason: 'terlalu_cepat' }])
    expect(p.id).toBeGreaterThan(0)
  })
})

describe('BroadcastEngine: daily limits and the send window', () => {
  it('warms up: only 10 on the first active day even for an old number, more the next day, and survives a restart', async () => {
    const t = setup()
    t.people(30)
    const c = t.campaign()
    t.engine.start(c.id)
    await t.run(60 * 60_000, 5000)
    expect(t.gateway.sent).toHaveLength(10)

    // Restart: fresh engine on the same database. The campaign must come back paused, and the cap must still hold.
    const engine2 = new BroadcastEngine({
      store: new BroadcastStore(t.db, t.clock), gateway: t.gateway, feed: t.feed, conv: t.conv, clock: t.clock, rand: () => 0,
      isBusy: () => false, connected: () => true, settings: () => t.settings, businessName: () => 'Kopi Sudut'
    })
    engine2.resetAfterRestart()
    expect(t.store.getCampaign(c.id)!.status).toBe('dijeda')
    await engine2.tick()
    expect(t.gateway.sent).toHaveLength(10)
    engine2.start(c.id)
    await t.run(10 * 60_000, 5000, engine2)
    expect(t.gateway.sent).toHaveLength(10)

    t.clock.t = at(9, 0, 17)
    await t.run(30 * 60_000, 5000, engine2)
    expect(t.gateway.sent).toHaveLength(22) // day 2 warm-up cap is 12
  })
  it('does not send outside the send window, and starts when it opens', async () => {
    const t = setup({ start: at(22) })
    t.people(2)
    t.engine.start(t.campaign().id)
    await t.run(30_000)
    expect(t.gateway.sent).toHaveLength(0)
    t.clock.t = at(9, 0, 17)
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(1)
  })
  it('waits while the bot is busy answering a customer', async () => {
    const t = setup()
    t.people(1)
    t.flags.busy = true
    t.engine.start(t.campaign().id)
    await t.run(30_000)
    expect(t.gateway.sent).toHaveLength(0)
    t.flags.busy = false
    await t.engine.tick()
    expect(t.gateway.sent).toHaveLength(1)
  })
})

describe('BroadcastEngine: stopping', () => {
  it('pauses (and never resumes by itself) after three failures in a row', async () => {
    const t = setup()
    t.people(8)
    const c = t.campaign()
    t.gateway.fail = true
    t.engine.start(c.id)
    await t.run(5 * 60_000)
    const row = t.store.getCampaign(c.id)!
    expect(row.status).toBe('dijeda')
    expect(row.pauseReason).toMatch(/gagal/i)
    t.gateway.fail = false
    await t.run(5 * 60_000)
    expect(t.gateway.sent).toHaveLength(0)
    expect(t.store.getCampaign(c.id)!.status).toBe('dijeda')
  })
  it('pauses when WhatsApp is disconnected and when broadcast is switched off', async () => {
    const t = setup()
    t.people(2)
    const c = t.campaign()
    t.flags.connected = false
    t.engine.start(c.id)
    await t.engine.tick()
    expect(t.store.getCampaign(c.id)).toMatchObject({ status: 'dijeda' })
    expect(t.store.getCampaign(c.id)!.pauseReason).toMatch(/terputus/i)

    const t2 = setup()
    t2.people(2)
    const c2 = t2.campaign()
    t2.settings.enabled = false
    t2.engine.start(c2.id)
    await t2.engine.tick()
    expect(t2.store.getCampaign(c2.id)!.status).toBe('dijeda')
    expect(t2.gateway.sent).toHaveLength(0)
  })
  it('three opt-out signals pause the running campaign', async () => {
    const t = setup()
    t.people(5)
    const c = t.campaign()
    t.engine.start(c.id)
    await t.engine.tick()
    t.engine.onSignal('optout'); t.engine.onSignal('optout')
    expect(t.store.getCampaign(c.id)!.status).toBe('berjalan')
    t.engine.onSignal('optout')
    expect(t.store.getCampaign(c.id)!.status).toBe('dijeda')
    expect(t.store.getCampaign(c.id)!.pauseReason).toMatch(/berhenti/i)
  })
  it('a complaint pauses at once', async () => {
    const t = setup()
    t.people(3)
    const c = t.campaign()
    t.engine.start(c.id)
    t.engine.onSignal('complaint')
    expect(t.store.getCampaign(c.id)!.status).toBe('dijeda')
  })
  it('stopAll stops everything and nothing is sent afterwards', async () => {
    const t = setup()
    t.people(5)
    const a = t.campaign(); const b = t.campaign()
    t.engine.start(a.id); t.engine.start(b.id)
    t.engine.stopAll()
    await t.run(120_000)
    expect(t.gateway.sent).toHaveLength(0)
    expect(t.store.getCampaign(a.id)!.status).toBe('dihentikan')
    expect(t.store.getCampaign(b.id)!.status).toBe('dihentikan')
  })
  it('a restart pauses a running campaign without resuming it', async () => {
    const t = setup()
    t.people(3)
    const c = t.campaign()
    t.engine.start(c.id)
    t.engine.resetAfterRestart()
    expect(t.store.getCampaign(c.id)).toMatchObject({ status: 'dijeda' })
    await t.run(60_000)
    expect(t.gateway.sent).toHaveLength(0)
  })
})

describe('BroadcastEngine: one campaign at a time', () => {
  it('queues the second campaign and starts it once the first is finished', async () => {
    const t = setup()
    t.people(1)
    const a = t.campaign(); const b = t.campaign({ template: 'Halo, kabar lain dari {bisnis}.' })
    t.engine.start(a.id)
    t.engine.start(b.id)
    expect(t.store.getCampaign(a.id)!.status).toBe('berjalan')
    expect(t.store.getCampaign(b.id)!.status).toBe('terjadwal')
    for (let i = 0; i < 8; i++) {
      await t.engine.tick()
      t.clock.t += 1000
      const [sa, sb] = [t.store.getCampaign(a.id)!.status, t.store.getCampaign(b.id)!.status]
      expect(sa === 'berjalan' && sb === 'berjalan').toBe(false)
    }
    expect(t.store.getCampaign(a.id)!.status).toBe('selesai')
    expect(['berjalan', 'selesai']).toContain(t.store.getCampaign(b.id)!.status)
  })
})

describe('BroadcastEngine.preview', () => {
  it('counts who would receive it, who would be skipped and why, and how many days it takes', () => {
    const t = setup({ age: 0 })
    const people = t.people(25)
    t.store.suppress({ number: people[0].number, jid: people[0].jid, reason: 'berhenti' })
    t.store.upsertContact({ number: null, jid: 'abc@lid', source: 'chat', status: 'aktif' })
    const c = t.campaign()
    const p = t.engine.preview(c.id)
    expect(p.eligible).toBe(24)
    expect(p.skipped).toEqual({ tolak: 1, nomor_tidak_diketahui: 1 })
    expect(p.estimatedDays).toBeGreaterThanOrEqual(5) // a new number: 5 first-time contacts a day
  })
})
