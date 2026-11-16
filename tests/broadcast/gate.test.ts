import { describe, it, expect } from 'vitest'
import { checkSend, type GateContext } from '../../src/main/broadcast/gate'
import type { BContact } from '../../src/shared/broadcast'

const W = { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }
const at = (h: number, m = 0, day = 16) => Date.UTC(2026, 10, day, h - 8, m) // Monday, UTC+8
const DAY = 86_400_000
const NOW = at(12)

const contact = (o: Partial<BContact> = {}): BContact => ({
  id: 1, number: '6281234567890', jid: '6281234567890@s.whatsapp.net', name: 'Budi', vars: {}, source: 'chat',
  status: 'aktif', lastInboundAt: NOW - DAY, lastSentAt: null, sentCount: 0, importId: null, ...o
})
const ctx = (o: Partial<GateContext> = {}): GateContext => ({
  now: NOW, connected: true, globalEnabled: true, busy: false, tier: 'mapan', window: W, activeDay: 30,
  counters: { sentToday: 0, sentThisHour: 0, sentLast24h: 0, newToday: 0, sinceBatchPause: 0, lastSentAt: null, batchPausedUntil: null },
  kind: 'broadcast', minGapDays: 7, isSuppressed: () => false,
  contactHistory: { lastSentAt: null, sentLast30d: 0, neverSent: false },
  ...o
})
const counters = (o: Partial<GateContext['counters']>): GateContext['counters'] => ({ ...ctx().counters, ...o })

describe('checkSend: allow and halt', () => {
  it('allows an ordinary send', () => {
    expect(checkSend(contact(), ctx())).toEqual({ kind: 'allow' })
  })
  it('halts when WhatsApp is disconnected or broadcast is switched off', () => {
    expect(checkSend(contact(), ctx({ connected: false })).kind).toBe('halt')
    expect(checkSend(contact(), ctx({ globalEnabled: false })).kind).toBe('halt')
  })
})

describe('checkSend: who may receive', () => {
  it('skips a suppressed contact, even outside the send window', () => {
    const c = ctx({ isSuppressed: () => true, now: at(22) })
    expect(checkSend(contact(), c)).toEqual({ kind: 'skip', reason: 'tolak' })
  })
  it('skips inactive contacts', () => {
    expect(checkSend(contact({ status: 'tidak_aktif' }), ctx())).toEqual({ kind: 'skip', reason: 'tidak_aktif' })
  })
  it('only a confirmation campaign may message a contact who has not confirmed yet', () => {
    const pending = contact({ status: 'menunggu_persetujuan', source: 'impor' })
    expect(checkSend(pending, ctx())).toEqual({ kind: 'skip', reason: 'menunggu_persetujuan' })
    const fresh = { lastSentAt: null, sentLast30d: 0, neverSent: true }
    expect(checkSend(pending, ctx({ kind: 'konfirmasi', contactHistory: fresh }))).toEqual({ kind: 'allow' })
  })
  it('skips a contact whose number is unknown', () => {
    expect(checkSend(contact({ number: null, jid: 'abc@lid' }), ctx())).toEqual({ kind: 'skip', reason: 'nomor_tidak_diketahui' })
  })
})

describe('checkSend: when to send', () => {
  it('waits for the send window to open, then closes at 20:00', () => {
    const early = checkSend(contact(), ctx({ now: at(7) }))
    expect(early).toMatchObject({ kind: 'wait', until: at(9) })
    const late = checkSend(contact(), ctx({ now: at(20) }))
    expect(late).toMatchObject({ kind: 'wait', until: at(9, 0, 17) })
  })
  it('waits while the bot is busy replying to a customer', () => {
    const d = checkSend(contact(), ctx({ busy: true }))
    expect(d.kind).toBe('wait')
  })
  it('waits out a batch pause', () => {
    const until = NOW + 200_000
    expect(checkSend(contact(), ctx({ counters: counters({ batchPausedUntil: until }) }))).toMatchObject({ kind: 'wait', until })
    expect(checkSend(contact(), ctx({ counters: counters({ batchPausedUntil: NOW - 1 }) }))).toEqual({ kind: 'allow' })
  })
  it('allows 14 messages this hour but waits at 15', () => {
    expect(checkSend(contact(), ctx({ counters: counters({ sentThisHour: 14 }) })).kind).toBe('allow')
    const d = checkSend(contact(), ctx({ counters: counters({ sentThisHour: 15 }) }))
    expect(d).toMatchObject({ kind: 'wait' })
    expect((d as { until: number }).until).toBeGreaterThan(NOW)
    expect((d as { until: number }).until).toBeLessThanOrEqual(NOW + 3_600_000)
  })
  it('waits until tomorrow when the daily cap is reached, using the warm-up cap on the first day', () => {
    const young = ctx({ tier: 'baru', activeDay: 1, counters: counters({ sentToday: 10 }) })
    expect(checkSend(contact(), young)).toMatchObject({ kind: 'wait', until: at(9, 0, 17) })
    expect(checkSend(contact(), { ...young, counters: counters({ sentToday: 9 }) }).kind).toBe('allow')
    const mature = ctx({ tier: 'mapan', activeDay: 30, counters: counters({ sentToday: 199 }) })
    expect(checkSend(contact(), mature).kind).toBe('allow')
    expect(checkSend(contact(), { ...mature, counters: counters({ sentToday: 200 }) }).kind).toBe('wait')
  })
  it('limits first-ever messages (new contacts) separately, and only counts people never messaged', () => {
    const base = ctx({ tier: 'baru', activeDay: 30, counters: counters({ newToday: 5 }) })
    const fresh = { lastSentAt: null, sentLast30d: 0, neverSent: true }
    expect(checkSend(contact(), { ...base, contactHistory: fresh })).toMatchObject({ kind: 'wait', until: at(9, 0, 17) })
    expect(checkSend(contact(), base).kind).toBe('allow')
    expect(checkSend(contact(), { ...base, counters: counters({ newToday: 4 }), contactHistory: fresh }).kind).toBe('allow')
  })
})

describe('checkSend: per-contact spacing', () => {
  it('skips a contact messaged less than the minimum gap ago, and allows exactly at the gap', () => {
    const recent = { lastSentAt: NOW - 6 * DAY, sentLast30d: 1, neverSent: false }
    expect(checkSend(contact(), ctx({ contactHistory: recent }))).toEqual({ kind: 'skip', reason: 'terlalu_cepat' })
    const ok = { lastSentAt: NOW - 7 * DAY, sentLast30d: 1, neverSent: false }
    expect(checkSend(contact(), ctx({ contactHistory: ok })).kind).toBe('allow')
    expect(checkSend(contact(), ctx({ minGapDays: 3, contactHistory: recent })).kind).toBe('allow')
  })
  it('skips after 4 messages in 30 days, allows at 3', () => {
    const h = (n: number) => ({ lastSentAt: NOW - 8 * DAY, sentLast30d: n, neverSent: false })
    expect(checkSend(contact(), ctx({ contactHistory: h(4) }))).toEqual({ kind: 'skip', reason: 'batas_30_hari' })
    expect(checkSend(contact(), ctx({ contactHistory: h(3) })).kind).toBe('allow')
  })
})

describe('checkSend: wait times are always in the future', () => {
  it('never returns a wait that is not after now', () => {
    const cases: Partial<GateContext>[] = [
      { now: at(7) }, { now: at(21) }, { counters: counters({ sentThisHour: 15 }) },
      { tier: 'baru', activeDay: 1, counters: counters({ sentToday: 10 }) }
    ]
    for (const c of cases) {
      const d = checkSend(contact(), ctx(c))
      expect(d.kind).toBe('wait')
      expect((d as { until: number }).until).toBeGreaterThan((c.now ?? NOW))
    }
  })
})

describe('checkSend: spacing, rolling day and confirmations', () => {
  it('keeps at least 20 seconds between any two sends, even right after a restart', () => {
    const d = checkSend(contact(), ctx({ counters: counters({ lastSentAt: NOW - 10_000 }) }))
    expect(d).toMatchObject({ kind: 'wait', until: NOW + 10_000 })
    expect(checkSend(contact(), ctx({ counters: counters({ lastSentAt: NOW - 20_000 }) })).kind).toBe('allow')
  })
  it('a rolling 24-hour count backs up the daily cap, so moving the time zone cannot buy extra sends', () => {
    const base = ctx({ tier: 'baru', activeDay: 30 })
    expect(checkSend(contact(), { ...base, counters: counters({ sentToday: 0, sentLast24h: 20 }) }).kind).toBe('wait')
    expect(checkSend(contact(), { ...base, counters: counters({ sentToday: 0, sentLast24h: 19 }) }).kind).toBe('allow')
  })
  it('a confirmation goes only to someone still waiting who was never messaged', () => {
    const fresh = { lastSentAt: null, sentLast30d: 0, neverSent: true }
    const messaged = { lastSentAt: NOW - 30 * DAY, sentLast30d: 0, neverSent: false }
    const pending = contact({ status: 'menunggu_persetujuan', source: 'impor' })
    expect(checkSend(contact(), ctx({ kind: 'konfirmasi', contactHistory: fresh }))).toEqual({ kind: 'skip', reason: 'sudah_dikonfirmasi' })
    expect(checkSend(pending, ctx({ kind: 'konfirmasi', contactHistory: messaged }))).toEqual({ kind: 'skip', reason: 'sudah_dikonfirmasi' })
    expect(checkSend(pending, ctx({ kind: 'konfirmasi', contactHistory: fresh }))).toEqual({ kind: 'allow' })
  })
})
