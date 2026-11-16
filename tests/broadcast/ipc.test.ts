import { describe, it, expect } from 'vitest'
import { openDb } from '../../src/main/db'
import { BroadcastStore } from '../../src/main/broadcast/store'
import { BroadcastEngine } from '../../src/main/broadcast/engine'
import { ImportService } from '../../src/main/broadcast/import'
import { createBroadcastHandlers, loadSafety } from '../../src/main/broadcast/ipc'
import { MessageFeed } from '../../src/main/messages/message-feed'
import { ConversationStore } from '../../src/main/conversation/store'
import { AttestSchema } from '../../src/shared/broadcast'
import type { WaGateway } from '../../src/main/wa/gateway'

const at = (h: number, m = 0, day = 16) => Date.UTC(2026, 10, day, h - 8, m)

class Gw implements WaGateway {
  onMessage(): void {}
  onStatus(): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return '6285119308345' }
  jidFor(n: string): string { return `${n}@s.whatsapp.net` }
  async onWhatsApp(ns: string[]) { return ns.map((number) => ({ number, jid: `${number}@s.whatsapp.net`, exists: true })) }
  async sendText(): Promise<string | null> { return 'W1' }
}

function setup() {
  const db = openDb(':memory:')
  const clock = { t: at(12), now() { return this.t } }
  const store = new BroadcastStore(db, clock)
  const gateway = new Gw()
  const flags = { locked: false }
  const engine = new BroadcastEngine({
    store, gateway, feed: new MessageFeed(db, clock), conv: new ConversationStore(db, clock), clock, rand: () => 0,
    isBusy: () => false, connected: () => true, settings: () => loadSafety(store, clock.now()), businessName: () => 'Kopi Sudut'
  })
  const importer = new ImportService({ store, gateway, clock, sleep: async () => undefined })
  const h = createBroadcastHandlers({ store, engine, importer, clock, isLocked: () => flags.locked, businessName: () => 'Kopi Sudut' })
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const number = `6281200${String(i).padStart(6, '0')}`
      return store.upsertContact({ number, jid: `${number}@s.whatsapp.net`, name: `Nama${i}`, source: 'chat', status: 'aktif' })
    })
  const ready = () => h.bcSetSafety({ enabled: true, ageDays: 365 })
  return { db, clock, store, engine, h, flags, people, ready }
}
const good = 'Halo {nama}, ini {bisnis}: ada menu baru minggu ini.'

describe('writers refuse while the app is locked; stop-all never does', () => {
  it('rejects every write with LOCKED but still allows bcStopAll', async () => {
    const t = setup()
    t.flags.locked = true
    const calls: (() => unknown)[] = [
      () => t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }),
      () => t.h.bcStartCampaign(1),
      () => t.h.bcPauseCampaign(1),
      () => t.h.bcStopCampaign(1),
      () => t.h.bcSetSafety({ enabled: true }),
      () => t.h.bcImportPreview({ name: 'a.csv', data: 'nomor\n0812' }),
      () => t.h.bcImportCommit('p', { accepted: true, sourceNote: 'Formulir pendaftaran' }),
      () => t.h.bcSendConfirmations(),
      () => t.h.bcEraseContact(1),
      () => t.h.bcDiscardDraft(1)
    ]
    for (const c of calls) await expect(Promise.resolve().then(c)).rejects.toThrow('LOCKED')
    expect(() => t.h.bcStopAll()).not.toThrow()
  })
  it('reading is not a write, so overview works unlocked', () => {
    const t = setup()
    expect(t.h.bcOverview().contacts).toEqual({ aktif: 0, menunggu_persetujuan: 0, tidak_aktif: 0 })
  })
})

describe('safety settings', () => {
  it('starts switched off and undeclared, so nothing can be sent before the user sets it up', () => {
    const t = setup()
    expect(t.h.bcGetSafety()).toMatchObject({ configured: false, enabled: false })
  })
  it('declares the number age once, then it can only grow with time', () => {
    const t = setup()
    expect(t.ready()).toMatchObject({ ok: true })
    expect(t.h.bcGetSafety()).toMatchObject({ configured: true, enabled: true, tier: 'mapan' })
    expect(t.h.bcSetSafety({ ageDays: 1 })).toMatchObject({ ok: false })
    expect(t.h.bcGetSafety().tier).toBe('mapan')
  })
  it('rejects a minimum gap outside 3–7 days and an invalid send window', () => {
    const t = setup()
    t.ready()
    for (const minGapDays of [2, 8]) expect(t.h.bcSetSafety({ minGapDays })).toMatchObject({ ok: false })
    expect(t.h.bcSetSafety({ minGapDays: 3 })).toMatchObject({ ok: true })
    expect(t.h.bcSetSafety({ window: { start: '25:00', end: '20:00', timezone: 'Asia/Makassar' } })).toMatchObject({ ok: false })
    expect(t.h.bcSetSafety({ window: { start: '10:00', end: '09:00', timezone: 'Asia/Makassar' } })).toMatchObject({ ok: false })
    expect(t.h.bcSetSafety({ window: { start: '10:00', end: '18:00', timezone: 'Asia/Makassar' } })).toMatchObject({ ok: true })
  })
  it('"I changed my number" needs confirmation and then starts the warm-up and the declaration over', () => {
    const t = setup()
    t.ready()
    expect(t.h.bcSetSafety({ changeNumber: true })).toMatchObject({ ok: false })
    expect(t.h.bcGetSafety().configured).toBe(true)
    expect(t.h.bcSetSafety({ changeNumber: true, confirm: true })).toMatchObject({ ok: true })
    expect(t.h.bcGetSafety()).toMatchObject({ configured: false, enabled: false })
    expect(loadSafety(t.store, t.clock.now()).warmupFrom).toBe(t.clock.now())
    expect(t.h.bcSetSafety({ ageDays: 10, enabled: true })).toMatchObject({ ok: true })
    expect(t.h.bcGetSafety().tier).toBe('baru')
  })
})

describe('campaigns', () => {
  it('returns lint errors instead of creating a campaign that breaks the rules', () => {
    const t = setup()
    const r = t.h.bcCreateCampaign({ name: 'x', template: 'Halo, ada promo besar.', audience: 'semua' })
    expect(r).toMatchObject({ ok: false })
    expect((r as { errors: string[] }).errors.join(' ')).toMatch(/nama bisnis/i)
    expect(t.h.bcCampaigns()).toEqual([])
  })
  it('returns up to three rendered samples with the real business name and the opt-out sentence', () => {
    const t = setup()
    t.people(5)
    const r = t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }) as { ok: true; samples: string[] }
    expect(r.samples).toHaveLength(3)
    expect(r.samples[0]).toMatch(/^Halo Nama0, ini Kopi Sudut/)
    expect(r.samples[0].endsWith('Balas BERHENTI untuk tidak menerima pesan ini lagi.')).toBe(true)
  })
  it('refuses to start until the safety settings are declared and switched on', () => {
    const t = setup()
    t.people(2)
    const c = t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }) as { ok: true; campaign: { id: number } }
    expect(t.h.bcStartCampaign(c.campaign.id)).toMatchObject({ ok: false })
    t.ready()
    expect(t.h.bcStartCampaign(c.campaign.id)).toMatchObject({ ok: true })
  })
  it('needs KIRIM above 50 recipients, and nothing extra at 50 or fewer', () => {
    const t = setup()
    t.ready()
    t.people(60)
    const big = t.h.bcCreateCampaign({ name: 'besar', template: good, audience: 'semua' }) as { campaign: { id: number } }
    expect(t.h.bcStartCampaign(big.campaign.id)).toMatchObject({ ok: false })
    expect(t.h.bcStartCampaign(big.campaign.id, 'kirim')).toMatchObject({ ok: false })
    expect(t.h.bcStartCampaign(big.campaign.id, 'KIRIM')).toMatchObject({ ok: true })

    const t2 = setup()
    t2.ready()
    t2.people(50)
    const small = t2.h.bcCreateCampaign({ name: 'kecil', template: good, audience: 'semua' }) as { campaign: { id: number } }
    expect(t2.h.bcStartCampaign(small.campaign.id)).toMatchObject({ ok: true })
  })
  it('validates input: ids must be numbers and text must be sane', () => {
    const t = setup()
    expect(() => t.h.bcPauseCampaign('x')).toThrow()
    expect(() => t.h.bcCreateCampaign({ name: 'n'.repeat(101), template: good, audience: 'semua' })).toThrow()
    expect(() => t.h.bcCreateCampaign({ name: 'ok', template: good, audience: 'semua', evil: true })).toThrow()
  })
  it('pause, resume and stop change the campaign status', () => {
    const t = setup()
    t.ready()
    t.people(3)
    const c = t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }) as { campaign: { id: number } }
    t.h.bcStartCampaign(c.campaign.id)
    t.h.bcPauseCampaign(c.campaign.id)
    expect(t.store.getCampaign(c.campaign.id)!.status).toBe('dijeda')
    t.h.bcResumeCampaign(c.campaign.id)
    expect(t.store.getCampaign(c.campaign.id)!.status).toBe('berjalan')
    t.h.bcStopCampaign(c.campaign.id)
    expect(t.store.getCampaign(c.campaign.id)!.status).toBe('dihentikan')
  })
})

describe('import and confirmations through the handlers', () => {
  it('previews a list, then commits it only with the consent statement', async () => {
    const t = setup()
    const p = t.h.bcImportPreview({ name: 'a.csv', data: 'nomor,nama\n081234567890,Budi\n081298765432,Sari\n123,Salah' })
    expect(p).toMatchObject({ total: 3, validCount: 2, invalidCount: 1 })
    await expect(t.h.bcImportCommit(p.previewId, { accepted: false, sourceNote: 'Formulir pendaftaran' })).rejects.toThrow()
    const r = await t.h.bcImportCommit(p.previewId, { accepted: true, sourceNote: 'Formulir pendaftaran website' })
    expect(r).toMatchObject({ added: 2, aborted: false })
    expect(t.h.bcOverview().contacts.menunggu_persetujuan).toBe(2)
  })
  it('an unknown or used preview id is refused', async () => {
    const t = setup()
    await expect(t.h.bcImportCommit('nope', { accepted: true, sourceNote: 'Formulir pendaftaran website' })).rejects.toThrow()
  })
  it('sends confirmations only when someone is waiting, as a confirmation campaign', () => {
    const t = setup()
    t.ready()
    expect(t.h.bcSendConfirmations()).toMatchObject({ ok: false })
    t.store.upsertContact({ number: '628123456789', jid: '628123456789@s.whatsapp.net', source: 'impor', status: 'menunggu_persetujuan' })
    const r = t.h.bcSendConfirmations()
    expect(r).toMatchObject({ ok: true })
    expect(t.store.listCampaigns()[0]).toMatchObject({ kind: 'konfirmasi', status: 'berjalan' })
  })
})

describe('report export', () => {
  it('neutralises spreadsheet formulas and quotes commas, quotes and line breaks', async () => {
    const t = setup()
    t.ready()
    const evil = ['=1+1', '+62', '-x', '@cmd', 'a,b', 'say "hi"', 'baris\nbaru']
    evil.forEach((name, i) => {
      const number = `6281300${String(i).padStart(6, '0')}`
      t.store.upsertContact({ number, jid: `${number}@s.whatsapp.net`, name, source: 'chat', status: 'aktif' })
    })
    const c = t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }) as { campaign: { id: number } }
    t.h.bcStartCampaign(c.campaign.id)
    const csv = t.h.bcExportReport(c.campaign.id)
    expect(csv.split('\n')[0]).toBe('nomor,nama,status,alasan,waktu')
    expect(csv).toContain("'=1+1")
    expect(csv).toContain("'+62")
    expect(csv).toContain("'-x")
    expect(csv).toContain("'@cmd")
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"baris\nbaru"')
    expect(csv).not.toMatch(/(^|,)=1\+1/m)
  })
})

describe('erasing a contact', () => {
  it('removes them but keeps an opted-out person blocked', () => {
    const t = setup()
    const [p] = t.people(1)
    t.store.suppress({ number: p.number, jid: p.jid, reason: 'berhenti' })
    t.h.bcEraseContact(p.id)
    expect(t.store.findContact({ number: p.number })).toBeNull()
    expect(t.store.isSuppressed({ number: p.number })).not.toBeNull()
  })
})

describe('AttestSchema', () => {
  it('needs the consent flag set to true and a source note of at least 10 characters', () => {
    expect(AttestSchema.safeParse({ accepted: true, sourceNote: 'Formulir pendaftaran' }).success).toBe(true)
    expect(AttestSchema.safeParse({ accepted: true, sourceNote: 'singkat' }).success).toBe(false)
    expect(AttestSchema.safeParse({ accepted: false, sourceNote: 'Formulir pendaftaran' }).success).toBe(false)
    expect(AttestSchema.safeParse({ accepted: true, sourceNote: 'Formulir pendaftaran', x: 1 }).success).toBe(false)
  })
})

describe('hardening of the settings and resume rules', () => {
  it('keeps the send window to daytime hours and a real time zone', () => {
    const t = setup()
    t.ready()
    const win = (start: string, end: string, timezone = 'Asia/Makassar') => t.h.bcSetSafety({ window: { start, end, timezone } })
    expect(win('05:00', '18:00')).toMatchObject({ ok: false })
    expect(win('09:00', '23:00')).toMatchObject({ ok: false })
    expect(win('09:00', '18:00', 'Mars/Olympus')).toMatchObject({ ok: false })
    expect(win('06:00', '22:00')).toMatchObject({ ok: true })
  })
  it('resumes only a paused campaign: a draft cannot be started that way', () => {
    const t = setup()
    t.ready()
    t.people(3)
    const c = t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }) as { campaign: { id: number } }
    expect(t.h.bcResumeCampaign(c.campaign.id)).toMatchObject({ ok: false })
    expect(t.store.getCampaign(c.campaign.id)!.status).toBe('draf')
    t.h.bcStartCampaign(c.campaign.id)
    t.h.bcPauseCampaign(c.campaign.id)
    expect(t.h.bcResumeCampaign(c.campaign.id)).toMatchObject({ ok: true })
  })
  it('discards a draft but refuses to discard a campaign that has started', () => {
    const t = setup()
    t.ready()
    t.people(2)
    const d = t.h.bcCreateCampaign({ name: 'd', template: good, audience: 'semua' }) as { campaign: { id: number } }
    const l = t.h.bcCreateCampaign({ name: 'l', template: good, audience: 'semua' }) as { campaign: { id: number } }
    t.h.bcStartCampaign(l.campaign.id)
    expect(t.h.bcDiscardDraft(d.campaign.id)).toEqual({ ok: true })
    expect(t.h.bcDiscardDraft(l.campaign.id)).toEqual({ ok: false })
    expect(t.store.getCampaign(d.campaign.id)).toBeNull()
  })
  it('validates the contact filter', () => {
    const t = setup()
    expect(() => t.h.bcContacts({ status: 'sembarang' })).toThrow()
    expect(t.h.bcContacts({ status: 'aktif' })).toEqual([])
  })
  it('neutralises a formula that hides behind leading spaces', () => {
    const t = setup()
    t.ready()
    const number = '628130000999'
    t.store.upsertContact({ number, jid: `${number}@s.whatsapp.net`, name: '  =cmd', source: 'chat', status: 'aktif' })
    const c = t.h.bcCreateCampaign({ name: 'x', template: good, audience: 'semua' }) as { campaign: { id: number } }
    t.h.bcStartCampaign(c.campaign.id)
    expect(t.h.bcExportReport(c.campaign.id)).toContain("'  =cmd")
  })
})
