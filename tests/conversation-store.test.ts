import { describe, it, expect } from 'vitest'
import { openDb } from '../src/main/db'
import { ConversationStore } from '../src/main/conversation/store'

const HOUR = 3_600_000
function setup() {
  const clock = { t: 1_700_000_000_000, now() { return this.t } }
  const db = openDb(':memory:')
  return { clock, db, conv: new ConversationStore(db, clock) }
}
const C = '6281@s.whatsapp.net'

describe('turns', () => {
  it('returns the last n turns in chronological order', () => {
    const { conv, clock } = setup()
    for (let i = 1; i <= 15; i++) {
      conv.appendTurn(C, i % 2 ? 'user' : 'bot', `pesan ${i}`)
      clock.t += 1000
    }
    const last = conv.recentTurns(C, 10)
    expect(last).toHaveLength(10)
    expect(last[0].text).toBe('pesan 6')
    expect(last[9].text).toBe('pesan 15')
  })
  it('keeps chats separate and truncates very long turns to 1000 characters', () => {
    const { conv } = setup()
    conv.appendTurn(C, 'user', 'x'.repeat(5000))
    conv.appendTurn('lain@s.whatsapp.net', 'user', 'halo')
    expect(conv.recentTurns(C, 10)).toHaveLength(1)
    expect(conv.recentTurns(C, 10)[0].text).toHaveLength(1000)
  })
})

describe('state and lead', () => {
  it('starts as a bot-handled contact at the first stage', () => {
    const s = setup().conv.getState(C)
    expect(s).toMatchObject({ chatId: C, status: 'bot', stage: 'sapa', pausedUntil: null, lead: {}, productId: null })
    expect(s.lowConfidenceStreak).toBe(0)
    expect(s.turnsWithoutProgress).toBe(0)
    expect(s.ruleCounts).toEqual({})
  })
  it('mergeLead adds keys without dropping old ones and ignores empty values', () => {
    const { conv } = setup()
    conv.mergeLead(C, { nama: 'Budi' })
    conv.mergeLead(C, { kebutuhan: 'aplikasi kasir', anggaran: '  ' })
    expect(conv.getState(C).lead).toEqual({ nama: 'Budi', kebutuhan: 'aplikasi kasir' })
  })
  it('patchState updates only the given fields', () => {
    const { conv } = setup()
    conv.patchState(C, { stage: 'harga', productId: 'website-umkm', ruleCounts: { r1: 2 } })
    conv.patchState(C, { lowConfidenceStreak: 1 })
    expect(conv.getState(C)).toMatchObject({
      stage: 'harga', productId: 'website-umkm', ruleCounts: { r1: 2 }, lowConfidenceStreak: 1
    })
  })
})

describe('pausing', () => {
  it('pauses for the given hours and resumes by itself afterwards', () => {
    const { conv, clock } = setup()
    conv.pauseFor(C, 'manusia', 6)
    expect(conv.isPaused(C)).toBe(true)
    expect(conv.getState(C).status).toBe('manusia')
    clock.t += 6 * HOUR + 1
    expect(conv.isPaused(C)).toBe(false)
    expect(conv.getState(C)).toMatchObject({ status: 'bot', pausedUntil: null })
  })
  it('resume clears the pause immediately', () => {
    const { conv } = setup()
    conv.pauseFor(C, 'menunggu_admin', 6)
    conv.resume(C)
    expect(conv.isPaused(C)).toBe(false)
  })
  it('a pause on one chat does not affect another', () => {
    const { conv } = setup()
    conv.pauseFor(C, 'manusia', 6)
    expect(conv.isPaused('lain@s.whatsapp.net')).toBe(false)
  })
})

describe('sent ids, events and counters', () => {
  it('remembers only the ids the bot sent', () => {
    const { conv } = setup()
    conv.rememberSentId('ABC')
    expect(conv.isSentId('ABC')).toBe(true)
    expect(conv.isSentId('XYZ')).toBe(false)
  })
  it('counts bot replies inside a time window', () => {
    const { conv, clock } = setup()
    conv.appendTurn(C, 'bot', 'a')
    clock.t += 2 * HOUR
    conv.appendTurn(C, 'bot', 'b')
    conv.appendTurn(C, 'user', 'c')
    expect(conv.countRepliesSince(C, clock.t - HOUR)).toBe(1)
    expect(conv.countRepliesSince(C, clock.t - 3 * HOUR)).toBe(2)
  })
  it('records events and handoffs', () => {
    const { conv, db } = setup()
    conv.recordEvent(C, 'checkout_sent', 'website-umkm')
    const id = conv.recordHandoff(C, 'komplain')
    expect((db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c).toBe(1)
    expect(id).toBeGreaterThan(0)
    expect((db.prepare('SELECT reason FROM handoffs WHERE id = ?').get(id) as { reason: string }).reason).toBe('komplain')
  })
  it('counts how many times an event type happened for a product', () => {
    const { conv } = setup()
    conv.recordEvent(C, 'checkout_sent', 'a')
    conv.recordEvent(C, 'checkout_sent', 'a')
    conv.recordEvent(C, 'checkout_sent', 'b')
    expect(conv.countEvents(C, 'checkout_sent', 'a')).toBe(2)
    expect(conv.lastEventAt(C, 'checkout_sent', 'a')).not.toBeNull()
    expect(conv.lastEventAt(C, 'link_sent', 'a')).toBeNull()
  })
})
