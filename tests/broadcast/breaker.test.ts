import { describe, it, expect } from 'vitest'
import { evaluateBreaker, type Outcome } from '../../src/main/broadcast/breaker'

const out = (ok: boolean, o: Partial<Outcome> = {}): Outcome => ({ at: 1, ok, kind: 'broadcast', toNonChat: false, ...o })
const many = (n: number, ok = true, o: Partial<Outcome> = {}): Outcome[] => Array.from({ length: n }, () => out(ok, o))
const quiet = { lastOptOuts: 0, lastComplaints: 0, repliesAmongNonChat: 0 }

describe('evaluateBreaker', () => {
  it('does nothing with no history', () => {
    expect(evaluateBreaker([], quiet, 'broadcast')).toEqual({ trip: false })
  })
  it('trips on three failures in a row', () => {
    const r = evaluateBreaker([...many(5), out(false), out(false), out(false)], quiet, 'broadcast')
    expect(r.trip).toBe(true)
    expect((r as { reason: string }).reason).toMatch(/gagal/i)
    expect(evaluateBreaker([out(false), out(false), out(true)], quiet, 'broadcast').trip).toBe(false)
  })
  it('trips when 20% of the last 20 failed, not at 15%', () => {
    const mixed = (fails: number) => {
      const a = many(20)
      for (let i = 0; i < fails; i++) a[i * 5] = out(false)
      return a
    }
    expect(evaluateBreaker(mixed(4), quiet, 'broadcast').trip).toBe(true)
    expect(evaluateBreaker(mixed(3), quiet, 'broadcast').trip).toBe(false)
  })
  it('trips on 3 opt-outs among the last 30 sends, and on a single complaint', () => {
    expect(evaluateBreaker(many(30), { ...quiet, lastOptOuts: 3 }, 'broadcast').trip).toBe(true)
    expect(evaluateBreaker(many(30), { ...quiet, lastOptOuts: 2 }, 'broadcast').trip).toBe(false)
    const r = evaluateBreaker(many(5), { ...quiet, lastComplaints: 1 }, 'broadcast')
    expect(r.trip).toBe(true)
    expect((r as { reason: string }).reason).toMatch(/laporan|spam|keluhan/i)
  })
  it('trips after 30 sends to non-chat contacts with no replies; confirmations after 20', () => {
    expect(evaluateBreaker(many(30, true, { toNonChat: true }), quiet, 'broadcast').trip).toBe(true)
    expect(evaluateBreaker(many(29, true, { toNonChat: true }), quiet, 'broadcast').trip).toBe(false)
    expect(evaluateBreaker(many(30, true, { toNonChat: true }), { ...quiet, repliesAmongNonChat: 1 }, 'broadcast').trip).toBe(false)
    expect(evaluateBreaker(many(20, true, { toNonChat: true, kind: 'konfirmasi' }), quiet, 'konfirmasi').trip).toBe(true)
    expect(evaluateBreaker(many(19, true, { toNonChat: true, kind: 'konfirmasi' }), quiet, 'konfirmasi').trip).toBe(false)
  })
  it('chat contacts never count towards the no-reply rule', () => {
    expect(evaluateBreaker(many(60, true, { toNonChat: false }), quiet, 'broadcast').trip).toBe(false)
  })
  it('always explains a trip in Indonesian', () => {
    const r = evaluateBreaker(many(3, false), quiet, 'broadcast')
    expect(r.trip && r.reason.length).toBeGreaterThan(10)
  })
})
